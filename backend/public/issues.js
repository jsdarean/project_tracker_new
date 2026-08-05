const API_BASE = window.location.origin;

let currentPage = 1;
const pageSize = 20;
let total = 0;

const statusFilter = document.getElementById('statusFilter');
const severityFilter = document.getElementById('severityFilter');
const projectFilter = document.getElementById('projectFilter');
const assigneeFilter = document.getElementById('assigneeFilter');
const keywordFilter = document.getElementById('keywordFilter');
const refreshBtn = document.getElementById('refreshBtn');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const tableBody = document.querySelector('#issuesTable tbody');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');

// 统计卡片快捷筛选：点击"待处理"/"逾期"时设置对应筛选条件
let overdueOnly = false;
let quickStatus = '';

async function init() {
  bindEvents();
  await Promise.all([loadProjects(), loadStats()]);
  await loadData();
}

async function loadProjects() {
  try {
    const resp = await fetch(`${API_BASE}/api/projects?pageSize=100`);
    const result = await resp.json();
    if (!result.success) return;
    for (const p of result.data || []) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.project_name || `项目${p.id}`;
      projectFilter.appendChild(opt);
    }
  } catch (err) {
    console.error('加载项目列表失败:', err);
  }
}

async function loadStats() {
  try {
    const resp = await fetch(`${API_BASE}/api/issues/stats`);
    const result = await resp.json();
    if (!result.success) return;
    document.querySelector('#statTotal .stat-num').textContent = result.data.total;
    document.querySelector('#statOpen .stat-num').textContent = result.data.open;
    document.querySelector('#statOverdue .stat-num').textContent = result.data.overdue;
    document.querySelector('#statClosed .stat-num').textContent = result.data.closed;
  } catch (err) {
    console.error('加载统计失败:', err);
  }
}

async function loadData() {
  showLoading(true);
  hideError();
  try {
    const params = new URLSearchParams({ page: currentPage, pageSize });
    const statusVal = quickStatus || statusFilter.value;
    if (statusVal) params.append('status', statusVal);
    if (severityFilter.value) params.append('severity', severityFilter.value);
    if (projectFilter.value) params.append('project_id', projectFilter.value);
    if (assigneeFilter.value.trim()) params.append('assignee', assigneeFilter.value.trim());
    if (keywordFilter.value.trim()) params.append('keyword', keywordFilter.value.trim());
    if (overdueOnly) params.append('overdue', '1');

    const resp = await fetch(`${API_BASE}/api/issues?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载失败');

    total = result.total || 0;
    renderTable(result.data || []);
    updatePagination();
  } catch (err) {
    showError('加载失败：' + err.message);
    tableBody.innerHTML = '';
  } finally {
    showLoading(false);
  }
}

function renderTable(rows) {
  if (rows.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="8" class="empty">暂无数据</td></tr>';
    return;
  }
  tableBody.innerHTML = rows.map(row => {
    const overdue = row.is_overdue
      ? `<span class="overdue-text">逾期 ${row.overdue_days} 天</span>`
      : '';
    return `<tr${row.is_overdue ? ' class="issue-overdue-row"' : ''}>
      <td><a href="issue_detail.html?id=${row.id}">${escapeHtml(row.issue_no)}</a></td>
      <td title="${escapeHtml(row.title)}">${escapeHtml(truncate(row.title, 30))}</td>
      <td>${escapeHtml(row.project_name || '')}</td>
      <td><span class="badge badge-severity-${severityClass(row.severity)}">${escapeHtml(row.severity)}</span></td>
      <td>${escapeHtml(row.assignee || '')}</td>
      <td><span class="badge badge-issue-${issueStatusClass(row.status)}">${escapeHtml(row.status)}</span></td>
      <td>${formatDate(row.due_date)}</td>
      <td>${overdue}</td>
    </tr>`;
  }).join('');
}

function severityClass(s) {
  return { '一般': 'normal', '重要': 'important', '紧急': 'urgent' }[s] || 'normal';
}

function issueStatusClass(s) {
  return { '新建': 'new', '处理中': 'doing', '待确认': 'confirm', '已解决': 'resolved', '已关闭': 'closed' }[s] || 'new';
}

function updatePagination() {
  const totalPages = Math.ceil(total / pageSize) || 1;
  pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页，共 ${total} 条`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function bindEvents() {
  const reload = () => { currentPage = 1; loadData(); };
  refreshBtn.addEventListener('click', reload);
  statusFilter.addEventListener('change', () => { quickStatus = ''; overdueOnly = false; reload(); });
  severityFilter.addEventListener('change', reload);
  projectFilter.addEventListener('change', reload);
  keywordFilter.addEventListener('input', reload);
  assigneeFilter.addEventListener('input', reload);

  document.getElementById('statOpen').addEventListener('click', () => {
    quickStatus = '新建,处理中,待确认';
    overdueOnly = false;
    statusFilter.value = '';
    currentPage = 1;
    // 快捷筛选直接走后端多值，不改下拉显示
    loadData();
  });
  document.getElementById('statOverdue').addEventListener('click', () => {
    quickStatus = '';
    overdueOnly = true;
    statusFilter.value = '';
    reload();
  });
  document.getElementById('statTotal').addEventListener('click', () => {
    quickStatus = '';
    overdueOnly = false;
    statusFilter.value = '';
    severityFilter.value = '';
    projectFilter.value = '';
    assigneeFilter.value = '';
    keywordFilter.value = '';
    reload();
  });
  document.getElementById('statClosed').addEventListener('click', () => {
    quickStatus = '已解决,已关闭';
    overdueOnly = false;
    statusFilter.value = '';
    currentPage = 1;
    loadData();
  });

  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadData(); }
  });
  nextBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(total / pageSize) || 1;
    if (currentPage < totalPages) { currentPage++; loadData(); }
  });
}

function showLoading(show) { loadingEl.style.display = show ? 'block' : 'none'; }
function showError(msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
function hideError() { errorEl.style.display = 'none'; }

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
}

init();
