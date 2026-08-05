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

// 问题单表字段定义（project_id 关联 projects.id；枚举语义 VARCHAR + API 校验）
const issueColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`issue_no` VARCHAR(50) NOT NULL COMMENT \'问题编号（ISS-0001，服务端生成）\'',
  '`project_id` INT NOT NULL COMMENT \'所属项目 ID\'',
  '`title` VARCHAR(500) NOT NULL COMMENT \'问题标题\'',
  '`description` TEXT COMMENT \'问题描述\'',
  '`severity` VARCHAR(20) NOT NULL DEFAULT \'一般\' COMMENT \'严重程度（一般/重要/紧急）\'',
  '`assignee` VARCHAR(100) DEFAULT NULL COMMENT \'责任人\'',
  '`helper` VARCHAR(100) DEFAULT NULL COMMENT \'协助人\'',
  '`status` VARCHAR(20) NOT NULL DEFAULT \'新建\' COMMENT \'状态（新建/处理中/待确认/已解决/已关闭）\'',
  '`found_date` DATE DEFAULT NULL COMMENT \'发现日期\'',
  '`due_date` DATE DEFAULT NULL COMMENT \'期望解决日期\'',
  '`resolved_at` DATE DEFAULT NULL COMMENT \'实际解决日期\'',
  '`solution` TEXT COMMENT \'解决方案\'',
  '`created_by` VARCHAR(100) DEFAULT NULL COMMENT \'创建人\'',
  '`escalation_muted` TINYINT NOT NULL DEFAULT 0 COMMENT \'暂停催办（1=暂停）\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\'',
  '`updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT \'更新时间\'',
];

// 问题评论表字段定义（issue_id 关联 issues.id）
const issueCommentColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`issue_id` INT NOT NULL COMMENT \'问题 ID\'',
  '`content` TEXT NOT NULL COMMENT \'评论内容\'',
  '`author` VARCHAR(100) DEFAULT NULL COMMENT \'评论人\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\'',
];

// 邮件模板表字段定义（占位符 {{var}}，渲染时替换）
const emailTemplateColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`code` VARCHAR(50) NOT NULL COMMENT \'模板编码\'',
  '`name` VARCHAR(100) DEFAULT NULL COMMENT \'模板名称\'',
  '`subject` VARCHAR(500) DEFAULT NULL COMMENT \'邮件主题（支持占位符）\'',
  '`body` TEXT COMMENT \'邮件正文（支持占位符）\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\'',
];

// 邮件发送日志表字段定义（status: sent/failed/bounced/skipped）
const emailLogColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`issue_id` INT DEFAULT NULL COMMENT \'关联问题 ID（进展提醒为 NULL）\'',
  '`rule_id` INT DEFAULT NULL COMMENT \'触发规则 ID\'',
  '`message_id` VARCHAR(255) DEFAULT NULL COMMENT \'发件 Message-ID（退信匹配用）\'',
  '`token` VARCHAR(64) DEFAULT NULL COMMENT \'ack 一次性令牌（用后清空）\'',
  '`recipients` TEXT COMMENT \'收件人（逗号分隔）\'',
  '`cc` TEXT COMMENT \'抄送（逗号分隔）\'',
  '`subject` VARCHAR(500) DEFAULT NULL COMMENT \'邮件主题\'',
  '`body` TEXT COMMENT \'邮件正文\'',
  '`status` VARCHAR(20) NOT NULL COMMENT \'状态（sent/failed/bounced/skipped）\'',
  '`error_msg` TEXT COMMENT \'失败/退信原因（截 500 字）\'',
  '`sent_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'发送时间\'',
];

