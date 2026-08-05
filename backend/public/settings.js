const API_BASE = window.location.origin;

const archiveFolderInput = document.getElementById('archiveFolder');
const downloadDirInput = document.getElementById('downloadDir');
const dbHostInput = document.getElementById('dbHost');
const dbPortInput = document.getElementById('dbPort');
const dbUserInput = document.getElementById('dbUser');
const dbPasswordInput = document.getElementById('dbPassword');
const dbNameInput = document.getElementById('dbName');
const testDbBtn = document.getElementById('testDbBtn');
const dbTestStatusEl = document.getElementById('dbTestStatus');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsStatusEl = document.getElementById('settingsStatus');
const exportFieldsEl = document.getElementById('exportFields');

const EMAIL_FIELD_IDS = ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'mailFrom',
  'imapHost', 'imapPort', 'imapSecure', 'imapUser', 'imapMailbox', 'bounceScanEnabled', 'cronBounce',
  'leaderEmails', 'publicBaseUrl', 'escalationEnabled', 'sendOnWeekend', 'cronDaily', 'cronWeekly'];
const emailEls = {};
for (const id of EMAIL_FIELD_IDS) emailEls[id] = document.getElementById(id);
const smtpPassInput = document.getElementById('smtpPass');
const imapPassInput = document.getElementById('imapPass');
const testMailTo = document.getElementById('testMailTo');
const testMailBtn = document.getElementById('testMailBtn');
const testMailStatus = document.getElementById('testMailStatus');

// 表单元素 id（驼峰）与 settings 键（蛇形）映射
const EMAIL_KEY_MAP = {
  smtpHost: 'smtp_host', smtpPort: 'smtp_port', smtpSecure: 'smtp_secure', smtpUser: 'smtp_user',
  mailFrom: 'mail_from',
  imapHost: 'imap_host', imapPort: 'imap_port', imapSecure: 'imap_secure', imapUser: 'imap_user',
  imapMailbox: 'imap_mailbox', bounceScanEnabled: 'bounce_scan_enabled', cronBounce: 'cron_bounce',
  leaderEmails: 'leader_emails', publicBaseUrl: 'public_base_url',
  escalationEnabled: 'escalation_enabled', sendOnWeekend: 'send_on_weekend',
  cronDaily: 'cron_daily', cronWeekly: 'cron_weekly',
};

let columnMeta = [];
let currentExportFields = [];
let watchTags = [];

