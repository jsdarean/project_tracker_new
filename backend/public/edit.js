const API_BASE = window.location.origin;

const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('id');

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const editForm = document.getElementById('editForm');
const formFields = document.getElementById('formFields');
const deleteBtn = document.getElementById('deleteBtn');

let columnMeta = [];
let originalData = {};

// 不可编辑字段
const readonlyFields = new Set(['id', 'created_at', 'updated_at']);
// 长文本字段使用 textarea
const textareaFields = new Set(['source_url', 'extracted_text', 'remarks', 'change_status',
  'mid_year_budget', 'budget_increase', 'undecided_supplement', 'decided_budget',
  'decided_in_project', 'undecided_in_project']);
// VARCHAR 但语义为枚举的字段，渲染为下拉（与后端校验取值保持一致）
const selectFields = {
  project_status: ['未启动', '进行中', '已暂停', '已结项'],
  health_status: ['正常', '关注', '风险'],
};

async function init() {
  if (!projectId) {
    showError('缺少项目 ID 参数');
    hideLoading();
    return;
  }
  try {
    await Promise.all([loadColumns(), loadData()]);
    renderForm();
    bindEvents();
    hideLoading();
    editForm.style.display = 'block';
  } catch (err) {
    hideLoading();
    showError('初始化失败：' + err.message);
  }
}

async function loadColumns() {
  const resp = await fetch(`${API_BASE}/api/projects/columns`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const result = await resp.json();
  if (!result.success) throw new Error(result.error || '加载字段注释失败');
  columnMeta = result.data || [];
}

async function loadData() {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}`);
  if (!resp.ok) {
    if (resp.status === 404) throw new Error('记录不存在');
    throw new Error(`HTTP ${resp.status}`);
  }
  const result = await resp.json();
  if (!result.success) throw new Error(result.error || '加载记录失败');
  originalData = result.data || {};
}

function getInputType(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('date') && !t.includes('datetime') && !t.includes('timestamp')) return 'date';
  if (t.includes('decimal') || t.includes('float') || t.includes('double')) return 'number';
  if (t.includes('int')) return 'number';
  return 'text';
}

function parseEnumValues(type) {
  const m = type.match(/enum\(([^)]+)\)/i);
  if (!m) return null;
  return m[1]
    .split(',')
    .map(v => v.trim().replace(/^['"]|['"]$/g, ''));
}

// 预算相关 6 个字段 + 执行金额 4 个字段，强制排在变更页最末尾
const tailFields = [
  'mid_year_budget', 'budget_increase', 'undecided_supplement',
  'decided_budget', 'decided_in_project', 'undecided_in_project',
  'estimated_actual', 'releasable_amount', 'design_amount', 'completion_amount'
];

function renderForm() {
  formFields.innerHTML = '';

  const tailSet = new Set(tailFields);
  const mainCols = columnMeta.filter(c => !tailSet.has(c.field));
  const tailCols = tailFields
    .map(f => columnMeta.find(c => c.field === f))
    .filter(Boolean);

  for (const col of [...mainCols, ...tailCols]) {
    formFields.appendChild(renderField(col));
  }
}

function renderField(col) {
  const field = col.field;
  const comment = col.comment || field;
  const type = col.type || '';
  const value = originalData[field];

  const group = document.createElement('div');
  group.className = 'form-group';
  if (textareaFields.has(field) || type.toLowerCase().includes('text')) {
    group.classList.add('full-width');
  }

  const label = document.createElement('label');
  label.textContent = comment;
  label.htmlFor = `field-${field}`;
  group.appendChild(label);

  if (readonlyFields.has(field)) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `field-${field}`;
    input.name = field;
    input.value = value ?? '';
    input.className = 'readonly-field';
    input.readOnly = true;
    group.appendChild(input);
  } else if (selectFields[field]) {
    const select = document.createElement('select');
    select.id = `field-${field}`;
    select.name = field;
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '请选择';
    select.appendChild(emptyOption);
    for (const v of selectFields[field]) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (value === v) opt.selected = true;
      select.appendChild(opt);
    }
    group.appendChild(select);
  } else if (type.toLowerCase().includes('enum')) {
    const values = parseEnumValues(type);
    const select = document.createElement('select');
    select.id = `field-${field}`;
    select.name = field;
    // 空选项
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '请选择';
    select.appendChild(emptyOption);
    for (const v of values || []) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (value === v) opt.selected = true;
      select.appendChild(opt);
    }
    group.appendChild(select);
  } else if (textareaFields.has(field) || type.toLowerCase().includes('text')) {
    const textarea = document.createElement('textarea');
    textarea.id = `field-${field}`;
    textarea.name = field;
    textarea.value = value ?? '';
    group.appendChild(textarea);
  } else {
    const inputType = getInputType(type);
    const input = document.createElement('input');
    input.type = inputType;
    input.id = `field-${field}`;
    input.name = field;
    input.value = value ?? '';
    if (inputType === 'number') {
      input.step = type.toLowerCase().includes('int') ? '1' : '0.0001';
    }
    group.appendChild(input);
  }

  return group;
}

function collectData() {
  const data = {};
  for (const col of columnMeta) {
    const field = col.field;
    if (readonlyFields.has(field)) continue;

    const el = formFields.querySelector(`[name="${field}"]`);
    if (!el) continue;

    const type = col.type || '';
    let val = el.value;

    if (getInputType(type) === 'number' && val !== '') {
      const n = parseFloat(val);
      data[field] = isNaN(n) ? null : n;
    } else if (val === '') {
      data[field] = null;
    } else {
      data[field] = val;
    }
  }
  return data;
}

function bindEvents() {
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = collectData();
    try {
      const resp = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!resp.ok) {
        const result = await resp.json().catch(() => ({}));
        throw new Error(result.error || resp.statusText);
      }
      alert('✅ 保存成功');
      window.location.href = 'index.html';
    } catch (err) {
      alert('保存失败：' + err.message);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`确定删除记录 ${projectId} 吗？此操作不可恢复。`)) return;
    try {
      const resp = await fetch(`${API_BASE}/api/projects/${projectId}`, { method: 'DELETE' });
      if (!resp.ok) {
        const result = await resp.json().catch(() => ({}));
        throw new Error(result.error || resp.statusText);
      }
      alert('✅ 删除成功');
      window.location.href = 'index.html';
    } catch (err) {
      alert('删除失败：' + err.message);
    }
  });
}

function hideLoading() {
  loadingEl.style.display = 'none';
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

init();