// 催办规则表字段定义
const escalationRuleColumns = [
  '`id` INT NOT NULL AUTO_INCREMENT COMMENT \'序号\'',
  '`name` VARCHAR(100) NOT NULL COMMENT \'规则名称\'',
  '`severity` VARCHAR(20) DEFAULT NULL COMMENT \'适用严重程度（空=全部）\'',
  '`days_before_due` INT DEFAULT NULL COMMENT \'临期 N 天触发\'',
  '`days_after_due` INT DEFAULT NULL COMMENT \'逾期 N 天触发\'',
  '`to_roles` VARCHAR(100) NOT NULL COMMENT \'收件人角色（assignee/manager/leader 逗号分隔）\'',
  '`cc_roles` VARCHAR(100) DEFAULT NULL COMMENT \'抄送角色\'',
  '`template_code` VARCHAR(50) DEFAULT NULL COMMENT \'模板编码（缺失用内置兜底）\'',
  '`enabled` TINYINT NOT NULL DEFAULT 1 COMMENT \'是否启用\'',
  '`min_interval_hours` INT NOT NULL DEFAULT 24 COMMENT \'同问题同规则最小发送间隔（小时）\'',
  '`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\'',
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

  // 创建问题单表
  const createIssuesSql = `
    CREATE TABLE IF NOT EXISTS \`issues\` (
      ${issueColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_issue_no\` (\`issue_no\`),
      KEY \`idx_issue_project_id\` (\`project_id\`),
      KEY \`idx_issue_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createIssuesSql);

  // 为已存在的问题表补充缺失字段
  const [existingIssueCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'issues']
  );
  const existingIssueSet = new Set(existingIssueCols.map(c => c.COLUMN_NAME));
  for (const colDef of issueColumns) {
    const colName = parseColumnName(colDef);
    if (!existingIssueSet.has(colName)) {
      await db.query(`ALTER TABLE \`issues\` ADD COLUMN ${colDef}`);
      console.log('新增问题表字段:', colName);
    }
  }
  for (const colDef of issueColumns) {
    await db.query(`ALTER TABLE \`issues\` MODIFY COLUMN ${colDef}`);
  }

  // 创建问题评论表
  const createIssueCommentsSql = `
    CREATE TABLE IF NOT EXISTS \`issue_comments\` (
      ${issueCommentColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      KEY \`idx_comment_issue_id\` (\`issue_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createIssueCommentsSql);

  // 为已存在的评论表补充缺失字段
  const [existingCommentCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'issue_comments']
  );
  const existingCommentSet = new Set(existingCommentCols.map(c => c.COLUMN_NAME));
  for (const colDef of issueCommentColumns) {
    const colName = parseColumnName(colDef);
    if (!existingCommentSet.has(colName)) {
      await db.query(`ALTER TABLE \`issue_comments\` ADD COLUMN ${colDef}`);
      console.log('新增评论表字段:', colName);
    }
  }
  for (const colDef of issueCommentColumns) {
    await db.query(`ALTER TABLE \`issue_comments\` MODIFY COLUMN ${colDef}`);
  }

  // 创建邮件模板表
  const createEmailTemplatesSql = `
    CREATE TABLE IF NOT EXISTS \`email_templates\` (
      ${emailTemplateColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_template_code\` (\`code\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createEmailTemplatesSql);

  const [existingTplCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'email_templates']
  );
  const existingTplSet = new Set(existingTplCols.map(c => c.COLUMN_NAME));
  for (const colDef of emailTemplateColumns) {
    const colName = parseColumnName(colDef);
    if (!existingTplSet.has(colName)) {
      await db.query(`ALTER TABLE \`email_templates\` ADD COLUMN ${colDef}`);
      console.log('新增邮件模板表字段:', colName);
    }
  }
  for (const colDef of emailTemplateColumns) {
    await db.query(`ALTER TABLE \`email_templates\` MODIFY COLUMN ${colDef}`);
  }

  // 创建邮件发送日志表
  const createEmailLogsSql = `
    CREATE TABLE IF NOT EXISTS \`email_logs\` (
      ${emailLogColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_email_token\` (\`token\`),
      KEY \`idx_log_issue_id\` (\`issue_id\`),
      KEY \`idx_log_message_id\` (\`message_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createEmailLogsSql);

  const [existingLogCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'email_logs']
  );
  const existingLogSet = new Set(existingLogCols.map(c => c.COLUMN_NAME));
  for (const colDef of emailLogColumns) {
    const colName = parseColumnName(colDef);
    if (!existingLogSet.has(colName)) {
      await db.query(`ALTER TABLE \`email_logs\` ADD COLUMN ${colDef}`);
      console.log('新增邮件日志表字段:', colName);
    }
  }
  for (const colDef of emailLogColumns) {
    await db.query(`ALTER TABLE \`email_logs\` MODIFY COLUMN ${colDef}`);
  }

  // 创建催办规则表
  const createEscalationRulesSql = `
    CREATE TABLE IF NOT EXISTS \`escalation_rules\` (
      ${escalationRuleColumns.join(',\n      ')},
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await query(createEscalationRulesSql);

  const [existingRuleCols] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, 'escalation_rules']
  );
  const existingRuleSet = new Set(existingRuleCols.map(c => c.COLUMN_NAME));
  for (const colDef of escalationRuleColumns) {
    const colName = parseColumnName(colDef);
    if (!existingRuleSet.has(colName)) {
      await db.query(`ALTER TABLE \`escalation_rules\` ADD COLUMN ${colDef}`);
      console.log('新增催办规则表字段:', colName);
    }
  }
  for (const colDef of escalationRuleColumns) {
    await db.query(`ALTER TABLE \`escalation_rules\` MODIFY COLUMN ${colDef}`);
  }

  // 邮件催办种子数据（仅当表为空时插入）
  const [ruleCount] = await db.execute('SELECT COUNT(*) AS c FROM escalation_rules');
  if (ruleCount[0].c === 0) {
    await db.query(
      `INSERT INTO escalation_rules (name, severity, days_before_due, days_after_due, to_roles, cc_roles, template_code, enabled, min_interval_hours) VALUES
       ('临期 1 天提醒责任人', NULL, 1, NULL, 'assignee', NULL, 'issue_escalation', 1, 24),
       ('逾期 1 天提醒责任人并抄送项目经理', NULL, NULL, 1, 'assignee', 'manager', 'issue_escalation', 1, 24),
       ('逾期 3 天升级抄送部门领导', NULL, NULL, 3, 'assignee', 'manager,leader', 'issue_escalation', 1, 24)`
    );
    console.log('插入默认催办规则: 3 条');
  }
  const [tplCount] = await db.execute('SELECT COUNT(*) AS c FROM email_templates');
  if (tplCount[0].c === 0) {
    await db.query(
      `INSERT INTO email_templates (code, name, subject, body) VALUES
       ('issue_escalation', '问题催办', '【项目问题催办】{{issue_no}} {{title}}', '问题编号：{{issue_no}}\n问题标题：{{title}}\n所属项目：{{project_name}}\n责任人：{{assignee}}\n期望解决日期：{{due_date}}\n逾期天数：{{overdue_days}}\n\n问题链接：{{detail_url}}\n我已处理：{{ack_url}}\n'),
       ('progress_reminder', '每周进展提醒', '【进展提醒】以下项目超过 14 天未更新进展', '以下项目超过 14 天未更新进展（或从未填报），请提醒项目经理及时填报：\n\n{{stale_projects}}\n\n项目跟踪系统')`
    );
    console.log('插入默认邮件模板: 2 个');
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
  issueColumns,
  issueCommentColumns,
  emailTemplateColumns, emailLogColumns, escalationRuleColumns,
  setDbConfig,
  getDbConfig,
};
