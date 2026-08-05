const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_progress_ov');

let baseUrl;
const ids = {};

// 距今 N 天前的日期字符串（YYYY-MM-DD）
function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

test.before(async () => {
  ({ baseUrl } = await setup());
  const seeds = [
    ['概览项目A', '进行中'],
    ['概览项目B', '进行中'],
    ['概览项目C', '未启动'],
    ['概览项目D', '已结项'],
  ];
  for (const [name, status] of seeds) {
    const r = await db.query(`INSERT INTO projects (project_name, project_status) VALUES (?, ?)`, [name, status]);
    ids[name] = r.insertId;
  }
  // A：今天和 3 天前有进展（不滞后，recent 榜首）
  await db.query(
    `INSERT INTO project_progress (project_id, report_date, completed_content) VALUES (?, ?, '今天进展'), (?, ?, '三天前进展')`,
    [ids['概览项目A'], daysAgo(0), ids['概览项目A'], daysAgo(3)]
  );
  // B：20 天前有进展（滞后，days_stale >= 20）
  await db.query(
    `INSERT INTO project_progress (project_id, report_date, completed_content) VALUES (?, ?, '二十天前进展')`,
    [ids['概览项目B'], daysAgo(20)]
  );
  // C：从未填报（滞后，days_stale 为 NULL）
  // D：60 天前有进展，但已结项（应被 stale 排除）
  await db.query(
    `INSERT INTO project_progress (project_id, report_date, completed_content) VALUES (?, ?, '六十天前进展')`,
    [ids['概览项目D'], daysAgo(60)]
  );
});
test.after(() => teardown());

test('GET /api/projects 返回 last_progress_date 且可排序', async () => {
  const resp = await fetch(`${baseUrl}/api/projects?pageSize=100`);
  const body = await resp.json();
  const byName = {};
  for (const row of body.data) byName[row.project_name] = row;

  assert.strictEqual(byName['概览项目A'].last_progress_date, daysAgo(0));
  assert.strictEqual(byName['概览项目B'].last_progress_date, daysAgo(20));
  assert.strictEqual(byName['概览项目C'].last_progress_date, null);
  assert.strictEqual(byName['概览项目D'].last_progress_date, daysAgo(60));

  const sorted = await fetch(`${baseUrl}/api/projects?sort=last_progress_date&order=desc&pageSize=100`);
  assert.strictEqual(sorted.status, 200);
  const sortedBody = await sorted.json();
  assert.strictEqual(sortedBody.success, true);
});

test('GET /api/progress/overview 返回 recent 与 stale，排除已结项', async () => {
  const resp = await fetch(`${baseUrl}/api/progress/overview`);
  assert.strictEqual(resp.status, 200);
  const body = await resp.json();
  assert.strictEqual(body.success, true);
  const { recent, stale } = body.data;

  // recent：倒序，榜首是 A 今天的进展，含项目名
  assert.ok(recent.length > 0);
  assert.strictEqual(recent[0].project_name, '概览项目A');
  assert.strictEqual(recent[0].completed_content, '今天进展');
  assert.ok('reporter' in recent[0] && 'tags' in recent[0] && 'project_id' in recent[0]);

  // stale：含 B（超期）和 C（未填报），排除 A（刚更新）和 D（已结项）
  const staleIds = stale.map((s) => s.project_id);
  assert.ok(staleIds.includes(ids['概览项目B']), 'B 超期应在 stale 中');
  assert.ok(staleIds.includes(ids['概览项目C']), 'C 未填报应在 stale 中');
  assert.ok(!staleIds.includes(ids['概览项目A']), 'A 刚更新不应在 stale 中');
  assert.ok(!staleIds.includes(ids['概览项目D']), 'D 已结项不应在 stale 中');

  const staleB = stale.find((s) => s.project_id === ids['概览项目B']);
  assert.ok(staleB.days_stale >= 20);
  const staleC = stale.find((s) => s.project_id === ids['概览项目C']);
  assert.strictEqual(staleC.last_progress_date, null);
  assert.strictEqual(staleC.days_stale, null);
});
