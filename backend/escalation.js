const cron = require('node-cron');
const { query } = require('./db');
const { loadSettings, saveSettings } = require('./settings-store');
const mailer = require('./mailer');
const { scanBounces } = require('./bounce-scanner');

const ROLE_VALUES = ['assignee', 'manager', 'leader'];
const CLOSED_STATUSES = ['已解决', '已关闭'];

/* ---------- 日期辅助（本地时区，YYYY-MM-DD 字符串运算） ---------- */
function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayLocal() { return fmtDate(new Date()); }
function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
function daysBetween(fromStr, toStr) {
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}
function parseDateTime(s) {
  // MySQL dateStrings 返回 'YYYY-MM-DD HH:MM:SS'，按本地时区解析
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return new Date(s);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/* ---------- 规则匹配（纯函数） ---------- */
function ruleMatches(rule, issue, todayStr) {
  if (rule.severity && rule.severity !== issue.severity) return false;
  if (!issue.due_date) return false;
  if (rule.days_before_due !== null && rule.days_before_due !== undefined) {
    if (issue.due_date === addDays(todayStr, rule.days_before_due)) return true;
  }
  if (rule.days_after_due !== null && rule.days_after_due !== undefined) {
    if (daysBetween(issue.due_date, todayStr) >= rule.days_after_due) return true;
  }
  return false;
}

/* ---------- 防重：sent/bounced 按规则间隔，failed 1 小时，skipped 不阻止 ---------- */
async function recentlyBlocked(issueId, ruleId, minHours, now) {
  const rows = await query(
    `SELECT status, sent_at FROM email_logs WHERE issue_id = ? AND rule_id = ? ORDER BY sent_at DESC LIMIT 1`,
    [issueId, ruleId]
  );
  if (rows.length === 0) return false;
  const last = rows[0];
  const hours = (now.getTime() - parseDateTime(last.sent_at).getTime()) / 3600000;
  if (last.status === 'sent' || last.status === 'bounced') return hours < minHours;
  if (last.status === 'failed') return hours < 1;
  return false;
}

/* ---------- 收件人三级解析 ---------- */
async function findContactEmail(name) {
  if (!name) return null;
  const rows = await query(
    `SELECT email FROM contacts WHERE name = ? AND email IS NOT NULL AND email != '' LIMIT 1`,
    [name]
  );
  return rows.length > 0 ? rows[0].email : null;
}

async function resolveRoleEmails(issue, roles, settings) {
  const emails = new Set();
  const missing = [];
  for (const role of roles) {
    if (role === 'assignee') {
      const email = await findContactEmail(issue.assignee);
      if (email) emails.add(email);
      else missing.push(`责任人(${issue.assignee || '未填'})`);
    } else if (role === 'manager') {
      const email = await findContactEmail(issue.project_manager);
      if (email) emails.add(email);
      else missing.push(`项目经理(${issue.project_manager || '未填'})`);
    } else if (role === 'leader') {
      const leaders = String(settings.leader_emails || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (leaders.length > 0) leaders.forEach((e) => emails.add(e));
      else missing.push('领导邮箱(未配置)');
    }
  }
  return { emails: [...emails], missing };
}

const DEFAULT_ISSUE_TEMPLATE = {
  subject: '【项目问题催办】{{issue_no}} {{title}}',
  body: '问题编号：{{issue_no}}\n问题标题：{{title}}\n所属项目：{{project_name}}\n责任人：{{assignee}}\n期望解决日期：{{due_date}}\n逾期天数：{{overdue_days}}\n\n问题链接：{{detail_url}}\n我已处理：{{ack_url}}\n',
};
const DEFAULT_PROGRESS_TEMPLATE = {
  subject: '【进展提醒】以下项目超过 14 天未更新进展',
  body: '以下项目超过 14 天未更新进展（或从未填报），请提醒项目经理及时填报：\n\n{{stale_projects}}\n\n项目跟踪系统',
};

function isEnabled(settings) {
  return !!settings.escalation_enabled && settings.escalation_enabled !== 'false';
}

/* ---------- 每日催办 ---------- */
async function runDailyEscalation(settings, deps = {}) {
  const sendMailFn = deps.sendMailFn || mailer.sendMail;
  const now = deps.now || new Date();
  const stats = { scanned: 0, matched: 0, sent: 0, skipped: 0, failed: 0 };

  if (!isEnabled(settings)) return stats;
  const day = now.getDay();
  if ((day === 0 || day === 6) && !settings.send_on_weekend) return stats;

  const todayStr = fmtDate(now);
  const issues = await query(
    `SELECT issues.*, p.project_name, p.project_manager
     FROM issues JOIN projects p ON p.id = issues.project_id
     WHERE issues.escalation_muted = 0 AND issues.status NOT IN ('已解决','已关闭')`
  );
  const rules = await query('SELECT * FROM escalation_rules WHERE enabled = 1');
  const templates = await query('SELECT * FROM email_templates');
  const templateMap = {};
  for (const t of templates) templateMap[t.code] = t;

  for (const issue of issues) {
    stats.scanned += 1;
    for (const rule of rules) {
      if (!ruleMatches(rule, issue, todayStr)) continue;
      stats.matched += 1;
      if (await recentlyBlocked(issue.id, rule.id, rule.min_interval_hours || 24, now)) continue;

      const toRoles = String(rule.to_roles || '').split(',').map((s) => s.trim()).filter(Boolean);
      const ccRoles = String(rule.cc_roles || '').split(',').map((s) => s.trim()).filter(Boolean);
      const to = await resolveRoleEmails(issue, toRoles, settings);
      const cc = await resolveRoleEmails(issue, ccRoles, settings);

      if (to.emails.length === 0 && cc.emails.length === 0) {
        await query(
          `INSERT INTO email_logs (issue_id, rule_id, recipients, cc, subject, body, status, error_msg)
           VALUES (?, ?, '', '', ?, '', 'skipped', ?)`,
          [issue.id, rule.id, `规则「${rule.name}」`, `邮箱缺失：${[...to.missing, ...cc.missing].join('、')}`]
        );
        stats.skipped += 1;
        continue;
      }

      const template = templateMap[rule.template_code] || DEFAULT_ISSUE_TEMPLATE;
      const baseUrl = String(settings.public_base_url || 'http://localhost:3000').replace(/\/$/, '');
      const token = mailer.generateToken();
      const overdueDays = Math.max(0, daysBetween(issue.due_date, todayStr));
      const vars = {
        issue_no: issue.issue_no,
        title: issue.title,
        assignee: issue.assignee || '',
        due_date: issue.due_date || '',
        overdue_days: overdueDays,
        project_name: issue.project_name || '',
        detail_url: `${baseUrl}/issue_detail.html?id=${issue.id}`,
        ack_url: `${baseUrl}/api/issues/${issue.id}/ack?token=${token}`,
      };
      const result = await sendMailFn({
        settings,
        to: to.emails,
        cc: cc.emails,
        subject: mailer.renderTemplate(template.subject, vars),
        body: mailer.renderTemplate(template.body, vars),
        issueId: issue.id,
        ruleId: rule.id,
        token,
      });
      if (result.status === 'sent') stats.sent += 1;
      else if (result.status === 'skipped') stats.skipped += 1;
      else stats.failed += 1;
    }
  }
  return stats;
}

/* ---------- 每周进展提醒 ---------- */
async function runWeeklyProgressReminder(settings, deps = {}) {
  const sendMailFn = deps.sendMailFn || mailer.sendMail;
  const stats = { stale: 0, sent: 0, skipped: 0, failed: 0 };
  if (!isEnabled(settings)) return stats;

  const stale = await query(
    `SELECT p.id AS project_id, p.project_name,
            (SELECT MAX(report_date) FROM project_progress pp WHERE pp.project_id = p.id) AS last_progress_date,
            DATEDIFF(CURDATE(), (SELECT MAX(report_date) FROM project_progress pp WHERE pp.project_id = p.id)) AS days_stale
     FROM projects p
     WHERE (p.project_status IS NULL OR p.project_status != '已结项')
       AND (
         NOT EXISTS (SELECT 1 FROM project_progress pp WHERE pp.project_id = p.id)
         OR DATEDIFF(CURDATE(), (SELECT MAX(report_date) FROM project_progress pp WHERE pp.project_id = p.id)) > 14
       )
     ORDER BY last_progress_date ASC, p.id ASC`
  );
  stats.stale = stale.length;
  if (stale.length === 0) return stats;

  const leaders = String(settings.leader_emails || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (leaders.length === 0) {
    await query(
      `INSERT INTO email_logs (issue_id, rule_id, recipients, cc, subject, body, status, error_msg)
       VALUES (NULL, NULL, '', '', '每周进展提醒', '', 'skipped', '领导邮箱未配置')`
    );
    stats.skipped += 1;
    return stats;
  }

  const templates = await query(`SELECT * FROM email_templates WHERE code = 'progress_reminder'`);
  const template = templates[0] || DEFAULT_PROGRESS_TEMPLATE;
  const lines = stale.map((s) =>
    s.last_progress_date ? `${s.project_name}（${s.days_stale} 天未更新）` : `${s.project_name}（从未填报）`
  );
  const vars = { stale_projects: lines.join('\n') };
  const result = await sendMailFn({
    settings,
    to: leaders,
    cc: [],
    subject: mailer.renderTemplate(template.subject, vars),
    body: mailer.renderTemplate(template.body, vars),
    issueId: null,
    ruleId: null,
    token: null,
  });
  if (result.status === 'sent') stats.sent += 1;
  else if (result.status === 'skipped') stats.skipped += 1;
  else stats.failed += 1;
  return stats;
}

/* ---------- cron 注册（三任务，北京时区） ---------- */
function startCron(settings) {
  const register = (expr, name, fn) => {
    if (!cron.validate(expr)) {
      console.error(`定时任务 ${name} 的 cron 表达式非法，已禁用: ${expr}`);
      return;
    }
    cron.schedule(expr, async () => {
      try {
        const latest = await loadSettings();
        await fn(latest);
      } catch (err) {
        console.error(`定时任务 ${name} 执行失败:`, err.message);
      }
    }, { timezone: 'Asia/Shanghai' });
    console.log(`定时任务已注册: ${name} (${expr}, Asia/Shanghai)`);
  };

  register(settings.cron_daily || '0 9 * * *', '每日问题催办', runDailyEscalation);
  register(settings.cron_weekly || '0 9 * * 1', '每周进展提醒', runWeeklyProgressReminder);
  register(settings.cron_bounce || '*/30 * * * *', '退信扫描', async (latest) => {
    if (!latest.bounce_scan_enabled) return;
    const result = await scanBounces(latest, { loadSettingsFn: loadSettings, saveSettingsFn: saveSettings });
    if (result.bounced > 0) console.log(`退信扫描：回写 ${result.bounced} 条 bounced`);
  });
}

module.exports = {
  ruleMatches, addDays, daysBetween, fmtDate, todayLocal, parseDateTime,
  resolveRoleEmails, recentlyBlocked,
  runDailyEscalation, runWeeklyProgressReminder, startCron,
  ROLE_VALUES, CLOSED_STATUSES,
};
