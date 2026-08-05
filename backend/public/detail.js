const API_BASE = window.location.origin;

const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('id');

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const detailCard = document.getElementById('detailCard');
const detailBody = document.getElementById('detailBody');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const editLink = document.getElementById('editLink');
const detailBodyAfter = document.getElementById('detailBodyAfter');
const progressFrom = document.getElementById('progressFrom');
const progressTo = document.getElementById('progressTo');
const progressFilterBtn = document.getElementById('progressFilterBtn');
const progressClearBtn = document.getElementById('progressClearBtn');
const progressError = document.getElementById('progressError');
const progressTimeline = document.getElementById('progressTimeline');

let progressItems = [];

// 分区字段（字段名与 projects 表一致；跟踪信息置顶，后续阶段在此页追加进展/问题分区）
const SECTIONS = [
  { title: '跟踪信息', fields: ['project_status', 'health_status', 'planned_start_date', 'planned_end_date'] },
  {
    title: '基本信息',
    fields: ['project_code', 'project_name', 'category', 'doc_number', 'approval_date', 'design_date',
      'completion_date', 'project_set', 'project_subset', 'build_level', 'listed', 'region', 'is_rnd',
      'decision_method', 'change_status'],
  },
  {
    title: '责任信息',
    fields: ['planning_manager', 'project_manager', 'investment_dept', 'investment_person',
      'engineering_dept', 'engineering_person', 'software_dept', 'software_person',
      'maintenance_dept', 'maintenance_person', 'procurement_dept', 'procurement_person'],
  },
  {
    title: '金额信息',
    fields: ['approval_amount', 'amount_note', 'estimated_actual', 'releasable_amount',
      'design_amount', 'completion_amount'],
  },
  {
    title: '预算与备注',
    fields: ['mid_year_budget', 'budget_increase', 'undecided_supplement', 'decided_budget',
      'decided_in_project', 'undecided_in_project', 'remarks'],
  },
];

let columnComments = {};
let project = {};

async function init() {
  if (!projectId) {
    showError('缺少项目 ID 参数');
    hideLoading();
    return;
  }
  try {
    await Promise.all([loadColumns(), loadData()]);
    renderDetail();
    progressFilterBtn.addEventListener('click', () => loadProgress());
    progressClearBtn.addEventListener('click', () => {
      progressFrom.value = '';
      progressTo.value = '';
      loadProgress();
    });
    loadProgress();
    hideLoading();
    detailCard.style.display = 'block';
  } catch (err) {
    hideLoading();
    showError(err.message);
  }
}

async function loadColumns() {
  const resp = await fetch(`${API_BASE}/api/projects/columns`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const result = await resp.json();
  if (!result.success) throw new Error(result.error || '加载字段注释失败');
  for (const col of result.data || []) {
    columnComments[col.field] = col.comment || col.field;
  }
}

async function loadData() {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}`);
  if (resp.status === 404) throw new Error('项目不存在或已被删除');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const result = await resp.json();
  if (!result.success) throw new Error(result.error || '加载项目失败');
  project = result.data || {};
}

function renderDetail() {
  pageTitle.textContent = project.project_name || '项目详情';
  pageSubtitle.textContent = project.project_code ? `项目编码：${project.project_code}` : '';
  editLink.href = `edit.html?id=${projectId}`;

  const renderSections = (sections) => sections.map(section => {
    const items = section.fields.map(field => {
      const label = escapeHtml(columnComments[field] || field);
      return `<div class="detail-item"><span class="label">${label}</span><span class="value">${renderValue(field)}</span></div>`;
    }).join('');
    return `<section class="detail-section"><h2>${section.title}</h2><div class="detail-grid">${items}</div></section>`;
  }).join('');
  // 跟踪信息在前，进展分区居中（detail.html 静态 markup），其余分区在后
  detailBody.innerHTML = renderSections([SECTIONS[0]]);
  detailBodyAfter.innerHTML = renderSections(SECTIONS.slice(1));
}

function renderValue(field) {
  const val = project[field];
  if (val === null || val === undefined || val === '') return '<span style="color: var(--ink-mute);">—</span>';
  if (field === 'project_status') {
    return `<span class="badge badge-status-${statusClass(val)}">${escapeHtml(val)}</span>`;
  }
  if (field === 'health_status') {
    return `<span class="badge badge-health-${healthClass(val)}">${escapeHtml(val)}</span>`;
  }
  if (field.endsWith('_date')) return formatDate(val);
  if (field.endsWith('_amount')) return formatNumber(val);
  return escapeHtml(val);
}

async function loadProgress() {
  progressError.style.display = 'none';
  try {
    const params = new URLSearchParams();
    if (progressFrom.value) params.append('from', progressFrom.value);
    if (progressTo.value) params.append('to', progressTo.value);
    const qs = params.toString();
    const resp = await fetch(`${API_BASE}/api/projects/${projectId}/progress${qs ? '?' + qs : ''}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载进展失败');
    progressItems = result.data || [];
    renderProgressTimeline(progressItems);
  } catch (err) {
    progressTimeline.innerHTML = '';
    progressError.textContent = '进展加载失败：' + err.message;
    progressError.style.display = 'block';
  }
}

function progressTagClass(tag) {
  return { '里程碑达成': 'milestone', '风险上升': 'risk', '需领导决策': 'decision' }[tag] || 'milestone';
}

function renderProgressTimeline(items) {
  if (items.length === 0) {
    progressTimeline.innerHTML = '<div class="progress-empty">暂无进展记录</div>';
    return;
  }
  progressTimeline.innerHTML = items.map(item => {
    const tags = (item.tags || '').split(',').map(s => s.trim()).filter(Boolean);
    const tagsHtml = tags.map(t => `<span class="badge badge-tag-${progressTagClass(t)}">${escapeHtml(t)}</span>`).join(' ');
    return `<div class="timeline-item">
      <div class="timeline-head">
        <span class="timeline-date">${formatDate(item.report_date)}</span>
        ${item.reporter ? `<span class="timeline-reporter">${escapeHtml(item.reporter)}</span>` : ''}
        ${tagsHtml}
      </div>
      <div class="timeline-body">
        <div class="timeline-field"><span class="timeline-label">完成内容</span><div class="timeline-value">${escapeHtml(item.completed_content || '')}</div></div>
        ${item.next_plan ? `<div class="timeline-field"><span class="timeline-label">下阶段计划</span><div class="timeline-value">${escapeHtml(item.next_plan)}</div></div>` : ''}
        ${item.risk_note ? `<div class="timeline-field"><span class="timeline-label">风险说明</span><div class="timeline-value timeline-risk">${escapeHtml(item.risk_note)}</div></div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function statusClass(status) {
  return { '未启动': 'idle', '进行中': 'active', '已暂停': 'paused', '已结项': 'done' }[status] || 'idle';
}

function healthClass(health) {
  return { '正常': 'ok', '关注': 'warn', '风险': 'danger' }[health] || 'ok';
}

function hideLoading() {
  loadingEl.style.display = 'none';
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
}

function formatNumber(num) {
  if (num === null || num === undefined || num === '') return '';
  return Number(num).toLocaleString('zh-CN');
}

init();
