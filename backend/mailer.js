const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { query } = require('./db');

// 模板占位符替换：{{var}} 有值则替换，未知/空值原样保留
function renderTemplate(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (m, key) => {
    const v = vars[key];
    return v !== undefined && v !== null && v !== '' ? String(v) : m;
  });
}

// ack 一次性令牌（32 位 hex）
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function isSmtpConfigured(settings) {
  return !!(settings && settings.smtp_host && settings.smtp_user && settings.smtp_pass);
}

function isImapConfigured(settings) {
  return !!(settings && settings.imap_host && settings.imap_user && settings.imap_pass);
}

const SENT_BOX_CANDIDATES = ['Sent Items', 'Sent', '已发送', 'Sent Messages', '已发送邮件'];

function normalizeBoxName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function detectSentBox(client) {
  const mailboxes = await client.list();
  const normalizedCandidates = SENT_BOX_CANDIDATES.map(normalizeBoxName);

  // 1. 优先精确匹配完整路径
  for (const candidate of normalizedCandidates) {
    const found = mailboxes.find(mb => normalizeBoxName(mb.path) === candidate);
    if (found) return found.path;
  }

  // 2. 再按层级分隔符取最后一段匹配（兼容 INBOX.Sent、~/Sent 等命名空间前缀）
  for (const candidate of normalizedCandidates) {
    const found = mailboxes.find(mb => {
      const parts = String(mb.path || '').split(/[.\\/]/).filter(Boolean);
      const lastPart = parts[parts.length - 1] || '';
      return normalizeBoxName(lastPart) === candidate;
    });
    if (found) return found.path;
  }

  return null;
}

// 每封成功邮件在后台独立建立 IMAP 连接并 append；sendMail 调用方 fire-forget 整个链路。
// 当前设计避免在批量/并发场景下管理长连接的生命周期。
// 若后续每日邮件量显著增大，可在此引入连接池或按批次复用。
async function appendSent({ settings, message }) {
  if (!isImapConfigured(settings)) return;

  const client = new ImapFlow({
    host: settings.imap_host,
    port: Number(settings.imap_port) || 993,
    secure: settings.imap_secure !== false && settings.imap_secure !== 'false',
    auth: { user: settings.imap_user, pass: settings.imap_pass },
    logger: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  try {
    await client.connect();
    const sentBox = await detectSentBox(client);
    if (!sentBox) {
      console.warn('IMAP 已发送保存跳过：未找到 Sent 文件夹');
      return;
    }
    await client.append(sentBox, message, { flags: ['\\Seen'] });
  } finally {
    try {
      await client.logout();
    } catch (logoutErr) {
      console.error('IMAP logout 失败:', logoutErr.message);
    }
  }
}

async function buildSentMime({ from, to, cc, subject, body, messageId }) {
  const composer = new MailComposer({
    from,
    to,
    cc: Array.isArray(cc) && cc.length > 0 ? cc : undefined,
    subject,
    text: body,
    messageId,
  });
  return composer.compile().build();
}

// 低层工厂：测试或特殊场景可直接调用。生产代码请通过 getTransport() 复用进程级连接池。
function createTransport(settings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: Number(settings.smtp_port) || 465,
    secure: settings.smtp_secure !== false && settings.smtp_secure !== 'false',
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 60000,
  });
}

let cachedTransport = null;
let cachedSettingsKey = null;

function smtpSettingsKey(settings) {
  // 缓存 key 不包含密码，避免凭据在内存中额外序列化；修改密码后旧连接仍会被关闭并重建
  return JSON.stringify({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_secure,
    user: settings.smtp_user,
  });
}

function getTransport(settings) {
  const key = smtpSettingsKey(settings);
  if (!cachedTransport || cachedSettingsKey !== key) {
    if (cachedTransport) {
      cachedTransport.close();
    }
    cachedTransport = createTransport(settings);
    cachedSettingsKey = key;
  }
  return cachedTransport;
}

function resetTransportCache() {
  if (cachedTransport) {
    cachedTransport.close();
    cachedTransport = null;
    cachedSettingsKey = null;
  }
}

// 发送并写日志。transport 可注入（测试用假 transport）；token 由调用方生成（渲染 ack_url 需要先拿到）。
async function sendMail({ settings, transport, to, cc, subject, body, issueId, ruleId, token, deps = {} }) {
  const appendSentFn = (deps && deps.appendSent) || appendSent;
  const getTransportFn = (deps && deps.getTransport) || getTransport;
  const toList = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
  const ccList = [...new Set((Array.isArray(cc) ? cc : [cc]).filter(Boolean))];

  if (!isSmtpConfigured(settings)) {
    const result = await query(
      `INSERT INTO email_logs (issue_id, rule_id, token, recipients, cc, subject, body, status, error_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?)`,
      [issueId || null, ruleId || null, token || null, toList.join(','), ccList.join(','),
       subject, body, 'SMTP 未配置']
    );
    return { logId: result.insertId, status: 'skipped' };
  }

  const trans = transport || getTransportFn(settings);
  let info;
  try {
    info = await trans.sendMail({
      from: settings.mail_from || settings.smtp_user,
      to: toList.join(','),
      cc: ccList.length > 0 ? ccList.join(',') : undefined,
      subject,
      text: body,
    });
  } catch (err) {
    const errorMsg = String((err && err.message) || err).slice(0, 500);
    if (!transport) {
      // 使用缓存 transport 发送失败时清掉缓存，避免死连接长期占用
      resetTransportCache();
    }
    let logId = null;
    try {
      const result = await query(
        `INSERT INTO email_logs (issue_id, rule_id, token, recipients, cc, subject, body, status, error_msg)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?)`,
        [issueId || null, ruleId || null, token || null, toList.join(','), ccList.join(','),
         subject, body, errorMsg]
      );
      logId = result.insertId;
    } catch (logErr) {
      console.error('失败日志写入失败:', logErr.message);
    }
    return { logId, status: 'failed', error: errorMsg };
  }

  // 邮件已发出：日志写入失败只记 console，绝不能误记 failed（否则下周期重复发信）
  try {
    const result = await query(
      `INSERT INTO email_logs (issue_id, rule_id, message_id, token, recipients, cc, subject, body, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent')`,
      [issueId || null, ruleId || null, info.messageId || null, token || null,
       toList.join(','), ccList.join(','), subject, body]
    );
    const sentResult = { logId: result.insertId, status: 'sent', messageId: info.messageId };
    // 异步保存到 IMAP 已发送，不阻塞响应；MIME 构建失败也不得影响 sent 结果
    if (isImapConfigured(settings)) {
      buildSentMime({ from: settings.mail_from || settings.smtp_user, to: toList, cc: ccList, subject, body, messageId: info.messageId })
        .then(raw => appendSentFn({ settings, message: raw }))
        .catch(err => {
          console.error('保存到 IMAP 已发送失败:', err.message);
        });
    }
    return sentResult;
  } catch (logErr) {
    console.error('发送日志写入失败（邮件已发送）:', logErr.message);
    return { logId: null, status: 'sent', messageId: info.messageId };
  }
}

module.exports = {
  renderTemplate, generateToken, isSmtpConfigured, isImapConfigured,
  createTransport, getTransport, resetTransportCache, detectSentBox, appendSent, sendMail,
};
