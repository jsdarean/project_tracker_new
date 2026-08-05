const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_issues');

let baseUrl;
let projectId;

async function createIssue(overrides = {}) {
  const resp = await fetch(`${baseUrl}/api/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId,
      title: '测试问题',
      ...overrides,
    }),
  });
  return resp;
}

test.before(async () => {
  ({ baseUrl } = await setup());
  const result = await db.query(`INSERT INTO projects (project_name, project_status) VALUES ('问题测试项目', '进行中')`);
  projectId = result.insertId;
});
test.after(() => teardown());

test('POST 创建问题 → 200，编号 ISS-xxxx 格式，逐字段落库', async () => {
  const resp = await createIssue({
    title: '数据库连接超时',
    description: '高峰期频繁超时',
    severity: '紧急',
    assignee: '张三',
    helper: '李四',
    found_date: '2026-08-01',
    due_date: '2026-08-10',
    created_by: '王五',
  });
  assert.strictEqual(resp.status, 200);
  const body = await resp.json();
  const rows = await db.query('SELECT * FROM issues WHERE id = ?', [body.id]);
  const issue = rows[0];
  assert.match(issue.issue_no, /^ISS-\d{4}$/);
  assert.strictEqual(issue.project_id, projectId);
  assert.strictEqual(issue.title, '数据库连接超时');
  assert.strictEqual(issue.severity, '紧急');
  assert.strictEqual(issue.status, '新建', '默认状态应为新建');
  assert.strictEqual(issue.assignee, '张三');
  assert.strictEqual(issue.helper, '李四');
  assert.strictEqual(issue.found_date, '2026-08-01');
  assert.strictEqual(issue.due_date, '2026-08-10');
  assert.strictEqual(issue.created_by, '王五');
});

test('连续创建 → 编号唯一且递增', async () => {
  const resp1 = await createIssue({ title: '问题一' });
  const resp2 = await createIssue({ title: '问题二' });
  const body1 = await resp1.json();
  const body2 = await resp2.json();
  const rows = await db.query('SELECT issue_no FROM issues WHERE id IN (?, ?) ORDER BY id', [body1.id, body2.id]);
  assert.notStrictEqual(rows[0].issue_no, rows[1].issue_no);
  assert.ok(rows[1].issue_no > rows[0].issue_no, '后创建的问题编号应更大');
});

test('POST 校验：缺 title / 非法 severity / 非法日期 → 400；项目不存在 → 404', async () => {
  const noTitle = await createIssue({ title: '  ' });
  assert.strictEqual(noTitle.status, 400);

  const badSeverity = await createIssue({ severity: '爆表' });
  assert.strictEqual(badSeverity.status, 400);

  const badDate = await createIssue({ due_date: '2026/08/10' });
  assert.strictEqual(badDate.status, 400);

  const noProject = await fetch(`${baseUrl}/api/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: 999999, title: '孤儿问题' }),
  });
  assert.strictEqual(noProject.status, 404);
});

