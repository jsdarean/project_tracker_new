const { ImapFlow } = require('imapflow');
const { query } = require('./db');

/* ---------- 纯函数（可脱离 IMAP 单测） ---------- */

// 退信判定：发件人为 MAILER-DAEMON/postmaster，或主题含常见退信关键词
function isBounce(envelope) {
  const from = ((envelope && envelope.from && envelope.from.address) || '').toLowerCase();
  const subject = (envelope && envelope.subject) || '';
  return (
    from.includes('mailer-daemon') ||
    from.includes('postmaster') ||
    /undelivered|delivery status notification|failure notice|退信|无法投递|投递失败/i.test(subject)
  );
}

// 从原始头提取 X-Failed-Recipients（可多行、逗号分隔）
function extractFailedRecipients(rawHeaders) {
  const result = [];
  const re = /x-failed-recipients:\s*([^\r\n]+)/gi;
  let m;
  while ((m = re.exec(String(rawHeaders || ''))) !== null) {
    for (const addr of m[1].split(',')) {
      const v = addr.trim();
      if (v) result.push(v);
    }
  }
  return result;
}

// 从退信正文提取原邮件 Message-ID
function extractOriginalMessageId(bodyText) {
  const m = String(bodyText || '').match(/Message-ID:\s*(<[^>]+>)/i);
  return m ? m[1] : null;
}

// 匹配近 7 天日志：先按 Message-ID 精确匹配，再按退信地址在收件人/抄送中查找
function matchBounceLog(logs, failedRecipients, messageId) {
  if (messageId) {
    const hit = logs.find((l) => l.message_id && l.message_id === messageId);
    if (hit) return hit;
  }
  for (const addr of failedRecipients) {
    const hit = logs.find((l) => `${l.recipients || ''},${l.cc || ''}`.includes(addr));
    if (hit) return hit;
  }
  return null;
}

/* ---------- 扫描（生产路径；自动化测试只测纯函数与匹配回写逻辑） ---------- */

async function scanBounces(settings, deps = {}) {
  const { loadSettingsFn, saveSettingsFn } = deps;
  const result = { scanned: 0, bounced: 0 };
  if (!settings.bounce_scan_enabled) return result;
  if (!settings.imap_host || !settings.imap_user || !settings.imap_pass) {
    console.error('退信扫描：IMAP 未配置');
    return result;
  }

  const client = new ImapFlow({
    host: settings.imap_host,
    port: Number(settings.imap_port) || 993,
    secure: settings.imap_secure !== false && settings.imap_secure !== 'false',
    auth: { user: settings.imap_user, pass: settings.imap_pass },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock(settings.imap_mailbox || 'INBOX');
    try {
      const uidValidity = String(client.mailbox.uidValidity);
      let uids;
      if (settings.imap_last_uid && settings.imap_uidvalidity === uidValidity) {
        uids = await client.search({ uid: `${Number(settings.imap_last_uid) + 1}:*` }, { uid: true });
      } else {
        // 首次或 UIDVALIDITY 失效：只扫最近 3 天
        uids = await client.search({ since: new Date(Date.now() - 3 * 86400000) }, { uid: true });
      }
      if (!uids || uids.length === 0) return result;

      let maxUid = Number(settings.imap_last_uid) || 0;
      for await (const msg of client.fetch(uids, { envelope: true, headers: true, bodyParts: ['text'] })) {
        result.scanned += 1;
        maxUid = Math.max(maxUid, msg.uid);
        if (!isBounce(msg.envelope)) continue;

        const rawHeaders = msg.headers ? msg.headers.toString() : '';
        const bodyPart = msg.bodyParts && msg.bodyParts.get('text');
        const bodyText = bodyPart ? bodyPart.toString() : '';
        const failedRecipients = extractFailedRecipients(rawHeaders);
        const messageId = extractOriginalMessageId(bodyText);

        const logs = await query(
          `SELECT * FROM email_logs WHERE sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status != 'bounced'`
        );
        const hit = matchBounceLog(logs, failedRecipients, messageId);
        if (hit) {
          const reason = bodyText.replace(/\s+/g, ' ').slice(0, 500) || '邮件退信';
          await query(`UPDATE email_logs SET status = 'bounced', error_msg = ? WHERE id = ?`, [reason, hit.id]);
          result.bounced += 1;
        }
      }

      // 推进收信状态（若调用方提供了存取函数）
      if (loadSettingsFn && saveSettingsFn && maxUid > (Number(settings.imap_last_uid) || 0)) {
        const latest = await loadSettingsFn();
        latest.imap_last_uid = maxUid;
        latest.imap_uidvalidity = uidValidity;
        await saveSettingsFn(latest);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return result;
}

module.exports = { isBounce, extractFailedRecipients, extractOriginalMessageId, matchBounceLog, scanBounces };
