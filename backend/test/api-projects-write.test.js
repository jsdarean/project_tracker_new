const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_write');

// helpers 的 teardown 会 end 掉共享连接池且无法重建（db.js 缓存 pool），
// 因此整个文件只做一次 setup/teardown，各用例共享同一个库
let baseUrl;
test.before(async () => {
  ({ baseUrl } = await setup());
});
test.after(() => teardown());

async function seedProject(overrides = {}) {
  const data = { project_name: '测试项目', ...overrides };
  const keys = Object.keys(data);
  const result = await db.query(
    `INSERT INTO projects (${keys.map((k) => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map((k) => data[k])
  );
  return result.insertId;
}

test('PUT /api/projects/:id 接受合法的 4 个新字段', async () => {
  const id = await seedProject();

  const resp = await fetch(`${baseUrl}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_status: '进行中',
      health_status: '关注',
      planned_start_date: '2026-08-01',
      planned_end_date: '2026-12-31',
    }),
  });
  assert.strictEqual(resp.status, 200);

  const rows = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
  assert.strictEqual(rows[0].project_status, '进行中');
  assert.strictEqual(rows[0].health_status, '关注');
  assert.strictEqual(rows[0].planned_start_date, '2026-08-01');
  assert.strictEqual(rows[0].planned_end_date, '2026-12-31');
});

test('PUT /api/projects/:id 拒绝非法 project_status（400）', async () => {
  const id = await seedProject();

  const resp = await fetch(`${baseUrl}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_status: '随便写' }),
  });
  assert.strictEqual(resp.status, 400);
  const body = await resp.json();
  assert.ok(body.message.includes('project_status'));
});

test('PUT /api/projects/:id 拒绝非法 health_status（400）', async () => {
  const id = await seedProject();

  const resp = await fetch(`${baseUrl}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ health_status: '爆表' }),
  });
  assert.strictEqual(resp.status, 400);
});

test('PUT /api/projects/:id 拒绝非法日期格式（400）', async () => {
  const id = await seedProject();

  const resp = await fetch(`${baseUrl}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planned_end_date: '2026/12/31' }),
  });
  assert.strictEqual(resp.status, 400);
});

test('POST /api/projects 不带新字段时行为不变（兼容插件）', async () => {
  const resp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_name: '插件项目', project_code: 'TEST-001' }),
  });
  assert.strictEqual(resp.status, 200);
  const body = await resp.json();
  assert.strictEqual(body.success, true);
});