async function loadColumns() {
  try {
    const resp = await fetch(`${API_BASE}/api/projects/columns`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载字段注释失败');
    columnMeta = (result.data || []).filter(c =>
      !['id', 'created_at', 'updated_at', 'status'].includes(c.field)
    );
  } catch (err) {
    console.error('加载字段注释失败:', err);
  }
}

function renderExportFields() {
  exportFieldsEl.innerHTML = '';
  if (columnMeta.length === 0) {
    exportFieldsEl.textContent = '加载字段列表失败，请刷新页面重试。';
    return;
  }
  for (const col of columnMeta) {
    const wrapper = document.createElement('div');
    wrapper.className = 'export-field-wrapper';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `export-field-${col.field}`;
    checkbox.value = col.field;
    checkbox.checked = currentExportFields.includes(col.field);
    const text = document.createElement('span');
    text.className = 'export-field-text';
    text.textContent = col.comment || col.field;
    text.title = col.comment || col.field;
    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    exportFieldsEl.appendChild(wrapper);
  }
}

function getSelectedExportFields() {
  const checkboxes = exportFieldsEl.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

/* ---------- 关注标签配置 ---------- */

const watchTagsListEl = document.getElementById('watchTagsList');
const newTagNameInput = document.getElementById('newTagName');
const newTagColorInput = document.getElementById('newTagColor');
const addTagBtn = document.getElementById('addTagBtn');

function renderWatchTags() {
  watchTagsListEl.innerHTML = '';
  if (watchTags.length === 0) {
    watchTagsListEl.innerHTML = '<div class="empty">暂无标签</div>';
    return;
  }
  watchTags.forEach((tag, idx) => {
    const item = document.createElement('div');
    item.className = 'watch-tag-item';
    item.innerHTML = `
      <span class="watch-tag-dot" style="background:${tag.color}"></span>
      <span class="watch-tag-name">${escapeHtml(tag.name)}</span>
      <input type="color" class="watch-tag-color" data-idx="${idx}" value="${tag.color}" title="修改颜色">
      <button type="button" class="btn-small watch-tag-del" data-idx="${idx}">删除</button>
    `;
    watchTagsListEl.appendChild(item);
  });

  watchTagsListEl.querySelectorAll('.watch-tag-color').forEach(input => {
    input.addEventListener('change', () => {
      watchTags[Number(input.dataset.idx)].color = input.value;
      renderWatchTags();
    });
  });
  watchTagsListEl.querySelectorAll('.watch-tag-del').forEach(btn => {
    btn.addEventListener('click', () => {
      watchTags.splice(Number(btn.dataset.idx), 1);
      renderWatchTags();
    });
  });
}

addTagBtn.addEventListener('click', () => {
  const name = newTagNameInput.value.trim();
  if (!name) {
    showSettingsStatus('请填写标签名称', 'error');
    return;
  }
  if (watchTags.some(t => t.name === name)) {
    showSettingsStatus('标签名称已存在', 'error');
    return;
  }
  watchTags.push({ name, color: newTagColorInput.value || '#533afd' });
  newTagNameInput.value = '';
  renderWatchTags();
});

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadSettingsUI() {
  try {
    await loadColumns();
    const resp = await fetch(`${API_BASE}/api/settings`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (result.success && result.data) {
      archiveFolderInput.value = result.data.archive_folder || '';
      downloadDirInput.value = result.data.download_dir || '';
      dbHostInput.value = result.data.db_host || '';
      dbPortInput.value = result.data.db_port || '';
      dbUserInput.value = result.data.db_user || '';
      dbPasswordInput.value = result.data.db_password || '';
      dbNameInput.value = result.data.db_name || '';
      currentExportFields = Array.isArray(result.data.export_fields) ? result.data.export_fields : [];
      watchTags = Array.isArray(result.data.watch_tags) ? result.data.watch_tags : [];
      for (const [id, key] of Object.entries(EMAIL_KEY_MAP)) {
        const v = result.data[key];
        if (v === undefined || v === null) continue;
        if (emailEls[id].tagName === 'SELECT') emailEls[id].value = String(v === true || v === 'true' || v === 1 ? 'true' : 'false');
        else emailEls[id].value = v;
      }
      smtpPassInput.value = '';
      imapPassInput.value = '';
    }
    renderExportFields();
    renderWatchTags();
  } catch (err) {
    console.error('加载设置失败:', err);
    showSettingsStatus('加载设置失败：' + err.message, 'error');
    renderExportFields();
  }
}

async function testDbConnection() {
  const payload = {
    db_host: dbHostInput.value.trim(),
    db_port: parseInt(dbPortInput.value, 10) || 3306,
    db_user: dbUserInput.value.trim(),
    db_password: dbPasswordInput.value,
    db_name: dbNameInput.value.trim(),
  };

  dbTestStatusEl.textContent = '测试中...';
  dbTestStatusEl.className = 'settings-status';

  try {
    const resp = await fetch(`${API_BASE}/api/db/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) {
      throw new Error(result.error || '连接失败');
    }
    dbTestStatusEl.textContent = '✅ ' + result.message;
    dbTestStatusEl.className = 'settings-status ok';
  } catch (err) {
    dbTestStatusEl.textContent = '❌ ' + err.message;
    dbTestStatusEl.className = 'settings-status error';
  }
}

async function saveAllSettings() {
  const payload = {
    archive_folder: archiveFolderInput.value.trim(),
    download_dir: downloadDirInput.value.trim(),
    db_host: dbHostInput.value.trim(),
    db_port: parseInt(dbPortInput.value, 10) || 3306,
    db_user: dbUserInput.value.trim(),
    db_password: dbPasswordInput.value,
    db_name: dbNameInput.value.trim(),
    export_fields: getSelectedExportFields(),
    watch_tags: watchTags,
  };

  for (const [id, key] of Object.entries(EMAIL_KEY_MAP)) {
    const el = emailEls[id];
    if (el.tagName === 'SELECT') payload[key] = el.value === 'true';
    else if (el.type === 'number') payload[key] = parseInt(el.value, 10) || 0;
    else payload[key] = el.value.trim();
  }
  if (smtpPassInput.value) payload.smtp_pass = smtpPassInput.value;
  if (imapPassInput.value) payload.imap_pass = imapPassInput.value;

  if (!payload.archive_folder) {
    showSettingsStatus('请填写归档文件夹路径', 'error');
    return;
  }
  if (!payload.download_dir) {
    showSettingsStatus('请填写浏览器默认下载目录', 'error');
    return;
  }

  try {
    const resp = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) {
      throw new Error(result.error || `保存失败 (${resp.status})`);
    }
    showSettingsStatus('✅ 设置已保存', 'ok');
  } catch (err) {
    showSettingsStatus('❌ ' + err.message, 'error');
  }
}

function showSettingsStatus(message, type) {
  settingsStatusEl.textContent = message;
  settingsStatusEl.className = 'settings-status ' + (type || '');
}

saveSettingsBtn.addEventListener('click', saveAllSettings);
testDbBtn.addEventListener('click', testDbConnection);

testMailBtn.addEventListener('click', async () => {
  const to = testMailTo.value.trim();
  if (!to) { testMailStatus.textContent = '请先填写测试收件地址'; testMailStatus.className = 'settings-status error'; return; }
  testMailStatus.textContent = '发送中...';
  testMailStatus.className = 'settings-status';
  try {
    const resp = await fetch(`${API_BASE}/api/escalation/test-mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(result.message || result.error || `HTTP ${resp.status}`);
    testMailStatus.textContent = '✅ 已发送，请查收';
    testMailStatus.className = 'settings-status ok';
  } catch (err) {
    testMailStatus.textContent = '❌ ' + err.message;
    testMailStatus.className = 'settings-status error';
  }
});

loadSettingsUI();
