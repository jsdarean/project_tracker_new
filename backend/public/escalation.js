const API_BASE = window.location.origin;

const rulesBody = document.getElementById('rulesBody');
const templatesBody = document.getElementById('templatesBody');
const logsBody = document.getElementById('logsBody');
const ruleModal = document.getElementById('ruleModal');
const ruleModalTitle = document.getElementById('ruleModalTitle');
const logStatusFilter = document.getElementById('logStatusFilter');
const logPageInfo = document.getElementById('logPageInfo');
const logPrevBtn = document.getElementById('logPrevBtn');
const logNextBtn = document.getElementById('logNextBtn');

let templates = [];
let editingRuleId = null;
let logPage = 1;
let logTotal = 0;
const LOG_SIZE = 20;

async function api(path, options) {
  const resp = await fetch(`${API_BASE}${path}`, options);
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(result.message || result.error || `HTTP ${resp.status}`);
  return result;
}

/* ---------- 规则 ---------- */
async function loadRules() {
  try {
    const result = await api('/api/escalation/rules');
    renderRules(result.data || []);
  } catch (err) {
    rulesBody.innerHTML = `<tr><td colspan="9" class="muted">加载失败：${escapeHtml(err.message)}</td></tr>`;
  }
}

function triggerText(rule) {
  if (rule.days_before_due !== null && rule.days_before_due !== undefined) return `临期 ${rule.days_before_due} 天`;
  return `逾期 ${rule.days_after_due} 天`;
}

function renderRules(rules) {
  if (rules.length === 0) {
    rulesBody.innerHTML = '<tr><td colspan="9" class="muted">暂无规则</td></tr>';
    return;
  }
  rulesBody.innerHTML = rules.map(rule => `
    <tr>
      <td>${escapeHtml(rule.name)}</td>
      <td>${escapeHtml(rule.severity || '全部')}</td>
      <td>${escapeHtml(triggerText(rule))}</td>
      <td>${escapeHtml(rule.to_roles)}</td>
      <td>${escapeHtml(rule.cc_roles || '')}</td>
      <td>${escapeHtml(rule.template_code || '')}</td>
      <td>${rule.min_interval_hours}</td>
      <td><input type="checkbox" class="rule-enabled" data-id="${rule.id}" ${rule.enabled ? 'checked' : ''}></td>
      <td>
        <button class="btn-small rule-edit" data-id="${rule.id}">编辑</button>
        <button class="btn-small rule-del" data-id="${rule.id}">删除</button>
      </td>
    </tr>`).join('');

  rulesBody.querySelectorAll('.rule-enabled').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api(`/api/escalation/rules/${cb.getAttribute('data-id')}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: cb.checked ? 1 : 0 }),
      });
    });
  });
  rulesBody.querySelectorAll('.rule-edit').forEach(btn => {
    btn.addEventListener('click', () => openRuleModal(rules.find(r => String(r.id) === btn.getAttribute('data-id'))));
  });
  rulesBody.querySelectorAll('.rule-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除该规则吗？')) return;
      await api(`/api/escalation/rules/${btn.getAttribute('data-id')}`, { method: 'DELETE' });
      loadRules();
    });
  });
}

function openRuleModal(rule) {
  editingRuleId = rule ? rule.id : null;
  ruleModalTitle.textContent = rule ? '编辑规则' : '新建规则';
  document.getElementById('rName').value = rule ? rule.name : '';
  document.getElementById('rSeverity').value = rule ? (rule.severity || '') : '';
  const isBefore = rule && rule.days_before_due !== null && rule.days_before_due !== undefined;
  document.getElementById('rTriggerType').value = isBefore ? 'before' : 'after';
  document.getElementById('rDays').value = rule ? (isBefore ? rule.days_before_due : rule.days_after_due) : 1;
  document.getElementById('rInterval').value = rule ? rule.min_interval_hours : 24;
  const toRoles = rule ? String(rule.to_roles || '').split(',') : ['assignee'];
  const ccRoles = rule ? String(rule.cc_roles || '').split(',') : [];
  document.querySelectorAll('.rToRole').forEach(cb => { cb.checked = toRoles.includes(cb.value); });
  document.querySelectorAll('.rCcRole').forEach(cb => { cb.checked = ccRoles.includes(cb.value); });
  const tplSelect = document.getElementById('rTemplate');
  tplSelect.innerHTML = '<option value="">内置兜底模板</option>' +
    templates.map(t => `<option value="${escapeHtml(t.code)}" ${rule && rule.template_code === t.code ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
  ruleModal.style.display = 'flex';
}

async function saveRule() {
  const name = document.getElementById('rName').value.trim();
  const days = parseInt(document.getElementById('rDays').value, 10);
  const isBefore = document.getElementById('rTriggerType').value === 'before';
  const toRoles = [...document.querySelectorAll('.rToRole:checked')].map(cb => cb.value).join(',');
  const ccRoles = [...document.querySelectorAll('.rCcRole:checked')].map(cb => cb.value).join(',');
  if (!name) { alert('请填写规则名称'); return; }
  if (!toRoles) { alert('请至少选择一个收件人角色'); return; }
  const payload = {
    name,
    severity: document.getElementById('rSeverity').value || null,
    days_before_due: isBefore ? days : null,
    days_after_due: isBefore ? null : days,
    to_roles: toRoles,
    cc_roles: ccRoles || null,
    template_code: document.getElementById('rTemplate').value || null,
    min_interval_hours: parseInt(document.getElementById('rInterval').value, 10) || 24,
  };
  try {
    await api(editingRuleId ? `/api/escalation/rules/${editingRuleId}` : '/api/escalation/rules', {
      method: editingRuleId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    ruleModal.style.display = 'none';
    loadRules();
  } catch (err) {
    alert('保存失败：' + err.message);
  }
}

/* ---------- 模板 ---------- */
async function loadTemplates() {
  try {
    const result = await api('/api/escalation/templates');
    templates = result.data || [];
    renderTemplates();
  } catch (err) {
    templatesBody.innerHTML = `<div class="muted" style="padding: 0 var(--space-lg);">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function renderTemplates() {
  templatesBody.innerHTML = templates.map(t => `
    <div class="tpl-item" style="padding: 0 var(--space-lg) var(--space-md);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <strong>${escapeHtml(t.name)}</strong> <span class="muted">${escapeHtml(t.code)}</span>
        <button class="btn-small tpl-toggle" data-id="${t.id}">编辑</button>
      </div>
      <div class="tpl-edit" id="tplEdit-${t.id}" style="display: none; margin-top: var(--space-sm);">
        <label class="muted">主题</label>
        <input id="tplSubject-${t.id}" value="${escapeHtml(t.subject || '')}">
        <label class="muted">正文（占位符：{{issue_no}} {{title}} {{assignee}} {{due_date}} {{overdue_days}} {{project_name}} {{detail_url}} {{ack_url}} {{stale_projects}}）</label>
        <textarea id="tplBody-${t.id}">${escapeHtml(t.body || '')}</textarea>
        <div style="margin-top: var(--space-sm);"><button class="btn-primary tpl-save" data-id="${t.id}">保存</button></div>
      </div>
    </div>`).join('');

  templatesBody.querySelectorAll('.tpl-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(`tplEdit-${btn.getAttribute('data-id')}`);
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    });
  });
  templatesBody.querySelectorAll('.tpl-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      try {
        await api(`/api/escalation/templates/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: document.getElementById(`tplSubject-${id}`).value,
            body: document.getElementById(`tplBody-${id}`).value,
          }),
        });
        alert('✅ 已保存');
        loadTemplates();
      } catch (err) {
        alert('保存失败：' + err.message);
      }
    });
  });
}

