const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_escalation');

let baseUrl;
let projectId;

test.before(async () => {
  ({ baseUrl } = await setup());
  const r = await db.query(`INSERT INTO projects (project_name, project_status) VALUES ('催办项目', '进行中')`);
  projectId = r.insertId;
});
test.after(() => teardown());

async function createRule(overrides = {}) {
  return fetch(`${baseUrl}/api/escalation/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '测试规则', days_after_due: 1, to_roles: 'assignee', ...overrides,
    }),
  });
}

async function createIssue(overrides = {}) {
  const resp = await fetch(`${baseUrl}/api/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, title: '催办问题', ...overrides }),
  });
  return (await resp.json()).id;
}

test('rules CRUD 与校验', async () => {
  const ok = await createRule();
  assert.strictEqual(ok.status, 200);
  const ruleId = (await ok.json()).id;

  const noDays = await createRule({ days_before_due: null, days_after_due: null });
  assert.strictEqual(noDays.status, 400, '两日期全空应 400');

  const badRole = await createRule({ to_roles: 'nobody' });
  assert.strictEqual(badRole.status, 400);

  const badTemplate = await createRule({ template_code: 'not_exists' });
  assert.strictEqual(badTemplate.status, 400);

  const list = await (await fetch(`${baseUrl}/api/escalation/rules`)).json();
  assert.ok(list.data.some((r) => r.id === ruleId));

  const upd = await fetch(`${baseUrl}/api/escalation/rules/${ruleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: 0, name: '改名规则' }),
  });
  assert.strictEqual(upd.status, 200);
  const list2 = await (await fetch(`${baseUrl}/api/escalation/rules`)).json();
  const updated = list2.data.find((r) => r.id === ruleId);
  assert.strictEqual(updated.enabled, 0);
  assert.strictEqual(updated.name, '改名规则');

  const del = await fetch(`${baseUrl}/api/escalation/rules/${ruleId}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  const list3 = await (await fetch(`${baseUrl}/api/escalation/rules`)).json();
  assert.ok(!list3.data.some((r) => r.id === ruleId));
});

test('templates：列表含种子模板，可编辑主题正文', async () => {
  const list = await (await fetch(`${baseUrl}/api/escalation/templates`)).json();
  assert.ok(list.data.length >= 2);
  const tpl = list.data.find((t) => t.code === 'issue_escalation');
  const upd = await fetch(`${baseUrl}/api/escalation/templates/${tpl.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: '改后的主题 {{issue_no}}' }),
  });
  assert.strictEqual(upd.status, 200);
  const list2 = await (await fetch(`${baseUrl}/api/escalation/templates`)).json();
  assert.strictEqual(list2.data.find((t) => t.id === tpl.id).subject, '改后的主题 {{issue_no}}');
});

test('logs：分页与状态筛选', async () => {
  const issueId = await createIssue();
  await db.query(
    `INSERT INTO email_logs (issue_id, recipients, subject, status) VALUES (?, 'a@b.c', '催办', 'sent'), (?, 'a@b.c', '失败', 'failed')`,
    [issueId, issueId]
  );
  const all = await (await fetch(`${baseUrl}/api/escalation/logs?issue_id=${issueId}`)).json();
  assert.strictEqual(all.data.length, 2);
  assert.strictEqual(all.total, 2);

  const failedOnly = await (await fetch(`${baseUrl}/api/escalation/logs?issue_id=${issueId}&status=failed`)).json();
  assert.strictEqual(failedOnly.data.length, 1);
  assert.strictEqual(failedOnly.data[0].subject, '失败');
});

test('escalation-muted：暂停/恢复催办', async () => {
  const issueId = await createIssue();
  const mute = await fetch(`${baseUrl}/api/issues/${issueId}/escalation-muted`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted: 1 }),
  });
  assert.strictEqual(mute.status, 200);
  let rows = await db.query('SELECT escalation_muted FROM issues WHERE id = ?', [issueId]);
  assert.strictEqual(rows[0].escalation_muted, 1);

  const unmute = await fetch(`${baseUrl}/api/issues/${issueId}/escalation-muted`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted: 0 }),
  });
  assert.strictEqual(unmute.status, 200);
  rows = await db.query('SELECT escalation_muted FROM issues WHERE id = ?', [issueId]);
  assert.strictEqual(rows[0].escalation_muted, 0);

  const notFound = await fetch(`${baseUrl}/api/issues/999999/escalation-muted`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted: 1 }),
  });
  assert.strictEqual(notFound.status, 404);
});

test('ack：token 全流程与错误路径', async () => {
  const issueId = await createIssue({ assignee: '张三' });
  await db.query(
    `INSERT INTO email_logs (issue_id, token, recipients, subject, status) VALUES (?, 'tok-ack-1', 'a@b.c', '催办', 'sent')`,
    [issueId]
  );

  const bad = await fetch(`${baseUrl}/api/issues/${issueId}/ack?token=wrong-token`);
  assert.strictEqual(bad.status, 404);

  const ok = await fetch(`${baseUrl}/api/issues/${issueId}/ack?token=tok-ack-1`);
  assert.strictEqual(ok.status, 200);
  const html = await ok.text();
  assert.ok(html.includes('处理中'));

  let rows = await db.query('SELECT status FROM issues WHERE id = ?', [issueId]);
  assert.strictEqual(rows[0].status, '处理中');
  const comments = await db.query('SELECT * FROM issue_comments WHERE issue_id = ?', [issueId]);
  assert.strictEqual(comments.length, 1);
  const logs = await db.query('SELECT token FROM email_logs WHERE issue_id = ?', [issueId]);
  assert.strictEqual(logs[0].token, null, 'token 应被清空');

  const again = await fetch(`${baseUrl}/api/issues/${issueId}/ack?token=tok-ack-1`);
  assert.strictEqual(again.status, 404, 'token 一次性');
});

test('ack：已终态问题返回提示页', async () => {
  const issueId = await createIssue({ status: '已解决', solution: '已修', resolved_at: '2026-08-01' });
  await db.query(
    `INSERT INTO email_logs (issue_id, token, recipients, subject, status) VALUES (?, 'tok-ack-2', 'a@b.c', '催办', 'sent')`,
    [issueId]
  );
  const resp = await fetch(`${baseUrl}/api/issues/${issueId}/ack?token=tok-ack-2`);
  assert.strictEqual(resp.status, 200);
  const html = await resp.text();
  assert.ok(html.includes('已'));
  const rows = await db.query('SELECT status FROM issues WHERE id = ?', [issueId]);
  assert.strictEqual(rows[0].status, '已解决', '终态问题状态不变');
});

test('run-now：总开关关闭时统计为零；test-mail：SMTP 未配置返回 400', async () => {
  const run = await fetch(`${baseUrl}/api/escalation/run-now`, { method: 'POST' });
  const runBody = await run.json();
  assert.strictEqual(runBody.success, true);
  assert.strictEqual(runBody.data.sent, 0);
  assert.strictEqual(runBody.data.matched, 0);

  const tm = await fetch(`${baseUrl}/api/escalation/test-mail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'someone@example.com' }),
  });
  assert.strictEqual(tm.status, 400, '未配置 SMTP 时测试邮件应 400');
});
