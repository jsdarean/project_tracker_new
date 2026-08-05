const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, db } = require('./helpers').createTestContext('project_tracker_test');

test.before(async () => {
  await setup();
});
test.after(() => teardown());

test('projects 表包含 4 个新字段、索引，且迁移幂等不丢数据', async () => {
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

test('project_progress 表已创建，字段与索引齐全', async () => {
  const cols = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'project_progress'`
  );
  const names = new Set(cols.map((c) => c.COLUMN_NAME));
  for (const f of ['id', 'project_id', 'report_date', 'completed_content', 'next_plan',
    'risk_note', 'tags', 'attachments', 'reporter', 'created_at', 'updated_at']) {
    assert.ok(names.has(f), `缺少字段 ${f}`);
  }

  const idx = await db.query(
    `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'project_progress'`
  );
  const idxNames = new Set(idx.map((i) => i.INDEX_NAME));
  assert.ok(idxNames.has('idx_progress_project_id'), '缺少索引 idx_progress_project_id');
  assert.ok(idxNames.has('idx_progress_report_date'), '缺少索引 idx_progress_report_date');
});

test('issues 与 issue_comments 表已创建，字段与索引齐全', async () => {
  const issueCols = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'issues'`
  );
  const issueNames = new Set(issueCols.map((c) => c.COLUMN_NAME));
  for (const f of ['id', 'issue_no', 'project_id', 'title', 'description', 'severity',
    'assignee', 'helper', 'status', 'found_date', 'due_date', 'resolved_at', 'solution',
    'created_by', 'created_at', 'updated_at']) {
    assert.ok(issueNames.has(f), `issues 缺少字段 ${f}`);
  }

  const issueIdx = await db.query(
    `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'issues'`
  );
  const issueIdxNames = new Set(issueIdx.map((i) => i.INDEX_NAME));
  assert.ok(issueIdxNames.has('uk_issue_no'), '缺少唯一索引 uk_issue_no');
  assert.ok(issueIdxNames.has('idx_issue_project_id'), '缺少索引 idx_issue_project_id');
  assert.ok(issueIdxNames.has('idx_issue_status'), '缺少索引 idx_issue_status');

  const commentCols = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'issue_comments'`
  );
  const commentNames = new Set(commentCols.map((c) => c.COLUMN_NAME));
  for (const f of ['id', 'issue_id', 'content', 'author', 'created_at']) {
    assert.ok(commentNames.has(f), `issue_comments 缺少字段 ${f}`);
  }

  const commentIdx = await db.query(
    `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'issue_comments'`
  );
  const commentIdxNames = new Set(commentIdx.map((i) => i.INDEX_NAME));
  assert.ok(commentIdxNames.has('idx_comment_issue_id'), '缺少索引 idx_comment_issue_id');
});

test('邮件催办三表、issues.escalation_muted 列与种子数据', async () => {
  for (const table of ['email_templates', 'email_logs', 'escalation_rules']) {
    const rows = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = ?`, [table]
    );
    assert.strictEqual(rows[0].c, 1, `缺少表 ${table}`);
  }

  const logCols = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'email_logs'`
  );
  const logNames = new Set(logCols.map((c) => c.COLUMN_NAME));
  for (const f of ['id', 'issue_id', 'rule_id', 'message_id', 'token', 'recipients', 'cc',
    'subject', 'body', 'status', 'error_msg', 'sent_at']) {
    assert.ok(logNames.has(f), `email_logs 缺少字段 ${f}`);
  }

  const muted = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'project_tracker_test' AND TABLE_NAME = 'issues' AND COLUMN_NAME = 'escalation_muted'`
  );
  assert.strictEqual(muted.length, 1, 'issues 缺少 escalation_muted 列');

  // 种子：3 条规则 + 2 个模板；重复迁移不重复插入
  const rules = await db.query('SELECT * FROM escalation_rules ORDER BY id');
  assert.strictEqual(rules.length, 3);
  assert.strictEqual(rules[0].days_before_due, 1);
  assert.strictEqual(rules[1].days_after_due, 1);
  assert.strictEqual(rules[2].days_after_due, 3);
  const templates = await db.query('SELECT * FROM email_templates ORDER BY id');
  assert.strictEqual(templates.length, 2);

  await db.initDatabase();
  const rules2 = await db.query('SELECT COUNT(*) AS c FROM escalation_rules');
  assert.strictEqual(rules2[0].c, 3, '重复迁移不应重复插入规则');
});