test('GET 列表：status 多值 / severity / keyword / overdue=1 筛选', async () => {
  // 构造种子：一个逾期进行中、一个逾期但已解决（应被 overdue 排除）
  await createIssue({ title: '逾期处理中', status: '处理中', severity: '重要', due_date: '2020-01-01' });
  await createIssue({
    title: '逾期已解决', status: '已解决', severity: '紧急',
    due_date: '2020-01-01', solution: '已修复', resolved_at: '2020-01-02',
  });

  const statusResp = await fetch(`${baseUrl}/api/issues?status=${encodeURIComponent('处理中,待确认')}`);
  const statusBody = await statusResp.json();
  assert.ok(statusBody.data.length >= 1);
  assert.ok(statusBody.data.every((r) => ['处理中', '待确认'].includes(r.status)));

  const sevResp = await fetch(`${baseUrl}/api/issues?severity=${encodeURIComponent('紧急')}`);
  const sevBody = await sevResp.json();
  assert.ok(sevBody.data.every((r) => r.severity === '紧急'));

  const kwResp = await fetch(`${baseUrl}/api/issues?keyword=${encodeURIComponent('逾期处理中')}`);
  const kwBody = await kwResp.json();
  assert.strictEqual(kwBody.data.length, 1);

  const odResp = await fetch(`${baseUrl}/api/issues?overdue=1&pageSize=100`);
  const odBody = await odResp.json();
  assert.ok(odBody.data.length >= 1);
  assert.ok(odBody.data.every((r) => r.is_overdue === 1 || r.is_overdue === true));
  assert.ok(odBody.data.some((r) => r.title === '逾期处理中'));
  assert.ok(!odBody.data.some((r) => r.title === '逾期已解决'), '已解决的逾期问题不应出现在 overdue 列表');
  const overdueRow = odBody.data.find((r) => r.title === '逾期处理中');
  assert.ok(overdueRow.overdue_days > 0);
});

test('GET /api/issues/stats 四计数正确', async () => {
  const resp = await fetch(`${baseUrl}/api/issues/stats`);
  const body = await resp.json();
  assert.strictEqual(body.success, true);
  const rows = await db.query('SELECT status, due_date FROM issues');
  const total = rows.length;
  const closed = rows.filter((r) => ['已解决', '已关闭'].includes(r.status)).length;
  const open = total - closed;
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = fmt(new Date());
  const overdue = rows.filter((r) => r.due_date && fmt(new Date(r.due_date)) < today && !['已解决', '已关闭'].includes(r.status)).length;
  assert.strictEqual(body.data.total, total);
  assert.strictEqual(body.data.open, open);
  assert.strictEqual(body.data.closed, closed);
  assert.strictEqual(body.data.overdue, overdue);
});

test('GET /api/issues/:id 返回详情含 project_name；不存在 → 404', async () => {
  const created = await (await createIssue({ title: '详情问题' })).json();
  const resp = await fetch(`${baseUrl}/api/issues/${created.id}`);
  assert.strictEqual(resp.status, 200);
  const body = await resp.json();
  assert.strictEqual(body.data.title, '详情问题');
  assert.strictEqual(body.data.project_name, '问题测试项目');

  const notFound = await fetch(`${baseUrl}/api/issues/999999`);
  assert.strictEqual(notFound.status, 404);
});

test('PUT：普通更新；终态缺 solution → 400；齐全 → 200；重新打开 → 200', async () => {
  const created = await (await createIssue({ title: '待处理' })).json();

  const upd = await fetch(`${baseUrl}/api/issues/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '处理中', assignee: '赵六' }),
  });
  assert.strictEqual(upd.status, 200);
  let rows = await db.query('SELECT * FROM issues WHERE id = ?', [created.id]);
  assert.strictEqual(rows[0].status, '处理中');
  assert.strictEqual(rows[0].assignee, '赵六', '转派（改 assignee）应生效');

  const noSolution = await fetch(`${baseUrl}/api/issues/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '已解决' }),
  });
  assert.strictEqual(noSolution.status, 400);

  const resolved = await fetch(`${baseUrl}/api/issues/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '已解决', solution: '重启服务' }),
  });
  assert.strictEqual(resolved.status, 200);
  rows = await db.query('SELECT * FROM issues WHERE id = ?', [created.id]);
  assert.strictEqual(rows[0].status, '已解决');
  assert.strictEqual(rows[0].solution, '重启服务');
  assert.match(rows[0].resolved_at, /^\d{4}-\d{2}-\d{2}$/, '未传 resolved_at 时后端应默认填今天');

  const reopen = await fetch(`${baseUrl}/api/issues/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '处理中' }),
  });
  assert.strictEqual(reopen.status, 200);
  rows = await db.query('SELECT * FROM issues WHERE id = ?', [created.id]);
  assert.strictEqual(rows[0].status, '处理中');
  assert.strictEqual(rows[0].solution, '重启服务', 'solution 应保留为历史');
});

