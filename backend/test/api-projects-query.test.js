const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test_query');

// helpers 的 teardown 会 end 掉共享连接池且无法重建（db.js 缓存 pool），
// 因此整个文件只做一次 setup/teardown；种子数据也只播种一次，
// 前 5 个用例均为只读查询，最后一个用例插入的行不影响前面的 total 断言
let baseUrl;
test.before(async () => {
  ({ baseUrl } = await setup());
  await seed();
});
test.after(() => teardown());

async function seed() {
  const rows = [
    { project_name: '项目A', project_status: '进行中', health_status: '正常', planned_end_date: '2026-06-30' },
    { project_name: '项目B', project_status: '未启动', health_status: '风险', planned_end_date: '2026-09-30' },
    { project_name: '项目C', project_status: '进行中', health_status: '风险', planned_end_date: '2026-03-31' },
  ];
  for (const r of rows) {
    const keys = Object.keys(r);
    await db.query(
      `INSERT INTO projects (${keys.map((k) => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
      keys.map((k) => r[k])
    );
  }
}

test('按 project_status 单值筛选', async () => {
  const resp = await fetch(`${baseUrl}/api/projects?project_status=${encodeURIComponent('进行中')}`);
  const body = await resp.json();
  assert.strictEqual(body.total, 2);
  assert.ok(body.data.every((r) => r.project_status === '进行中'));
});

test('按 project_status 多值（逗号分隔）筛选', async () => {
  const q = encodeURIComponent('进行中,未启动');
  const resp = await fetch(`${baseUrl}/api/projects?project_status=${q}`);
  const body = await resp.json();
  assert.strictEqual(body.total, 3);
});

test('按 health_status 筛选', async () => {
  const resp = await fetch(`${baseUrl}/api/projects?health_status=${encodeURIComponent('风险')}`);
  const body = await resp.json();
  assert.strictEqual(body.total, 2);
});

test('按 planned_end_date 升序排序', async () => {
  const resp = await fetch(`${baseUrl}/api/projects?sort=planned_end_date&order=asc`);
  const body = await resp.json();
  const names = body.data.map((r) => r.project_name);
  assert.deepStrictEqual(names, ['项目C', '项目A', '项目B']);
});

test('未识别的 sort 回退为 id DESC，不报错', async () => {
  const resp = await fetch(`${baseUrl}/api/projects?sort=evil_column&order=desc`);
  assert.strictEqual(resp.status, 200);
  const body = await resp.json();
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.total, 3);
});

test('旧筛选：keyword 关键词过滤仍工作', async () => {
  const resp = await fetch(`${baseUrl}/api/projects?keyword=${encodeURIComponent('项目A')}`);
  const body = await resp.json();
  assert.strictEqual(body.total, 1);
  assert.strictEqual(body.data[0].project_name, '项目A');
});

test('旧筛选：status 保存状态过滤仍工作', async () => {
  const resp = await fetch(`${baseUrl}/api/projects?status=draft`);
  const body = await resp.json();
  assert.strictEqual(body.total, 3);

  const respSaved = await fetch(`${baseUrl}/api/projects?status=saved`);
  const bodySaved = await respSaved.json();
  assert.strictEqual(bodySaved.total, 0);
});

// 保持在本文件最后：该用例额外插入一行，避免影响前面对 total 的断言
test('GET /api/projects/:id 返回 4 个新字段；不存在返回 404', async () => {
  await db.query(`INSERT INTO projects (project_name, project_status, health_status) VALUES ('详情项目', '已暂停', '关注')`);
  const inserted = await db.query(`SELECT id FROM projects WHERE project_name = '详情项目'`);

  const resp = await fetch(`${baseUrl}/api/projects/${inserted[0].id}`);
  assert.strictEqual(resp.status, 200);
  const body = await resp.json();
  assert.strictEqual(body.data.project_status, '已暂停');
  assert.strictEqual(body.data.health_status, '关注');
  assert.ok('planned_start_date' in body.data);
  assert.ok('planned_end_date' in body.data);

  const notFound = await fetch(`${baseUrl}/api/projects/999999`);
  assert.strictEqual(notFound.status, 404);
});
