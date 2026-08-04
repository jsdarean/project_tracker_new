const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test');

test('projects 表包含 4 个新字段、索引，且迁移幂等不丢数据', async (t) => {
  await setup(); // setup 内已执行一次 initDatabase()
  t.after(() => teardown());

  const cols = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'projects'`
  );
  const names = new Set(cols.map((c) => c.COLUMN_NAME));
  for (const f of ['project_status', 'health_status', 'planned_start_date', 'planned_end_date']) {
    assert.ok(names.has(f), `缺少字段 ${f}`);
  }

  const idx = await db.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'projects'
       AND INDEX_NAME = 'idx_project_status'`
  );
  assert.strictEqual(idx.length > 0, true, '缺少索引 idx_project_status');

  // 插入数据后再次执行迁移：幂等且不丢数据
  await db.query(`INSERT INTO projects (project_name, project_status) VALUES ('迁移测试项目', '进行中')`);
  await db.initDatabase();
  const rows = await db.query(`SELECT project_status FROM projects WHERE project_name = '迁移测试项目'`);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].project_status, '进行中');
});
