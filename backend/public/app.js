const API_BASE = window.location.origin;

let currentPage = 1;
const pageSize = 10;
let total = 0;
let currentRows = [];
const selectedIds = new Set();
let exportFields = [];

// 当前排序（字段白名单与后端一致）
let currentSort = '';
let currentOrder = 'asc';
const SORTABLE_COLUMNS = new Set(['project_status', 'health_status', 'planned_start_date', 'planned_end_date', 'last_progress_date']);

// 列表默认展示的字段（顺序），_select / _action / _edit 为非数据库字段
const displayColumns = [
  '_edit',
  '_select',
  'doc_number',
  'category',
  'project_code',
  'project_name',
  'approval_date',
  'project_status',
  'health_status',
  'last_progress_date',
  'approval_amount',
  'project_set',
  'project_subset',
  'planning_manager',
  'project_manager',
  'investment_dept',
  'investment_person',
  'engineering_dept',
  'engineering_person',
  'software_dept',
  'software_person',
  'maintenance_dept',
  'maintenance_person',
  'procurement_dept',
  'procurement_person',
  'build_level',
  'listed',
  'is_rnd',
  'region',
  'decision_method'
];

// 字段 -> 中文注释
let columnComments = {};

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const tableHeadRow = document.getElementById('headerRow');
const tableBody = document.querySelector('#projectsTable tbody');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const buildLevelFilter = document.getElementById('buildLevelFilter');
const isRndFilter = document.getElementById('isRndFilter');
const projectStatusFilter = document.getElementById('projectStatusFilter');
const healthFilter = document.getElementById('healthFilter');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const overviewToggle = document.getElementById('overviewToggle');
const overviewRecent = document.getElementById('overviewRecent');
const overviewStale = document.getElementById('overviewStale');
const staleToggle = document.getElementById('staleToggle');
const staleSummary = document.getElementById('staleSummary');
let staleExpanded = false;
let selectAllCheckbox = null;

async function init() {
  await loadColumns();
  await loadExportSettings();
  refreshHeader();
  await loadData();
  applyStaleVisibility();
  loadOverview();
}

async function loadExportSettings() {
  try {
    const resp = await fetch(`${API_BASE}/api/settings`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (result.success && Array.isArray(result.data.export_fields)) {
      exportFields = result.data.export_fields;
    }
  } catch (err) {
    console.error('加载导出字段设置失败:', err);
    exportFields = [];
  }
}

async function loadColumns() {
  try {
    const resp = await fetch(`${API_BASE}/api/projects/columns`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载字段注释失败');
    columnComments = {};
    for (const col of result.data) {
      columnComments[col.field] = col.comment || col.field;
    }
    columnComments['last_progress_date'] = '最新进展日期';
  } catch (err) {
    console.error('加载字段注释失败:', err);
    // 失败时使用字段名兜底
    for (const f of displayColumns) {
      if (!columnComments[f]) columnComments[f] = f;
    }
  }
}

function renderHeader() {
  tableHeadRow.innerHTML = displayColumns.map(field => {
    if (field === '_edit') return '<th>变更</th>';
    if (field === '_select') return '<th><input type="checkbox" id="selectAll" title="全选本页"></th>';
    if (field === '_action') return '<th>操作</th>';
    const label = escapeHtml(columnComments[field] || field);
    if (SORTABLE_COLUMNS.has(field)) {
      const arrow = currentSort === field ? (currentOrder === 'asc' ? ' ↑' : ' ↓') : '';
      return `<th class="sortable" data-sort="${field}">${label}${arrow}</th>`;
    }
    return `<th>${label}</th>`;
  }).join('');
}

// 表头重绘后重新绑定全选与排序事件
function refreshHeader() {
  renderHeader();
  selectAllCheckbox = document.getElementById('selectAll');
  bindSelectAll();
  bindSort();
}

function bindSort() {
  tableHeadRow.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.getAttribute('data-sort');
      if (currentSort === field) {
        currentOrder = currentOrder === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = field;
        currentOrder = 'asc';
      }
      currentPage = 1;
      refreshHeader();
      loadData();
    });
  });
}

function bindSelectAll() {
  selectAllCheckbox = document.getElementById('selectAll');
  if (!selectAllCheckbox) return;
  selectAllCheckbox.addEventListener('change', () => {
    const checked = selectAllCheckbox.checked;
    for (const row of currentRows) {
      const id = String(row.id);
      if (checked) selectedIds.add(id);
      else selectedIds.delete(id);
    }
    renderTable(currentRows);
  });
}

