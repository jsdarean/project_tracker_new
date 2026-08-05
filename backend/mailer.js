const nodemailer = require('nodemailer');
const crypto = require('crypto');
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

function createTransport(settings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: Number(settings.smtp_port) || 465,
    secure: settings.smtp_secure !== false && settings.smtp_secure !== 'false',
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  });
}

// 发送并写日志。transport 可注入（测试用假 transport）；token 由调用方生成（渲染 ack_url 需要先拿到）。
async function sendMail({ settings, transport, to, cc, subject, body, issueId, ruleId, token }) {
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

  const trans = transport || createTransport(settings);
  try {
    const info = await trans.sendMail({
      from: settings.mail_from || settings.smtp_user,
      to: toList.join(','),
      cc: ccList.length > 0 ? ccList.join(',') : undefined,
      subject,
      text: body,
    });
    const result = await query(
      `INSERT INTO email_logs (issue_id, rule_id, message_id, token, recipients, cc, subject, body, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent')`,
      [issueId || null, ruleId || null, info.messageId || null, token || null,
       toList.join(','), ccList.join(','), subject, body]
    );
    return { logId: result.insertId, status: 'sent', messageId: info.messageId };
  } catch (err) {
    const errorMsg = String((err && err.message) || err).slice(0, 500);
    const result = await query(
      `INSERT INTO email_logs (issue_id, rule_id, token, recipients, cc, subject, body, status, error_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?)`,
      [issueId || null, ruleId || null, token || null, toList.join(','), ccList.join(','),
       subject, body, errorMsg]
    );
    return { logId: result.insertId, status: 'failed', error: errorMsg };
  }
}

module.exports = { renderTemplate, generateToken, isSmtpConfigured, sendMail };
