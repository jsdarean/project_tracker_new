const path = require('path');
const fs = require('fs');

// 连接信息取 settings.json 或环境变量；库名由各测试文件通过 createTestContext 指定
const settingsPath = path.join(__dirname, '..', 'settings.json');
let baseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};
if (fs.existsSync(settingsPath)) {
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (s.db_host) {
    baseConfig = {
      host: s.db_host,
      port: Number(s.db_port) || 3306,
      user: s.db_user,
      password: s.db_password,
    };
  }
}

function createTestContext(dbName) {
  const db = require('../db');
  db.setDbConfig({ ...baseConfig, database: dbName });
  const { app } = require('../server');

  let server = null;

  async function setup() {
    await db.initDatabase();
    await new Promise((resolve) => {
      server = app.listen(0, () => resolve());
    });
    return { baseUrl: `http://127.0.0.1:${server.address().port}` };
  }

  async function teardown() {
    if (server) await new Promise((r) => server.close(r));
    const pool = db.getPool();
    await pool.execute(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await pool.end();
  }

  return { setup, teardown, db, dbName };
}

module.exports = { createTestContext };