async function loadData() {
  showLoading(true);
  hideError();
  try {
    const keyword = searchInput.value.trim();
    const status = statusFilter.value;
    const buildLevel = buildLevelFilter.value;
    const isRnd = isRndFilter.value;
    const params = new URLSearchParams({ page: currentPage, pageSize });
    if (keyword) params.append('keyword', keyword);
    if (status) params.append('status', status);
    if (buildLevel) params.append('build_level', buildLevel);
    if (isRnd) params.append('is_rnd', isRnd);
    const projectStatus = projectStatusFilter.value;
    const health = healthFilter.value;
    if (projectStatus) params.append('project_status', projectStatus);
    if (health) params.append('health_status', health);
    if (currentSort) {
      params.append('sort', currentSort);
      params.append('order', currentOrder);
    }

    const resp = await fetch(`${API_BASE}/api/projects?${params.toString()}`);
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
  currentRows = rows;
  tableBody.innerHTML = '';
  if (rows.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="${displayColumns.length}" class="empty">暂无数据</td></tr>`;
    updateSelectAllState();
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = displayColumns.map(field => renderCell(field, row)).join('');
    tableBody.appendChild(tr);
  }

  updateSelectAllState();

  // 绑定删除事件（排除行首变更按钮）
  tableBody.querySelectorAll('.btn-small:not(.row-edit)').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!confirm(`确定删除记录 ${id} 吗？`)) return;
      try {
        const resp = await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await loadData();
      } catch (err) {
        alert('删除失败：' + err.message);
      }
    });
  });
}

function renderCell(field, row) {
  switch (field) {
    case '_edit':
      return `<td><button class="btn-small row-edit" data-id="${row.id}">变更</button></td>`;
    case '_select':
      return `<td><input type="checkbox" class="row-select" data-id="${row.id}" ${selectedIds.has(String(row.id)) ? 'checked' : ''}></td>`;
    case 'doc_number':
      return `<td>${escapeHtml(row.doc_number || '')}</td>`;
    case 'category':
      return `<td>${escapeHtml(row.category || '')}</td>`;
    case 'project_code':
      return `<td><a href="#" class="open-folder" data-code="${escapeHtml(row.project_code || '')}" data-name="${escapeHtml(row.project_name || '')}">${escapeHtml(row.project_code || '')}</a></td>`;
    case 'project_name':
      return `<td title="${escapeHtml(row.project_name || '')}"><a href="detail.html?id=${row.id}">${escapeHtml(truncate(row.project_name, 40))}</a></td>`;
    case 'approval_date':
      return `<td>${formatDate(row.approval_date)}</td>`;
    case 'project_status':
      return `<td>${row.project_status ? `<span class="badge badge-status-${statusClass(row.project_status)}">${escapeHtml(row.project_status)}</span>` : ''}</td>`;
    case 'health_status':
      return `<td>${row.health_status ? `<span class="badge badge-health-${healthClass(row.health_status)}">${escapeHtml(row.health_status)}</span>` : ''}</td>`;
    case 'last_progress_date': {
      if (!row.last_progress_date) return '<td>—</td>';
      const days = Math.floor((Date.now() - new Date(row.last_progress_date).getTime()) / 86400000);
      return `<td${days > 14 ? ' class="stale-date"' : ''}>${formatDate(row.last_progress_date)}</td>`;
    }
    case 'approval_amount':
      return `<td class="amount">${formatNumber(row.approval_amount)}</td>`;
    case 'project_set':
      return `<td>${escapeHtml(row.project_set || '')}</td>`;
    case 'project_subset':
      return `<td>${escapeHtml(row.project_subset || '')}</td>`;
    case 'planning_manager':
      return `<td>${escapeHtml(row.planning_manager || '')}</td>`;
    case 'project_manager':
      return `<td>${escapeHtml(row.project_manager || '')}</td>`;
    case 'investment_dept':
      return `<td>${escapeHtml(row.investment_dept || '')}</td>`;
    case 'investment_person':
      return `<td>${escapeHtml(row.investment_person || '')}</td>`;
    case 'engineering_dept':
      return `<td>${escapeHtml(row.engineering_dept || '')}</td>`;
    case 'engineering_person':
      return `<td>${escapeHtml(row.engineering_person || '')}</td>`;
    case 'software_dept':
      return `<td>${escapeHtml(row.software_dept || '')}</td>`;
    case 'software_person':
      return `<td>${escapeHtml(row.software_person || '')}</td>`;
    case 'maintenance_dept':
      return `<td>${escapeHtml(row.maintenance_dept || '')}</td>`;
    case 'maintenance_person':
      return `<td>${escapeHtml(row.maintenance_person || '')}</td>`;
    case 'procurement_dept':
      return `<td>${escapeHtml(row.procurement_dept || '')}</td>`;
    case 'procurement_person':
      return `<td>${escapeHtml(row.procurement_person || '')}</td>`;
    case 'build_level':
      return `<td>${escapeHtml(row.build_level || '')}</td>`;
    case 'listed':
      return `<td>${escapeHtml(row.listed || '')}</td>`;
    case 'is_rnd':
      return `<td>${escapeHtml(row.is_rnd || '')}</td>`;
    case 'region':
      return `<td>${escapeHtml(row.region || '')}</td>`;
    case 'decision_method':
      return `<td title="${escapeHtml(row.decision_method || '')}">${escapeHtml(truncate(row.decision_method, 20))}</td>`;
    case 'status':
      return `<td><span class="badge badge-${row.status}">${row.status === 'saved' ? '已提交' : '草稿'}</span></td>`;
    case '_action':
      return `<td><button class="btn-small" data-id="${row.id}">删除</button></td>`;
    default:
      return `<td>${escapeHtml(row[field] ?? '')}</td>`;
  }
}

function updateSelectAllState() {
  if (!selectAllCheckbox) return;
  const ids = currentRows.map(r => String(r.id));
  if (ids.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }
  const checkedCount = ids.filter(id => selectedIds.has(id)).length;
  selectAllCheckbox.checked = checkedCount === ids.length;
  selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < ids.length;
}

// Excel 导出库本地懒加载，避免页面加载时访问外部 CDN 拖慢页面
let xlsxLoadingPromise = null;
function loadXlsx() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  if (xlsxLoadingPromise) return xlsxLoadingPromise;
  xlsxLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/xlsx.full.min.js';
    script.onload = () => resolve();
    script.onerror = () => {
      xlsxLoadingPromise = null;
      reject(new Error('Excel 导出库加载失败'));
    };
    document.head.appendChild(script);
  });
  return xlsxLoadingPromise;
}

async function exportToExcel() {
  try {
    await loadXlsx();
  } catch (err) {
    alert('Excel 导出库加载失败，请检查后端服务后重试。');
    return;
  }

  const checkedRows = currentRows.filter(r => selectedIds.has(String(r.id)));
  const rowsToExport = checkedRows.length > 0 ? checkedRows : currentRows;

  if (rowsToExport.length === 0) {
    alert('当前没有可导出的数据。');
    return;
  }

  const fieldsToExport = exportFields.length > 0
    ? exportFields
    : displayColumns.filter(f => f !== '_select' && f !== '_action' && f !== 'status');
  const headers = fieldsToExport.map(f => columnComments[f] || f);
  const aoa = [headers];

  for (const row of rowsToExport) {
    aoa.push(fieldsToExport.map(f => {
      const val = row[f];
      // 日期字段统一格式化为 YYYY-MM-DD
      if (f.endsWith('_date') && val) {
        return formatDate(val);
      }
      return val ?? '';
    }));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '项目信息');

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `项目信息_${dateStr}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function updatePagination() {
  const totalPages = Math.ceil(total / pageSize) || 1;
  pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页，共 ${total} 条`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

async function loadOverview() {
  try {
    const resp = await fetch(`${API_BASE}/api/progress/overview`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载失败');
    renderOverviewRecent(result.data.recent || []);
    renderOverviewStale(result.data.stale || []);
  } catch (err) {
    overviewRecent.innerHTML = '<div class="overview-empty">进展概览加载失败</div>';
    overviewStale.innerHTML = '';
  }
}

function progressTagClass(tag) {
  return { '里程碑达成': 'milestone', '风险上升': 'risk', '需领导决策': 'decision' }[tag] || 'milestone';
}

function renderOverviewRecent(items) {
  if (items.length === 0) {
    overviewRecent.innerHTML = '<div class="overview-empty">暂无进展记录</div>';
    return;
  }
  overviewRecent.innerHTML = items.map(item => {
    const tags = (item.tags || '').split(',').map(s => s.trim()).filter(Boolean);
    const tagsHtml = tags.map(t => `<span class="badge badge-tag-${progressTagClass(t)}">${escapeHtml(t)}</span>`).join(' ');
    return `<div class="overview-item">
      <a href="detail.html?id=${item.project_id}">${escapeHtml(truncate(item.project_name, 20))}</a>
      <span class="overview-meta">${formatDate(item.report_date)}</span>
      <div class="overview-summary">${escapeHtml(truncate(item.completed_content, 40))} ${tagsHtml}</div>
    </div>`;
  }).join('');
}

function renderOverviewStale(items) {
  staleSummary.textContent = items.length === 0 ? '没有滞后的项目' : `共 ${items.length} 个项目滞后/未填报`;
  if (items.length === 0) {
    overviewStale.innerHTML = '<div class="overview-empty">没有滞后的项目</div>';
  } else {
    overviewStale.innerHTML = items.map(item => {
      const label = item.last_progress_date
        ? `<span class="stale-text">${item.days_stale} 天未更新</span>`
        : '<span class="never-text">从未填报</span>';
      return `<div class="overview-item"><a href="detail.html?id=${item.project_id}">${escapeHtml(truncate(item.project_name, 24))}</a> ${label}</div>`;
    }).join('');
  }
  applyStaleVisibility();
}

function applyStaleVisibility() {
  staleSummary.style.display = staleExpanded ? 'none' : '';
  overviewStale.style.display = staleExpanded ? '' : 'none';
  staleToggle.textContent = staleExpanded ? '收起' : '展开';
}

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function hideError() {
  errorEl.style.display = 'none';
}

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

function statusClass(status) {
  return { '未启动': 'idle', '进行中': 'active', '已暂停': 'paused', '已结项': 'done' }[status] || 'idle';
}

function healthClass(health) {
  return { '正常': 'ok', '关注': 'warn', '风险': 'danger' }[health] || 'ok';
}

function formatNumber(num) {
  if (num === null || num === undefined || num === '') return '';
  return Number(num).toLocaleString('zh-CN');
}

// 事件绑定
refreshBtn.addEventListener('click', () => {
  currentPage = 1;
  loadData();
});

overviewToggle.addEventListener('click', () => {
  const body = document.getElementById('overviewBody');
  const arrow = document.getElementById('overviewArrow');
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  arrow.textContent = hidden ? '▼' : '▶';
});

staleToggle.addEventListener('click', () => {
  staleExpanded = !staleExpanded;
  applyStaleVisibility();
});

tableBody.addEventListener('click', async (e) => {
  const link = e.target.closest('.open-folder');
  if (!link) return;
  e.preventDefault();
  const code = link.dataset.code;
  const name = link.dataset.name;
  try {
    const resp = await fetch(`${API_BASE}/api/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_code: code, project_name: name })
    });
    if (!resp.ok) {
      const result = await resp.json().catch(() => ({}));
      alert('打开文件夹失败：' + (result.error || resp.statusText));
    }
  } catch (err) {
    alert('打开文件夹失败：' + err.message);
  }
});

exportBtn.addEventListener('click', exportToExcel);

tableBody.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.row-edit');
  if (editBtn) {
    const id = editBtn.getAttribute('data-id');
    window.location.href = `edit.html?id=${id}`;
  }
});

tableBody.addEventListener('change', (e) => {
  if (e.target.classList.contains('row-select')) {
    const id = e.target.getAttribute('data-id');
    if (e.target.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateSelectAllState();
  }
});

searchInput.addEventListener('input', () => {
  currentPage = 1;
  loadData();
});

statusFilter.addEventListener('change', () => {
  currentPage = 1;
  loadData();
});

buildLevelFilter.addEventListener('change', () => {
  currentPage = 1;
  loadData();
});

isRndFilter.addEventListener('change', () => {
  currentPage = 1;
  loadData();
});

projectStatusFilter.addEventListener('change', () => {
  currentPage = 1;
  loadData();
});

healthFilter.addEventListener('change', () => {
  currentPage = 1;
  loadData();
});

prevBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    loadData();
  }
});

nextBtn.addEventListener('click', () => {
  const totalPages = Math.ceil(total / pageSize) || 1;
  if (currentPage < totalPages) {
    currentPage++;
    loadData();
  }
});

// 初始加载
init();
