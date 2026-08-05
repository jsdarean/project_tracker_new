const path = require('path');
const fs = require('fs').promises;
const { projectColumns, getDbConfig } = require('./db');

// 本地归档设置文件
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// 邮件催办配置默认值（POST /api/settings 与 loadSettings 共用）
const EMAIL_DEFAULTS = {
  smtp_host: '', smtp_port: 465, smtp_secure: true, smtp_user: '', smtp_pass: '', mail_from: '',
  imap_host: '', imap_port: 993, imap_secure: true, imap_user: '', imap_pass: '',
  imap_mailbox: 'INBOX', bounce_scan_enabled: false, cron_bounce: '*/30 * * * *',
  leader_emails: '', public_base_url: 'http://localhost:3000',
  escalation_enabled: false, send_on_weekend: false,
  cron_daily: '0 9 * * *', cron_weekly: '0 9 * * 1',
};

// 默认导出字段（排除系统字段）
const defaultExportFields = projectColumns
  .map(def => {
    const m = def.match(/^`([^`]+)`/);
    return m ? m[1] : '';
  })
  .filter(f => f && !['id', 'created_at', 'updated_at', 'status'].includes(f));

async function loadSettings() {
  const dbCfg = getDbConfig();
  const defaults = {
    archive_folder: '',
    download_dir: path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads'),
    db_host: dbCfg.host,
    db_port: dbCfg.port,
    db_user: dbCfg.user,
    db_password: dbCfg.password,
    db_name: dbCfg.database,
    export_fields: defaultExportFields,
    watch_tags: [
      { name: '领导关注', color: '#ea2261' },
      { name: '涉及考核', color: '#9b6829' },
    ],
    ...EMAIL_DEFAULTS,
  };
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (err) {
    return defaults;
  }
}

async function saveSettings(settings) {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

module.exports = { loadSettings, saveSettings, SETTINGS_FILE, EMAIL_DEFAULTS };
