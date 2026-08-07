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
const progressAddBtn = document.getElementById('progressAddBtn');
const progressModal = document.getElementById('progressModal');
const progressModalTitle = document.getElementById('progressModalTitle');
const progressModalError = document.getElementById('progressModalError');
const progressForm = document.getElementById('progressForm');
const progressCancelBtn = document.getElementById('progressCancelBtn');
const pfReportDate = document.getElementById('pfReportDate');
const pfCompleted = document.getElementById('pfCompleted');
const pfNextPlan = document.getElementById('pfNextPlan');
const pfRisk = document.getElementById('pfRisk');
const pfReporter = document.getElementById('pfReporter');
const tagCheckboxes = Array.from(document.querySelectorAll('.progress-tag-cb'));
const issuesSection = document.getElementById('issuesSection');
const issuesError = document.getElementById('issuesError');
const issuesList = document.getElementById('issuesList');
const issueAddLink = document.getElementById('issueAddLink');

let editingProgressId = null;

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
    progressAddBtn.addEventListener('click', () => openProgressModal(null));
    attachTableEditor(pfCompleted, document.getElementById('pfCompletedTableBtn'));
    progressCancelBtn.addEventListener('click', closeProgressModal);
    progressForm.addEventListener('submit', submitProgressForm);
    progressTimeline.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.progress-edit');
      if (editBtn) {
        const item = progressItems.find(p => String(p.id) === editBtn.getAttribute('data-id'));
        if (item) openProgressModal(item);
        return;
      }
      const delBtn = e.target.closest('.progress-del');
      if (delBtn) deleteProgress(delBtn.getAttribute('data-id'));
    });
    loadProgress();
    issueAddLink.href = `issue_detail.html?new=1&project_id=${projectId}`;
    loadIssues();
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
    progressTimeline.innerHTML = '<div class="progress-empty">暂无进展记录，点击右上角「填报进展」录入第一条</div>';
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
        <span class="timeline-actions">
          <button class="btn-small progress-edit" data-id="${item.id}">编辑</button>
          <button class="btn-small progress-del" data-id="${item.id}">删除</button>
        </span>
      </div>
      <div class="timeline-body">
        <div class="timeline-field"><span class="timeline-label">完成内容</span><div class="timeline-value">${renderMarkdownTables(item.completed_content || '')}</div></div>
        ${item.next_plan ? `<div class="timeline-field"><span class="timeline-label">下阶段计划</span><div class="timeline-value">${renderMarkdownTables(item.next_plan)}</div></div>` : ''}
        ${item.risk_note ? `<div class="timeline-field"><span class="timeline-label">风险说明</span><div class="timeline-value timeline-risk">${renderMarkdownTables(item.risk_note)}</div></div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openProgressModal(item) {
  progressModalError.style.display = 'none';
  editingProgressId = item ? item.id : null;
  progressModalTitle.textContent = item ? '编辑进展' : '填报进展';
  pfReportDate.value = item ? formatDate(item.report_date) : new Date().toISOString().slice(0, 10);
  pfCompleted.value = item ? (item.completed_content || '') : '';
  pfNextPlan.value = item ? (item.next_plan || '') : '';
  pfRisk.value = item ? (item.risk_note || '') : '';
  const tags = item ? (item.tags || '').split(',').map(s => s.trim()) : [];
  for (const cb of tagCheckboxes) cb.checked = tags.includes(cb.value);
  pfReporter.value = item ? (item.reporter || '') : (localStorage.getItem('progress_reporter') || '');
  progressModal.style.display = 'flex';
}

function closeProgressModal() {
  progressModal.style.display = 'none';
}

async function submitProgressForm(e) {
  e.preventDefault();
  // POST 非幂等，在途禁用提交按钮防止连点重复插入
  const submitBtn = progressForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  progressModalError.style.display = 'none';
  const payload = {
    report_date: pfReportDate.value,
    completed_content: pfCompleted.value,
    next_plan: pfNextPlan.value,
    risk_note: pfRisk.value,
    tags: tagCheckboxes.filter(cb => cb.checked).map(cb => cb.value).join(','),
    reporter: pfReporter.value,
  };
  try {
    const isEdit = editingProgressId !== null;
    const url = isEdit
      ? `${API_BASE}/api/progress/${editingProgressId}`
      : `${API_BASE}/api/projects/${projectId}/progress`;
    const resp = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(result.message || result.error || `HTTP ${resp.status}`);
    if (payload.reporter) localStorage.setItem('progress_reporter', payload.reporter);
    closeProgressModal();
    await loadProgress();
  } catch (err) {
    progressModalError.textContent = '保存失败：' + err.message;
    progressModalError.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
  }
}

async function deleteProgress(id) {
  if (!confirm('确定删除这条进展记录吗？')) return;
  try {
    const resp = await fetch(`${API_BASE}/api/progress/${id}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await loadProgress();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

function severityClass(s) {
  return { '一般': 'normal', '重要': 'important', '紧急': 'urgent' }[s] || 'normal';
}

function issueStatusClass(s) {
  return { '新建': 'new', '处理中': 'doing', '待确认': 'confirm', '已解决': 'resolved', '已关闭': 'closed' }[s] || 'new';
}

async function loadIssues() {
  issuesError.style.display = 'none';
  try {
    const resp = await fetch(`${API_BASE}/api/issues?project_id=${projectId}&pageSize=100`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载问题失败');
    renderIssues(result.data || []);
  } catch (err) {
    issuesList.innerHTML = '';
    issuesError.textContent = '问题加载失败：' + err.message;
    issuesError.style.display = 'block';
  }
}

function renderIssues(items) {
  if (items.length === 0) {
    issuesList.innerHTML = '<div class="issues-empty">暂无问题记录</div>';
    return;
  }
  issuesList.innerHTML = items.map(issue => `
    <div class="issue-row">
      <a class="issue-no" href="issue_detail.html?id=${issue.id}">${escapeHtml(issue.issue_no)}</a>
      <span class="issue-title">${escapeHtml(issue.title)}</span>
      <span class="badge badge-severity-${severityClass(issue.severity)}">${escapeHtml(issue.severity)}</span>
      <span class="badge badge-issue-${issueStatusClass(issue.status)}">${escapeHtml(issue.status)}</span>
      <span class="issue-due">${issue.due_date ? '期望 ' + formatDate(issue.due_date) : ''}</span>
      ${issue.is_overdue ? `<span class="overdue-text">逾期 ${issue.overdue_days} 天</span>` : ''}
    </div>`).join('');
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
