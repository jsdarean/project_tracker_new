const express = require('express');
const { query } = require('../db');
const { loadSettings } = require('../settings-store');
const { sendMail } = require('../mailer');
const { runDailyEscalation, ROLE_VALUES, CLOSED_STATUSES } = require('../escalation');

const router = express.Router();

function validateRule(data, isPartial) {
  if (!isPartial && (!data.name || !String(data.name).trim())) return 'name 必填';
  const hasBefore = data.days_before_due !== undefined && data.days_before_due !== null && data.days_before_due !== '';
  const hasAfter = data.days_after_due !== undefined && data.days_after_due !== null && data.days_after_due !== '';
  if (!isPartial && !hasBefore && !hasAfter) return 'days_before_due 和 days_after_due 至少填一个';
  for (const [key, present] of [['days_before_due', hasBefore], ['days_after_due', hasAfter]]) {
    if (present) {
      const n = Number(data[key]);
      if (!Number.isInteger(n) || n < 0) return `${key} 必须是非负整数`;
    }
  }
  if (!isPartial || data.to_roles !== undefined) {
    const roles = String(data.to_roles || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (roles.length === 0) return 'to_roles 至少选择一个收件人角色';
    const bad = roles.filter((r) => !ROLE_VALUES.includes(r));
    if (bad.length > 0) return `to_roles 含非法值：${bad.join('、')}`;
  }
  if (data.cc_roles) {
    const roles = String(data.cc_roles).split(',').map((s) => s.trim()).filter(Boolean);
    const bad = roles.filter((r) => !ROLE_VALUES.includes(r));
    if (bad.length > 0) return `cc_roles 含非法值：${bad.join('、')}`;
  }
  return null;
}

const RULE_FIELDS = ['name', 'severity', 'days_before_due', 'days_after_due', 'to_roles', 'cc_roles', 'template_code', 'enabled', 'min_interval_hours'];

/* ---------- 规则管理 ---------- */
router.get('/api/escalation/rules', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM escalation_rules ORDER BY id ASC');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: '查询规则失败', message: err.message });
  }
});

router.post('/api/escalation/rules', async (req, res) => {
  try {
    const data = req.body || {};
    const invalid = validateRule(data, false);
    if (invalid) return res.status(400).json({ error: '参数校验失败', message: invalid });
    if (data.template_code) {
      const tpl = await query('SELECT id FROM email_templates WHERE code = ?', [data.template_code]);
      if (tpl.length === 0) return res.status(400).json({ error: '参数校验失败', message: `模板不存在：${data.template_code}` });
    }
    const fields = RULE_FIELDS.filter((f) => data[f] !== undefined);
    const result = await query(
      `INSERT INTO escalation_rules (${fields.map((f) => `\`${f}\``).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
      fields.map((f) => (data[f] === '' ? null : data[f]))
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: '创建规则失败', message: err.message });
  }
});

