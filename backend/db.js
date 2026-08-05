require('dotenv').config();
const mysql = require('mysql2/promise');

// 默认从环境变量读取，可被 settings.json 覆盖
let config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'project_tracker',
  // 允许执行多条 SQL
  multipleStatements: true,
  // DATE 类型以字符串返回，避免时区转换导致日期偏差
  dateStrings: true,
};

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool(config);
  }
  return pool;
}

function setDbConfig(updates) {
  config = { ...config, ...updates };
  // 关闭旧连接池，下次查询时按新配置重建
  if (pool) {
    pool.end().catch(() => {});
    pool = null;
  }
}

function getDbConfig() {
  return { ...config };
}

async function query(sql, params) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

// projects 表字段定义
// B~AI 列与 testfiles/2024-2025年投资项目情况（全室）.et
// “2024、25、26年新建项目”工作表保持一致；
// 责任部门/责任人字段为插件从 CPMS 页面额外抓取。
const projectColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`source_url` VARCHAR(2048) DEFAULT NULL COMMENT \'来源 URL\'',
  '`extracted_text` TEXT COMMENT \'立项批复正文\'',
  '`doc_number` VARCHAR(100) DEFAULT NULL COMMENT \'立项批复发文文号\'',
  '`category` VARCHAR(50) DEFAULT NULL COMMENT \'专业类别\'',
  '`project_code` VARCHAR(50) DEFAULT NULL COMMENT \'项目编码\'',
  '`project_name` VARCHAR(500) DEFAULT NULL COMMENT \'项目名称\'',
  '`approval_date` DATE DEFAULT NULL COMMENT \'立项批复日期\'',
  '`design_date` DATE DEFAULT NULL COMMENT \'设计批复日期\'',
  '`completion_date` DATE DEFAULT NULL COMMENT \'竣工批复日期\'',
  '`project_set` VARCHAR(100) DEFAULT NULL COMMENT \'项目集\'',
  '`project_subset` VARCHAR(100) DEFAULT NULL COMMENT \'项目子集\'',
  '`project_manager` VARCHAR(100) DEFAULT NULL COMMENT \'工程责任人\'',
  '`planning_manager` VARCHAR(100) DEFAULT NULL COMMENT \'规划责任人\'',
  '`investment_dept` VARCHAR(200) DEFAULT NULL COMMENT \'项目投资责任部门\'',
  '`investment_person` VARCHAR(100) DEFAULT NULL COMMENT \'项目投资责任人\'',
  '`engineering_dept` VARCHAR(200) DEFAULT NULL COMMENT \'工程管理责任部门\'',
  '`engineering_person` VARCHAR(100) DEFAULT NULL COMMENT \'工程管理责任人\'',
  '`software_dept` VARCHAR(200) DEFAULT NULL COMMENT \'软件开发管理责任部门\'',
  '`software_person` VARCHAR(100) DEFAULT NULL COMMENT \'软件开发管理责任人\'',
  '`maintenance_dept` VARCHAR(200) DEFAULT NULL COMMENT \'项目维护责任部门\'',
  '`maintenance_person` VARCHAR(100) DEFAULT NULL COMMENT \'项目维护责任人\'',
  '`procurement_dept` VARCHAR(200) DEFAULT NULL COMMENT \'项目合同采购责任部门\'',
  '`procurement_person` VARCHAR(100) DEFAULT NULL COMMENT \'项目合同采购责任人\'',
  '`approval_amount` DECIMAL(18,4) DEFAULT NULL COMMENT \'立项金额（万元）\'',
  '`amount_note` VARCHAR(200) DEFAULT NULL COMMENT \'金额备注（辅助）\'',
  '`change_status` VARCHAR(500) DEFAULT NULL COMMENT \'变化情况\'',
  '`mid_year_budget` VARCHAR(500) DEFAULT NULL COMMENT \'年中预算决策情况\'',
  '`budget_increase` VARCHAR(500) DEFAULT NULL COMMENT \'预算增加情况\'',
  '`undecided_supplement` VARCHAR(500) DEFAULT NULL COMMENT \'未决策预算追加\'',
  '`decided_budget` VARCHAR(500) DEFAULT NULL COMMENT \'已决策预算\'',
  '`decided_in_project` VARCHAR(500) DEFAULT NULL COMMENT \'其中项目已决策\'',
  '`undecided_in_project` VARCHAR(500) DEFAULT NULL COMMENT \'其中项目未决策\'',
  '`remarks` TEXT COMMENT \'备注\'',
  '`estimated_actual` DECIMAL(18,4) DEFAULT NULL COMMENT \'预计实际发生金额\'',
  '`releasable_amount` DECIMAL(18,4) DEFAULT NULL COMMENT \'可释放金额\'',
  '`design_amount` DECIMAL(18,4) DEFAULT NULL COMMENT \'设计金额\'',
  '`completion_amount` DECIMAL(18,4) DEFAULT NULL COMMENT \'竣工金额\'',
  '`build_level` VARCHAR(20) DEFAULT NULL COMMENT \'省建/市建/一干\'',
  '`listed` VARCHAR(20) DEFAULT NULL COMMENT \'上市/非上市\'',
  '`region` VARCHAR(200) DEFAULT NULL COMMENT \'地区\'',
  '`is_rnd` VARCHAR(20) DEFAULT NULL COMMENT \'是否研发项目\'',
  '`decision_method` VARCHAR(300) DEFAULT NULL COMMENT \'决策方式\'',
  '`project_status` VARCHAR(20) DEFAULT \'未启动\' COMMENT \'项目状态（未启动/进行中/已暂停/已结项）\'',
  '`health_status` VARCHAR(20) DEFAULT \'正常\' COMMENT \'健康度（正常/关注/风险）\'',
  '`planned_start_date` DATE DEFAULT NULL COMMENT \'计划开始日期\'',
  '`planned_end_date` DATE DEFAULT NULL COMMENT \'计划结束日期\'',
  '`status` ENUM(\'draft\',\'saved\') DEFAULT \'draft\' COMMENT \'保存状态\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\'',
  '`updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT \'更新时间\'',
];

