const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_bounce');
const { isBounce, extractFailedRecipients, extractOriginalMessageId, matchBounceLog } = require('../bounce-scanner');

let baseUrl;
test.before(async () => { ({ baseUrl } = await setup()); });
test.after(() => teardown());

test('isBounce：MAILER-DAEMON/postmaster/退信主题', () => {
  assert.strictEqual(isBounce({ from: { address: 'MAILER-DAEMON@qq.com' }, subject: 'delivery failure' }), true);
  assert.strictEqual(isBounce({ from: { address: 'postmaster@example.com' }, subject: 'hi' }), true);
  assert.strictEqual(isBounce({ from: { address: 'user@example.com' }, subject: 'Undelivered Mail Returned' }), true);
  assert.strictEqual(isBounce({ from: { address: 'user@example.com' }, subject: '退信通知' }), true);
  assert.strictEqual(isBounce({ from: { address: 'user@example.com' }, subject: '普通邮件' }), false);
});

test('extractFailedRecipients：单行/多行/逗号分隔', () => {
  const h1 = 'From: daemon\r\nX-Failed-Recipients: bad@example.com\r\nSubject: x';
  assert.deepStrictEqual(extractFailedRecipients(h1), ['bad@example.com']);
  const h2 = 'X-Failed-Recipients: a@b.com, c@d.com\r\nX-Failed-Recipients: e@f.com';
  assert.deepStrictEqual(extractFailedRecipients(h2), ['a@b.com', 'c@d.com', 'e@f.com']);
  assert.deepStrictEqual(extractFailedRecipients(''), []);
});

test('extractOriginalMessageId：从正文提取', () => {
  const body = '... original message ...\nMessage-ID: <abc123@smtp.example.com>\n...';
  assert.strictEqual(extractOriginalMessageId(body), '<abc123@smtp.example.com>');
  assert.strictEqual(extractOriginalMessageId('无此内容'), null);
});

test('matchBounceLog：Message-ID 优先，其次收件人地址', async () => {
  await db.query(
    `INSERT INTO email_logs (issue_id, message_id, recipients, cc, subject, status) VALUES
     (1, '<m1@local>', 'zhang@example.com', 'wang@example.com', 's1', 'sent'),
     (2, '<m2@local>', 'li@example.com', '', 's2', 'sent')`
  );
  const logs = await db.query('SELECT * FROM email_logs');

  const byId = matchBounceLog(logs, [], '<m2@local>');
  assert.strictEqual(byId.issue_id, 2);

  const byAddr = matchBounceLog(logs, ['wang@example.com'], null);
  assert.strictEqual(byAddr.issue_id, 1, '抄送地址也应能匹配');

  assert.strictEqual(matchBounceLog(logs, ['nobody@example.com'], null), null);
  assert.strictEqual(matchBounceLog(logs, [], null), null);
});