/* ---------- 日志 ---------- */
async function loadLogs() {
  try {
    const params = new URLSearchParams({ page: logPage, pageSize: LOG_SIZE });
    if (logStatusFilter.value) params.append('status', logStatusFilter.value);
    const result = await api(`/api/escalation/logs?${params.toString()}`);
    logTotal = result.total || 0;
    renderLogs(result.data || []);
  } catch (err) {
    logsBody.innerHTML = `<tr><td colspan="6" class="muted">加载失败：${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderLogs(logs) {
  if (logs.length === 0) {
    logsBody.innerHTML = '<tr><td colspan="6" class="muted">暂无日志</td></tr>';
  } else {
    logsBody.innerHTML = logs.map(log => `
      <tr>
        <td>${escapeHtml(formatDateTime(log.sent_at))}</td>
        <td>${log.issue_no ? `<a href="issue_detail.html?id=${log.issue_id}">${escapeHtml(log.issue_no)}</a>` : '<span class="muted">—</span>'}</td>
        <td title="${escapeHtml(log.recipients || '')}">${escapeHtml(truncate(log.recipients || '', 30))}</td>
        <td title="${escapeHtml(log.subject || '')}">${escapeHtml(truncate(log.subject || '', 30))}</td>
        <td><span class="log-status log-${escapeHtml(log.status)}">${escapeHtml(log.status)}</span></td>
        <td title="${escapeHtml(log.error_msg || '')}">${escapeHtml(truncate(log.error_msg || '', 30))}</td>
      </tr>`).join('');
  }
  const pages = Math.ceil(logTotal / LOG_SIZE) || 1;
  logPageInfo.textContent = `第 ${logPage} / ${pages} 页，共 ${logTotal} 条`;
  logPrevBtn.disabled = logPage <= 1;
  logNextBtn.disabled = logPage >= pages;
}

/* ---------- 工具 ---------- */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}
function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- 事件 ---------- */
document.getElementById('ruleAddBtn').addEventListener('click', () => openRuleModal(null));
document.getElementById('ruleSaveBtn').addEventListener('click', saveRule);
document.getElementById('ruleCancelBtn').addEventListener('click', () => { ruleModal.style.display = 'none'; });
document.getElementById('logRefreshBtn').addEventListener('click', () => { logPage = 1; loadLogs(); });
logStatusFilter.addEventListener('change', () => { logPage = 1; loadLogs(); });
logPrevBtn.addEventListener('click', () => { if (logPage > 1) { logPage--; loadLogs(); } });
logNextBtn.addEventListener('click', () => {
  const pages = Math.ceil(logTotal / LOG_SIZE) || 1;
  if (logPage < pages) { logPage++; loadLogs(); }
});

(async function init() {
  await loadTemplates();
  await Promise.all([loadRules(), loadLogs()]);
})();