// 联系人表字段定义
const contactColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`city` VARCHAR(100) DEFAULT NULL COMMENT \'地市\'',
  '`company` VARCHAR(200) DEFAULT NULL COMMENT \'公司\'',
  '`department` VARCHAR(200) DEFAULT NULL COMMENT \'部门\'',
  '`position` VARCHAR(100) DEFAULT NULL COMMENT \'职务\'',
  '`name` VARCHAR(100) NOT NULL COMMENT \'姓名\'',
  '`phone` VARCHAR(100) DEFAULT NULL COMMENT \'电话\'',
  '`email` VARCHAR(200) DEFAULT NULL COMMENT \'邮箱\'',
  '`remarks` TEXT COMMENT \'备注\'',
  '`related_project` VARCHAR(500) DEFAULT NULL COMMENT \'关联项目\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\'',
  '`updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT \'更新时间\'',
];

// 关注项目表字段定义（project_id 关联 projects.id）
const watchProjectColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`project_id` INT NOT NULL COMMENT \'项目 ID\'',
  '`watch_type` VARCHAR(200) DEFAULT NULL COMMENT \'关注类型\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\'',
  '`updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT \'更新时间\'',
];

// 关注原因及进展表字段定义（watch_id 关联 watch_projects.id）
const watchProgressColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`watch_id` INT NOT NULL COMMENT \'关注项目 ID\'',
  '`description` TEXT COMMENT \'说明\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'录入时间\'',
  '`updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT \'更新时间\'',
];

// 项目进展表字段定义（project_id 关联 projects.id；attachments 为后续阶段附件占位）
const progressColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`project_id` INT NOT NULL COMMENT \'项目 ID\'',
  '`report_date` DATE NOT NULL COMMENT \'填报日期\'',
  '`completed_content` TEXT COMMENT \'完成内容\'',
  '`next_plan` TEXT COMMENT \'下阶段计划\'',
  '`risk_note` TEXT COMMENT \'风险说明\'',
  '`tags` VARCHAR(200) DEFAULT NULL COMMENT \'标签（逗号分隔：里程碑达成/风险上升/需领导决策）\'',
  '`attachments` TEXT COMMENT \'附件（JSON，预留）\'',
  '`reporter` VARCHAR(100) DEFAULT NULL COMMENT \'填报人\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\'',
  '`updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT \'更新时间\'',
];

