const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_engine');
const {
  ruleMatches, addDays, daysBetween, resolveRoleEmails, recentlyBlocked,
  runDailyEscalation, runWeeklyProgressReminder,
} = require('../escalation');

let baseUrl;
let projectId;

const TODAY = '2026-08-10'; // 周一

function makeDeps(calls) {
  return {
    now: new Date(2026, 7, 10, 9, 0, 0), // 2026-08-10 周一 09:00 本地
    sendMailFn: async (args) => { calls.push(args); return { logId: 1, status: 'sent' }; },
  };
}

test.before(async () => {
  ({ baseUrl } = await setup());
  const r = await db.query(
    `INSERT INTO projects (project_name, project_manager, project_status) VALUES ('引擎项目', '王经理', '进行中')`
  );
  projectId = r.insertId;
  await db.query(`INSERT INTO contacts (name, email) VALUES ('张三', 'zhangsan@example.com'), ('王经理', 'wang@example.com')`);
});
test.after(() => teardown());

async function seedIssue(overrides = {}) {
  const data = {
    issue_no: `ISS-T${Math.floor(Math.random() * 1e6)}`,
    project_id: projectId, title: '引擎测试问题', severity: '一般', status: '处理中',
    assignee: '张三', due_date: null, escalation_muted: 0, ...overrides,
  };
  const keys = Object.keys(data);
  const r = await db.query(
    `INSERT INTO issues (${keys.map((k) => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map((k) => data[k])
  );
  return r.insertId;
}

async function seedRule(overrides = {}) {
  const data = {
    name: '测试规则', severity: null, days_before_due: null, days_after_due: 1,
    to_roles: 'assignee', cc_roles: null, template_code: null, enabled: 1, min_interval_hours: 24,
    ...overrides,
  };
  const keys = Object.keys(data);
  const r = await db.query(
    `INSERT INTO escalation_rules (${keys.map((k) => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map((k) => data[k])
  );
  return r.insertId;
}

test('ruleMatches：临期/逾期/severity/无 due_date', () => {
  const rule = { severity: null, days_before_due: 2, days_after_due: null };
  assert.strictEqual(ruleMatches(rule, { due_date: '2026-08-12', severity: '一般' }, TODAY), true);
  assert.strictEqual(ruleMatches(rule, { due_date: '2026-08-13', severity: '一般' }, TODAY), false);
  assert.strictEqual(ruleMatches(rule, { due_date: null, severity: '一般' }, TODAY), false);

  const overdue = { severity: '重要', days_before_due: null, days_after_due: 3 };
  assert.strictEqual(ruleMatches(overdue, { due_date: '2026-08-07', severity: '重要' }, TODAY), true);
  assert.strictEqual(ruleMatches(overdue, { due_date: '2026-08-08', severity: '重要' }, TODAY), false);
  assert.strictEqual(ruleMatches(overdue, { due_date: '2026-08-07', severity: '一般' }, TODAY), false, 'severity 不匹配');
});

test('addDays / daysBetween 日历天运算', () => {
  assert.strictEqual(addDays('2026-08-10', 2), '2026-08-12');
  assert.strictEqual(addDays('2026-08-31', 1), '2026-09-01');
  assert.strictEqual(daysBetween('2026-08-07', '2026-08-10'), 3);
});

test('resolveRoleEmails：assignee/manager 走 contacts，leader 走配置，缺失记录', async () => {
  const issue = { assignee: '张三', project_manager: '王经理' };
  const r1 = await resolveRoleEmails(issue, ['assignee', 'manager', 'leader'], { leader_emails: 'boss@example.com' });
  assert.deepStrictEqual(r1.emails.sort(), ['boss@example.com', 'wang@example.com', 'zhangsan@example.com']);
  assert.deepStrictEqual(r1.missing, []);

  const r2 = await resolveRoleEmails({ assignee: '不存在的人', project_manager: null }, ['assignee', 'leader'], {});
  assert.deepStrictEqual(r2.emails, []);
  assert.strictEqual(r2.missing.length, 2);
});

test('recentlyBlocked：sent 按规则间隔，failed 1 小时', async () => {
  const issueId = await seedIssue();
  const ruleId = await seedRule();
  const now = new Date(2026, 7, 10, 9, 0, 0);

  assert.strictEqual(await recentlyBlocked(issueId, ruleId, 24, now), false, '无日志不阻止');

  await db.query(
    `INSERT INTO email_logs (issue_id, rule_id, recipients, subject, status, sent_at) VALUES (?, ?, 'a@b.c', 's', 'sent', '2026-08-10 08:00:00')`,
    [issueId, ruleId]
  );
  assert.strictEqual(await recentlyBlocked(issueId, ruleId, 24, now), true, '1 小时内的 sent 应阻止');

  await db.query(`DELETE FROM email_logs WHERE issue_id = ?`, [issueId]);
  await db.query(
    `INSERT INTO email_logs (issue_id, rule_id, recipients, subject, status, sent_at) VALUES (?, ?, 'a@b.c', 's', 'failed', '2026-08-10 08:30:00')`,
    [issueId, ruleId]
  );
  assert.strictEqual(await recentlyBlocked(issueId, ruleId, 24, now), true, '30 分钟内的 failed 应阻止');
  await db.query(`UPDATE email_logs SET sent_at = '2026-08-10 07:00:00' WHERE issue_id = ?`, [issueId]);
  assert.strictEqual(await recentlyBlocked(issueId, ruleId, 24, now), false, '1 小时前的 failed 不阻止');
});

test('runDailyEscalation：命中规则发信、防重、muted/终态排除、邮箱缺失 skipped', async () => {
  const calls = [];
  const settings = { escalation_enabled: true, send_on_weekend: true, leader_emails: '', public_base_url: 'http://localhost:3000' };

  // 隔离：禁用迁移种子规则与前序用例规则，只保留本用例规则（否则种子「逾期 1 天」规则会额外命中发信）
  await db.query(`UPDATE escalation_rules SET enabled = 0`);

  const hitIssue = await seedIssue({ title: '命中问题', due_date: '2026-08-09' }); // 逾期 1 天
  const mutedIssue = await seedIssue({ title: '暂停问题', due_date: '2026-08-09', escalation_muted: 1 });
  const closedIssue = await seedIssue({ title: '已解决问题', due_date: '2026-08-09', status: '已解决' });
  const noEmailIssue = await seedIssue({ title: '无邮箱问题', due_date: '2026-08-09', assignee: '查无此人' });
  const ruleId = await seedRule({ days_after_due: 1, to_roles: 'assignee' });

  const stats = await runDailyEscalation(settings, makeDeps(calls));
  assert.strictEqual(calls.length, 1, '只有命中问题应发信');
  assert.deepStrictEqual(calls[0].to, ['zhangsan@example.com']);
  assert.ok(calls[0].body.includes('命中问题'));
  assert.ok(calls[0].body.includes('http://localhost:3000/api/issues/'));
  assert.ok(calls[0].body.includes('token='));
  assert.ok(stats.sent >= 1);
  assert.ok(stats.skipped >= 1, '无邮箱问题应记 skipped');

  // 再次运行：recentlyBlocked 阻止（sendMailFn 是假的没写日志——补一条 sent 日志模拟，rule_id/sent_at 须与防重口径一致）
  await db.query(
    `INSERT INTO email_logs (issue_id, rule_id, recipients, subject, status, sent_at) VALUES (?, ?, 'z', 's', 'sent', '2026-08-10 08:00:00')`,
    [hitIssue, ruleId]
  );
  const calls2 = [];
  const stats2 = await runDailyEscalation(settings, makeDeps(calls2));
  assert.strictEqual(calls2.length, 0, '命中问题被防重，无邮箱问题只记 skipped 不发信');
  assert.ok(!calls2.some(c => c.body.includes('命中问题')), '命中问题 24h 内不重复发');
  assert.ok(stats2.skipped >= 1, '无邮箱问题再次记 skipped');
});

test('runDailyEscalation：总开关关闭/周末不发送直接返回', async () => {
  const calls = [];
  await runDailyEscalation({ escalation_enabled: false }, makeDeps(calls));
  assert.strictEqual(calls.length, 0);

  const weekendDeps = {
    now: new Date(2026, 7, 9, 9, 0, 0), // 2026-08-09 周日
    sendMailFn: async (a) => { calls.push(a); return { logId: 1, status: 'sent' }; },
  };
  await runDailyEscalation({ escalation_enabled: true, send_on_weekend: false }, weekendDeps);
  assert.strictEqual(calls.length, 0);
});

test('runWeeklyProgressReminder：有 stale 才发，leader 为空 skipped', async () => {
  // 当前 projectId 项目从未填报进展 → stale
  const calls = [];
  const deps = makeDeps(calls);
  const stats = await runWeeklyProgressReminder(
    { escalation_enabled: true, leader_emails: 'boss@example.com' }, deps
  );
  assert.ok(stats.stale >= 1);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].to, ['boss@example.com']);
  assert.ok(calls[0].body.includes('引擎项目'));
  assert.ok(calls[0].body.includes('从未填报'));

  const calls2 = [];
  const stats2 = await runWeeklyProgressReminder(
    { escalation_enabled: true, leader_emails: '' }, makeDeps(calls2)
  );
  assert.strictEqual(calls2.length, 0);
  assert.ok(stats2.skipped >= 1);
});

test('runDailyEscalation：单问题发信抛异常不中断整批', async () => {
  await db.query('DELETE FROM escalation_rules');
  await db.query('DELETE FROM issues');

  await seedIssue({ title: '异常问题', due_date: '2026-08-09' });
  await seedIssue({ title: '正常问题', due_date: '2026-08-09' });
  await seedRule({ days_after_due: 1, to_roles: 'assignee' });

  const calls = [];
  let thrown = false;
  const deps = {
    now: new Date(2026, 7, 10, 9, 0, 0),
    sendMailFn: async (args) => {
      if (!thrown && args.body.includes('异常问题')) {
        thrown = true;
        throw new Error('模拟 DB 抖动');
      }
      calls.push(args);
      return { logId: 1, status: 'sent' };
    },
  };
  const stats = await runDailyEscalation(
    { escalation_enabled: true, send_on_weekend: true, public_base_url: 'http://localhost:3000' },
    deps
  );
  assert.strictEqual(stats.failed, 1, '异常问题应计 failed');
  assert.strictEqual(calls.length, 1, '正常问题应继续处理并发信');
  assert.ok(!calls[0].body.includes('异常问题'), '成功发出的不应是异常问题');
});