router.put('/api/escalation/rules/:id', async (req, res) => {
  try {
    const data = req.body || {};
    const invalid = validateRule(data, true);
    if (invalid) return res.status(400).json({ error: '参数校验失败', message: invalid });
    if (data.template_code) {
      const tpl = await query('SELECT id FROM email_templates WHERE code = ?', [data.template_code]);
      if (tpl.length === 0) return res.status(400).json({ error: '参数校验失败', message: `模板不存在：${data.template_code}` });
    }
    const existing = await query('SELECT id FROM escalation_rules WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: '规则不存在' });

    const fields = RULE_FIELDS.filter((f) => data[f] !== undefined);
    if (fields.length === 0) return res.status(400).json({ error: '没有可更新字段' });
    await query(
      `UPDATE escalation_rules SET ${fields.map((f) => `\`${f}\` = ?`).join(',')} WHERE id = ?`,
      [...fields.map((f) => (data[f] === '' ? null : data[f])), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新规则失败', message: err.message });
  }
});

router.delete('/api/escalation/rules/:id', async (req, res) => {
  try {
    const existing = await query('SELECT id FROM escalation_rules WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: '规则不存在' });
    await query('DELETE FROM escalation_rules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除规则失败', message: err.message });
  }
});

/* ---------- 模板管理 ---------- */
router.get('/api/escalation/templates', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM email_templates ORDER BY id ASC');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: '查询模板失败', message: err.message });
  }
});

router.put('/api/escalation/templates/:id', async (req, res) => {
  try {
    const data = req.body || {};
    const fields = ['name', 'subject', 'body'].filter((f) => data[f] !== undefined);
    if (fields.length === 0) return res.status(400).json({ error: '没有可更新字段' });
    const existing = await query('SELECT id FROM email_templates WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: '模板不存在' });
    await query(
      `UPDATE email_templates SET ${fields.map((f) => `\`${f}\` = ?`).join(',')} WHERE id = ?`,
      [...fields.map((f) => data[f]), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新模板失败', message: err.message });
  }
});

/* ---------- 发送日志 ---------- */
router.get('/api/escalation/logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * size;

    let where = ' WHERE 1=1';
    const params = [];
    if (req.query.issue_id) {
      where += ' AND l.issue_id = ?';
      params.push(req.query.issue_id);
    }
    if (req.query.status) {
      where += ' AND l.status = ?';
      params.push(req.query.status);
    }
    if (req.query.from) {
      where += ' AND l.sent_at >= ?';
      params.push(req.query.from);
    }
    if (req.query.to) {
      where += ' AND l.sent_at <= ?';
      params.push(req.query.to + ' 23:59:59');
    }

    const rows = await query(
      `SELECT l.*, i.issue_no FROM email_logs l
       LEFT JOIN issues i ON i.id = l.issue_id
       ${where}
       ORDER BY l.sent_at DESC LIMIT ${size} OFFSET ${offset}`,
      params
    );
    const [countRow] = await query(`SELECT COUNT(*) AS total FROM email_logs l${where}`, params);
    res.json({ success: true, data: rows, total: countRow.total });
  } catch (err) {
    res.status(500).json({ error: '查询日志失败', message: err.message });
  }
});

/* ---------- 暂停/恢复催办 ---------- */
router.put('/api/issues/:id/escalation-muted', async (req, res) => {
  try {
    const muted = (req.body || {}).muted ? 1 : 0;
    const existing = await query('SELECT id FROM issues WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: '问题不存在' });
    await query('UPDATE issues SET escalation_muted = ? WHERE id = ?', [muted, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新催办状态失败', message: err.message });
  }
});

/* ---------- 测试邮件与手动触发 ---------- */
router.post('/api/escalation/test-mail', async (req, res) => {
  try {
    const to = String((req.body || {}).to || '').trim();
    if (!to) return res.status(400).json({ error: '参数校验失败', message: 'to 必填' });
    const settings = await loadSettings();
    const result = await sendMail({
      settings,
      to: [to],
      cc: [],
      subject: '【项目跟踪】SMTP 测试邮件',
      body: '这是一封测试邮件，用于验证 SMTP 配置。收到即表示配置正确。',
    });
    if (result.status === 'sent') return res.json({ success: true, messageId: result.messageId });
    return res.status(400).json({ error: '发送失败', message: result.error || 'SMTP 未配置' });
  } catch (err) {
    res.status(500).json({ error: '发送测试邮件失败', message: err.message });
  }
});

router.post('/api/escalation/run-now', async (req, res) => {
  try {
    const settings = await loadSettings();
    const stats = await runDailyEscalation(settings);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ error: '手动扫描失败', message: err.message });
  }
});

/* ---------- 我已处理（ack） ---------- */
function ackPage(title, message) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title></head>` +
    `<body style="font-family:sans-serif;text-align:center;padding:60px 20px;">` +
    `<h2>${title}</h2><p>${message}</p><p style="color:#999;font-size:13px;">本页面可关闭。</p></body></html>`;
}

router.get('/api/issues/:id/ack', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const issueRows = await query('SELECT * FROM issues WHERE id = ?', [req.params.id]);
    if (issueRows.length === 0) {
      return res.status(404).send(ackPage('链接无效', '问题不存在或链接已失效。'));
    }
    const issue = issueRows[0];
    const logRows = token
      ? await query('SELECT * FROM email_logs WHERE issue_id = ? AND token = ? ORDER BY id DESC LIMIT 1', [req.params.id, token])
      : [];
    if (logRows.length === 0) {
      return res.status(404).send(ackPage('链接无效或已使用', '该确认链接无效或已被使用。'));
    }
    if (CLOSED_STATUSES.includes(issue.status)) {
      return res.send(ackPage('问题已关闭', `问题 ${issue.issue_no} 已处于「${issue.status}」状态，无需操作。`));
    }
    await query(`UPDATE issues SET status = '处理中' WHERE id = ?`, [req.params.id]);
    await query(
      'INSERT INTO issue_comments (issue_id, content, author) VALUES (?, ?, ?)',
      [req.params.id, '（通过邮件快捷链接确认已收到）', '系统']
    );
    await query('UPDATE email_logs SET token = NULL WHERE id = ?', [logRows[0].id]);
    return res.send(ackPage('已确认', `问题 ${issue.issue_no} 已置为「处理中」。`));
  } catch (err) {
    console.error('ack 处理失败:', err);
    return res.status(500).send(ackPage('系统错误', '处理失败，请稍后重试。'));
  }
});

module.exports = router;