test('PUT 不存在 → 404；非法 status → 400；DELETE 不存在 → 404', async () => {
  const notFound = await fetch(`${baseUrl}/api/issues/999999`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '改' }),
  });
  assert.strictEqual(notFound.status, 404);

  const created = await (await createIssue({ title: '非法状态' })).json();
  const bad = await fetch(`${baseUrl}/api/issues/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '随便' }),
  });
  assert.strictEqual(bad.status, 400);

  const delNotFound = await fetch(`${baseUrl}/api/issues/999999`, { method: 'DELETE' });
  assert.strictEqual(delNotFound.status, 404);
});

test('评论：POST 落库、GET 正序；空 content → 400；问题不存在 → 404', async () => {
  const created = await (await createIssue({ title: '评论问题' })).json();

  const empty = await fetch(`${baseUrl}/api/issues/${created.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '  ' }),
  });
  assert.strictEqual(empty.status, 400);

  await fetch(`${baseUrl}/api/issues/${created.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '第一条评论', author: '张三' }),
  });
  await fetch(`${baseUrl}/api/issues/${created.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '第二条评论', author: '李四' }),
  });

  const list = await fetch(`${baseUrl}/api/issues/${created.id}/comments`);
  assert.strictEqual(list.status, 200);
  const body = await list.json();
  assert.strictEqual(body.data.length, 2);
  assert.strictEqual(body.data[0].content, '第一条评论');
  assert.strictEqual(body.data[0].author, '张三');
  assert.strictEqual(body.data[1].content, '第二条评论');

  const notFound = await fetch(`${baseUrl}/api/issues/999999/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '孤儿评论' }),
  });
  assert.strictEqual(notFound.status, 404);
});

test('DELETE 问题后评论级联删除', async () => {
  const created = await (await createIssue({ title: '待删问题' })).json();
  await fetch(`${baseUrl}/api/issues/${created.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '将被级联删除' }),
  });

  const del = await fetch(`${baseUrl}/api/issues/${created.id}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);

  const issues = await db.query('SELECT * FROM issues WHERE id = ?', [created.id]);
  assert.strictEqual(issues.length, 0);
  const comments = await db.query('SELECT * FROM issue_comments WHERE issue_id = ?', [created.id]);
  assert.strictEqual(comments.length, 0, '评论应随问题级联删除');
});

test('PUT 终态问题不带 solution 的部分更新 → 200，沿用存量方案', async () => {
  const created = await (await createIssue({ title: '终态编辑' })).json();
  // 先置为已解决（带方案）
  const resolve = await fetch(`${baseUrl}/api/issues/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '已解决', solution: '已修复', resolved_at: '2026-08-03' }),
  });
  assert.strictEqual(resolve.status, 200);

  // 带 status 不带 solution 的部分更新（模拟详情页保存行为）
  const edit = await fetch(`${baseUrl}/api/issues/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '已解决', assignee: '王五' }),
  });
  assert.strictEqual(edit.status, 200);
  let rows = await db.query('SELECT * FROM issues WHERE id = ?', [created.id]);
  assert.strictEqual(rows[0].assignee, '王五');
  assert.strictEqual(rows[0].solution, '已修复', 'solution 应保留');
  assert.strictEqual(rows[0].resolved_at, '2026-08-03', 'resolved_at 应保留');

  // 已解决 → 已关闭（不带 solution，沿用存量）
  const close = await fetch(`${baseUrl}/api/issues/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '已关闭' }),
  });
  assert.strictEqual(close.status, 200);
  rows = await db.query('SELECT * FROM issues WHERE id = ?', [created.id]);
  assert.strictEqual(rows[0].status, '已关闭');
  assert.strictEqual(rows[0].solution, '已修复');
});
