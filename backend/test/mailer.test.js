const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_mailer');
const { renderTemplate, generateToken, isSmtpConfigured, sendMail } = require('../mailer');

let baseUrl;
test.before(async () => { ({ baseUrl } = await setup()); });
test.after(() => teardown());

const SMTP_SETTINGS = {
  smtp_host: 'smtp.example.com', smtp_port: 465, smtp_secure: true,
  smtp_user: 'noreply@example.com', smtp_pass: 'secret', mail_from: '项目跟踪 <noreply@example.com>',
};

const IMAP_SETTINGS = {
  ...SMTP_SETTINGS,
  imap_host: 'imap.example.com', imap_port: 993, imap_secure: true,
  imap_user: 'noreply@example.com', imap_pass: 'secret',
};

function fakeTransport(info = { messageId: '<fake@local>' }) {
  return {
    sent: [],
    async sendMail(msg) { this.sent.push(msg); return info; },
  };
}

test('renderTemplate 替换已知占位符，未知占位符原样保留', () => {
  const out = renderTemplate('编号 {{issue_no}}，逾期 {{overdue_days}} 天，{{unknown}} 保留', {
    issue_no: 'ISS-0001', overdue_days: 3,
  });
  assert.strictEqual(out, '编号 ISS-0001，逾期 3 天，{{unknown}} 保留');
  assert.strictEqual(renderTemplate('{{a}}', {}), '{{a}}');
});

test('generateToken 生成 32 位 hex 且不重复', () => {
  const t1 = generateToken();
  const t2 = generateToken();
  assert.match(t1, /^[0-9a-f]{32}$/);
  assert.notStrictEqual(t1, t2);
});

test('SMTP 未配置 → 写 skipped 日志，不发送', async () => {
  const transport = fakeTransport();
  const result = await sendMail({
    settings: {}, transport, to: ['a@b.com'], cc: [],
    subject: '主题', body: '正文', issueId: 1, ruleId: 2, token: 'tok123',
  });
  assert.strictEqual(result.status, 'skipped');
  assert.strictEqual(transport.sent.length, 0);
  const rows = await db.query('SELECT * FROM email_logs WHERE id = ?', [result.logId]);
  assert.strictEqual(rows[0].status, 'skipped');
  assert.strictEqual(rows[0].issue_id, 1);
  assert.strictEqual(rows[0].token, 'tok123');
});

test('发送成功 → 写 sent 日志（含 messageId/token/渲染内容）', async () => {
  const transport = fakeTransport();
  const result = await sendMail({
    settings: SMTP_SETTINGS, transport, to: ['a@b.com', 'a@b.com', 'c@d.com'], cc: [],
    subject: '催办', body: '内容', issueId: 5, ruleId: 1, token: 'tok-abc',
  });
  assert.strictEqual(result.status, 'sent');
  assert.strictEqual(result.messageId, '<fake@local>');
  assert.strictEqual(transport.sent.length, 1);
  assert.strictEqual(transport.sent[0].to, 'a@b.com,c@d.com', '收件人应去重');
  assert.strictEqual(transport.sent[0].from, '项目跟踪 <noreply@example.com>');
  const rows = await db.query('SELECT * FROM email_logs WHERE id = ?', [result.logId]);
  assert.strictEqual(rows[0].status, 'sent');
  assert.strictEqual(rows[0].message_id, '<fake@local>');
  assert.strictEqual(rows[0].token, 'tok-abc');
  assert.strictEqual(rows[0].recipients, 'a@b.com,c@d.com');
});

test('发送异常 → 写 failed 日志（error_msg 截断）', async () => {
  const transport = {
    async sendMail() { throw new Error('Connection refused'); },
  };
  const result = await sendMail({
    settings: SMTP_SETTINGS, transport, to: ['a@b.com'], cc: [],
    subject: 's', body: 'b',
  });
  assert.strictEqual(result.status, 'failed');
  const rows = await db.query('SELECT * FROM email_logs WHERE id = ?', [result.logId]);
  assert.strictEqual(rows[0].status, 'failed');
  assert.ok(rows[0].error_msg.includes('Connection refused'));
  assert.ok(rows[0].error_msg.length <= 500);
});

test('createTransport 启用连接池与超时', () => {
  const { createTransport } = require('../mailer');
  const trans = createTransport(SMTP_SETTINGS);
  assert.strictEqual(trans.options.pool, true);
  assert.strictEqual(trans.options.maxConnections, 3);
  assert.strictEqual(trans.options.connectionTimeout, 10000);
  assert.strictEqual(trans.options.greetingTimeout, 10000);
  assert.strictEqual(trans.options.socketTimeout, 60000);
  trans.close();
});

test('isImapConfigured 在 IMAP 信息齐全时返回 true', () => {
  const { isImapConfigured } = require('../mailer');
  assert.strictEqual(isImapConfigured(IMAP_SETTINGS), true);
  assert.strictEqual(isImapConfigured({}), false);
  assert.strictEqual(isImapConfigured({ imap_host: 'x', imap_user: 'y' }), false);
});

test('detectSentBox 从邮箱列表中识别常见 Sent 文件夹', async () => {
  const { detectSentBox } = require('../mailer');
  const fakeClient = {
    list: async () => [
      { path: 'INBOX' },
      { path: 'Sent Items' },
      { path: 'Drafts' },
    ],
  };
  assert.strictEqual(await detectSentBox(fakeClient), 'Sent Items');
});

test('detectSentBox 支持中文 "已发送"', async () => {
  const { detectSentBox } = require('../mailer');
  const fakeClient = {
    list: async () => [
      { path: '收件箱' },
      { path: '已发送' },
    ],
  };
  assert.strictEqual(await detectSentBox(fakeClient), '已发送');
});

test('detectSentBox 找不到 Sent 文件夹时返回 null', async () => {
  const { detectSentBox } = require('../mailer');
  const fakeClient = { list: async () => [{ path: 'INBOX' }] };
  assert.strictEqual(await detectSentBox(fakeClient), null);
});

test('发送成功且 IMAP 已配置 → 通过 deps 注入验证会异步保存到已发送', async () => {
  const { sendMail } = require('../mailer');
  const transport = fakeTransport();
  let appendCalled = false;
  let appendArgs = null;

  const result = await sendMail({
    settings: IMAP_SETTINGS, transport, to: ['a@b.com'], cc: [],
    subject: '主题', body: '正文',
    deps: {
      appendSent: async (args) => {
        appendCalled = true;
        appendArgs = args;
      },
    },
  });
  assert.strictEqual(result.status, 'sent');
  assert.strictEqual(appendCalled, true);
  assert.strictEqual(appendArgs.settings, IMAP_SETTINGS);
  assert.ok(Buffer.isBuffer(appendArgs.message));
  const mime = appendArgs.message.toString('utf8');
  assert.ok(mime.includes('Subject: 主题'));
  assert.ok(mime.includes('To: a@b.com'));
});