function parseColumnName(colDef) {
  const m = colDef.match(/^`([^`]+)`/);
  return m ? m[1] : '';
}

async function initDatabase() {
  // 先不指定 database，创建数据库
  const tempConfig = { ...config };
  const dbName = tempConfig.database || 'project_tracker';
  delete tempConfig.database;
  const connection = await mysql.createConnection(tempConfig);
  await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  await connection.end();

  // 再建表
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS \`projects\` (
      ${projectColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      KEY \`idx_project_code\` (\`project_code\`),
      KEY \`idx_doc_number\` (\`doc_number\`),
      KEY \`idx_status\` (\`status\`),
      KEY \`idx_project_status\` (\`project_status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createTableSql);

  const db = getPool();

  // 为已存在的表补充缺失字段（新字段会加在表尾）
  const dbNameQuoted = '`' + dbName.replace(/`/g, '``') + '`';
  const [existingCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'projects']
  );
  const existingSet = new Set(existingCols.map(c => c.COLUMN_NAME));
  for (const colDef of projectColumns) {
    const colName = parseColumnName(colDef);
    if (!existingSet.has(colName)) {
      await db.query(`ALTER TABLE \`projects\` ADD COLUMN ${colDef}`);
      console.log('新增字段:', colName);
    }
  }

  // 为已存在的表补充缺失索引（CREATE TABLE IF NOT EXISTS 不会补索引）
  const [existingIdx] = await db.execute(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [dbName, 'projects', 'idx_project_status']
  );
  if (existingIdx.length === 0) {
    await db.query('ALTER TABLE `projects` ADD KEY `idx_project_status` (`project_status`)');
    console.log('新增索引: idx_project_status');
  }

  // 为已存在的表补充/更新字段注释，避免删表丢数据
  for (const colDef of projectColumns) {
    const alterStmt = `ALTER TABLE \`projects\` MODIFY COLUMN ${colDef}`;
    await db.query(alterStmt);
  }

  // 创建联系人表
  const createContactsSql = `
    CREATE TABLE IF NOT EXISTS \`contacts\` (
      ${contactColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      KEY \`idx_contact_name\` (\`name\`),
      KEY \`idx_contact_department\` (\`department\`),
      KEY \`idx_contact_related_project\` (\`related_project\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createContactsSql);

  // 为已存在的联系人表补充缺失字段
  const [existingContactCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'contacts']
  );
  const existingContactSet = new Set(existingContactCols.map(c => c.COLUMN_NAME));
  for (const colDef of contactColumns) {
    const colName = parseColumnName(colDef);
    if (!existingContactSet.has(colName)) {
      await db.query(`ALTER TABLE \`contacts\` ADD COLUMN ${colDef}`);
      console.log('新增联系人表字段:', colName);
    }
  }

  // 为已存在的联系人表补充/更新字段注释
  for (const colDef of contactColumns) {
    const alterStmt = `ALTER TABLE \`contacts\` MODIFY COLUMN ${colDef}`;
    await db.query(alterStmt);
  }

  // 创建关注项目表
  const createWatchSql = `
    CREATE TABLE IF NOT EXISTS \`watch_projects\` (
      ${watchProjectColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_watch_project_id\` (\`project_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createWatchSql);

  // 为已存在的关注项目表补充缺失字段
  const [existingWatchCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'watch_projects']
  );
  const existingWatchSet = new Set(existingWatchCols.map(c => c.COLUMN_NAME));
  for (const colDef of watchProjectColumns) {
    const colName = parseColumnName(colDef);
    if (!existingWatchSet.has(colName)) {
      await db.query(`ALTER TABLE \`watch_projects\` ADD COLUMN ${colDef}`);
      console.log('新增关注项目表字段:', colName);
    }
  }

  // 创建关注原因及进展表
  const createProgressSql = `
    CREATE TABLE IF NOT EXISTS \`watch_progress\` (
      ${watchProgressColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      KEY \`idx_progress_watch_id\` (\`watch_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createProgressSql);

  // 创建项目进展表
  const createProjectProgressSql = `
    CREATE TABLE IF NOT EXISTS \`project_progress\` (
      ${progressColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      KEY \`idx_progress_project_id\` (\`project_id\`),
      KEY \`idx_progress_report_date\` (\`report_date\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createProjectProgressSql);

  // 为已存在的进展表补充缺失字段
  const [existingProgressCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'project_progress']
  );
  const existingProgressSet = new Set(existingProgressCols.map(c => c.COLUMN_NAME));
  for (const colDef of progressColumns) {
    const colName = parseColumnName(colDef);
    if (!existingProgressSet.has(colName)) {
      await db.query(`ALTER TABLE \`project_progress\` ADD COLUMN ${colDef}`);
      console.log('新增进展表字段:', colName);
    }
  }

  // 为已存在的进展表补充/更新字段注释
  for (const colDef of progressColumns) {
    await db.query(`ALTER TABLE \`project_progress\` MODIFY COLUMN ${colDef}`);
  }

  console.log('数据库与表初始化完成:', dbName);
}

module.exports = {
  getPool,
  query,
  initDatabase,
  projectColumns,
  contactColumns,
  watchProjectColumns,
  watchProgressColumns,
  progressColumns,
  setDbConfig,
  getDbConfig,
};
