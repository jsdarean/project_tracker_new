const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { setup, teardown } = require('./helpers').createTestContext('project_tracker_test_settings');

const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');
let baseUrl;
let backup;
let current;

test.before(async () => {
  backup = fs.readFileSync(SETTINGS_FILE, 'utf8');
  current = JSON.parse(backup);
  ({ baseUrl } = await setup());
});
test.after(async () => {
  fs.writeFileSync(SETTINGS_FILE, backup);
  await teardown();
});

function basePayload(emailFields = {}) {
  return {
    archive_folder: current.archive_folder,
    download_dir: current.download_dir,
    db_host: current.db_host,
    db_port: current.db_port,
    db_user: current.db_user,
    db_password: current.db_password,
    db_name: current.db_name,
    ...emailFields,
  };
}

test('POST /api/settings 保存邮件字段，GET 脱敏密码', async () => {
  const resp = await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(basePayload({
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_user: 'noreply@example.com',
      smtp_pass: 'secret-smtp',
      imap_host: 'imap.example.com',
      imap_pass: 'secret-imap',
      leader_emails: 'boss@example.com',
      escalation_enabled: true,
    })),
  });
  assert.strictEqual(resp.status, 200);

  const get = await fetch(`${baseUrl}/api/settings`);
  const body = await get.json();
  assert.strictEqual(body.data.smtp_host, 'smtp.example.com');
  assert.strictEqual(body.data.leader_emails, 'boss@example.com');
  assert.strictEqual(body.data.escalation_enabled, true);
  assert.strictEqual(body.data.smtp_pass, '', 'smtp_pass 应脱敏');
  assert.strictEqual(body.data.imap_pass, '', 'imap_pass 应脱敏');

  const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  assert.strictEqual(raw.smtp_pass, 'secret-smtp', '磁盘上应保存明文（服务端使用）');
});

test('POST 时密码留空保留旧值，imap_last_uid 不被抹掉', async () => {
  // 先写入一次带密码与 uid 状态
  const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  raw.imap_last_uid = 12345;
  raw.imap_uidvalidity = '777';
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(raw, null, 2));

  const resp = await fetch(`${baseUrl}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(basePayload({ smtp_host: 'smtp2.example.com' })),
  });
  assert.strictEqual(resp.status, 200);

  const after = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  assert.strictEqual(after.smtp_host, 'smtp2.example.com');
  assert.strictEqual(after.smtp_pass, 'secret-smtp', '密码留空应保留旧值');
  assert.strictEqual(after.imap_last_uid, 12345, 'imap_last_uid 不应被抹掉');
  assert.strictEqual(after.imap_uidvalidity, '777');
});
