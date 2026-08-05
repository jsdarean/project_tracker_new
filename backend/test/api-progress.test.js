const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_progress');

let baseUrl;
let projectId;

test.before(async () => {
  ({ baseUrl } = await setup());
  const result = await db.query(`INSERT INTO projects (project_name, project_status) VALUES ('进展测试项目', '进行中')`);
  projectId = result.insertId;
});
test.after(() => teardown());

test('POST 合法进展 → 200 并落库', async () => {
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      report_date: '2026-08-04',
      completed_content: '完成数据库设计',
      next_plan: '开始接口开发',
      risk_note: '人力紧张',
      tags: '里程碑达成,风险上升',
      reporter: '张三',
    }),
  });
  assert.strictEqual(resp.status, 200);
  const body = await resp.json();
  const rows = await db.query('SELECT * FROM project_progress WHERE id = ?', [body.id]);
  assert.strictEqual(rows[0].project_id, projectId);
  assert.strictEqual(rows[0].report_date, '2026-08-04');
  assert.strictEqual(rows[0].completed_content, '完成数据库设计');
  assert.strictEqual(rows[0].next_plan, '开始接口开发');
  assert.strictEqual(rows[0].risk_note, '人力紧张');
  assert.strictEqual(rows[0].tags, '里程碑达成,风险上升');
  assert.strictEqual(rows[0].reporter, '张三');
  assert.strictEqual(rows[0].attachments, null);
});

test('POST 缺 report_date → 400', async () => {
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed_content: '内容' }),
  });
  assert.strictEqual(resp.status, 400);
});

test('POST 非法日期格式 → 400', async () => {
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_date: '2026/08/04', completed_content: '内容' }),
  });
  assert.strictEqual(resp.status, 400);
});

test('POST 空 completed_content → 400', async () => {
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_date: '2026-08-04', completed_content: '   ' }),
  });
  assert.strictEqual(resp.status, 400);
});

test('POST 非法 tag → 400', async () => {
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_date: '2026-08-04', completed_content: '内容', tags: '不存在的标签' }),
  });
  assert.strictEqual(resp.status, 400);
});

test('POST 不存在的 project_id → 404', async () => {
  const resp = await fetch(`${baseUrl}/api/projects/999999/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_date: '2026-08-04', completed_content: '内容' }),
  });
  assert.strictEqual(resp.status, 404);
});

test('GET 列表倒序返回，from/to 过滤正确', async () => {
  await db.query(
    `INSERT INTO project_progress (project_id, report_date, completed_content) VALUES
     (?, '2026-07-01', '七月初'), (?, '2026-07-15', '七月中'), (?, '2026-08-01', '八月初')`,
    [projectId, projectId, projectId]
  );
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/progress`);
  const body = await resp.json();
  assert.strictEqual(body.success, true);
  const dates = body.data.map((r) => r.report_date);
  const sorted = [...dates].sort((a, b) => (a < b ? 1 : -1));
  assert.deepStrictEqual(dates, sorted, '应按 report_date 倒序');

  const filtered = await fetch(`${baseUrl}/api/projects/${projectId}/progress?from=2026-07-10&to=2026-07-31`);
  const filteredBody = await filtered.json();
  assert.strictEqual(filteredBody.data.length, 1);
  assert.strictEqual(filteredBody.data[0].completed_content, '七月中');

  const notFound = await fetch(`${baseUrl}/api/projects/999999/progress`);
  assert.strictEqual(notFound.status, 404);
});

test('PUT 修改字段生效', async () => {
  const ins = await db.query(
    `INSERT INTO project_progress (project_id, report_date, completed_content) VALUES (?, '2026-08-02', '原文')`,
    [projectId]
  );
  const id = ins.insertId;
  const resp = await fetch(`${baseUrl}/api/progress/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed_content: '改后', tags: '需领导决策' }),
  });
  assert.strictEqual(resp.status, 200);
  const rows = await db.query('SELECT * FROM project_progress WHERE id = ?', [id]);
  assert.strictEqual(rows[0].completed_content, '改后');
  assert.strictEqual(rows[0].tags, '需领导决策');
  assert.strictEqual(rows[0].report_date, '2026-08-02', '未传字段不应被改动');
});

test('PUT 非法值 → 400；不存在的 id → 404', async () => {
  const ins = await db.query(
    `INSERT INTO project_progress (project_id, report_date, completed_content) VALUES (?, '2026-08-02', '原文')`,
    [projectId]
  );
  const bad = await fetch(`${baseUrl}/api/progress/${ins.insertId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: '非法标签' }),
  });
  assert.strictEqual(bad.status, 400);

  const notFound = await fetch(`${baseUrl}/api/progress/999999`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed_content: '改' }),
  });
  assert.strictEqual(notFound.status, 404);
});

test('DELETE 生效；不存在的 id → 404', async () => {
  const ins = await db.query(
    `INSERT INTO project_progress (project_id, report_date, completed_content) VALUES (?, '2026-08-03', '待删')`,
    [projectId]
  );
  const resp = await fetch(`${baseUrl}/api/progress/${ins.insertId}`, { method: 'DELETE' });
  assert.strictEqual(resp.status, 200);
  const rows = await db.query('SELECT * FROM project_progress WHERE id = ?', [ins.insertId]);
  assert.strictEqual(rows.length, 0);

  const notFound = await fetch(`${baseUrl}/api/progress/999999`, { method: 'DELETE' });
  assert.strictEqual(notFound.status, 404);
});
