// 真实库迁移验证：确认存量数据未受影响、新字段已就位
// 一次性验证脚本，不入库运维流程，仅本次验证用。
// 注意：initDatabase 直接用 db.js 默认配置，settings.json 是 server.js 的 start() 才加载的，
// 因此这里先 setDbConfig 再调 initDatabase（对真实库执行幂等迁移，补齐 4 个新字段和索引）。
const fs = require('fs');
const path = require('path');
const db = require('../db');

const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings.json'), 'utf8'));
db.setDbConfig({
  host: s.db_host,
  port: Number(s.db_port) || 3306,
  user: s.db_user,
  password: s.db_password,
  database: s.db_name,
});

(async () => {
  // 对真实库执行幂等迁移（补 4 个字段和索引；已存在则不再重复新增）
  await db.initDatabase();

  const rows = await db.query('SELECT COUNT(*) AS c FROM projects');
  const col = await db.query(`SHOW COLUMNS FROM projects LIKE 'project_status'`);
  const defaults = await db.query(
    `SELECT project_status, health_status, COUNT(*) AS c FROM projects GROUP BY project_status, health_status`
  );
  console.log('存量行数:', rows[0].c);
  console.log('project_status 字段存在:', col.length === 1);
  console.log('存量行默认状态分布:', defaults);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
