const API_BASE = window.location.origin;

const urlParams = new URLSearchParams(window.location.search);
const isNew = urlParams.get('new') === '1';
const issueId = urlParams.get('id');
const presetProjectId = urlParams.get('project_id');

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const issueCard = document.getElementById('issueCard');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const issueForm = document.getElementById('issueForm');
const fTitle = document.getElementById('fTitle');
const fProject = document.getElementById('fProject');
const fSeverity = document.getElementById('fSeverity');
const fStatus = document.getElementById('fStatus');
const statusGroup = document.getElementById('statusGroup');
const fAssignee = document.getElementById('fAssignee');
const fHelper = document.getElementById('fHelper');
const fFoundDate = document.getElementById('fFoundDate');
const fDueDate = document.getElementById('fDueDate');
const fDescription = document.getElementById('fDescription');
const saveBtn = document.getElementById('saveBtn');
const reopenBtn = document.getElementById('reopenBtn');
const deleteBtn = document.getElementById('deleteBtn');
const solutionHistory = document.getElementById('solutionHistory');
const solutionText = document.getElementById('solutionText');
const resolvedAtText = document.getElementById('resolvedAtText');
const resolveModal = document.getElementById('resolveModal');
const resolveTitle = document.getElementById('resolveTitle');
const resolveError = document.getElementById('resolveError');
const mSolution = document.getElementById('mSolution');
const mResolvedAt = document.getElementById('mResolvedAt');
const resolveConfirmBtn = document.getElementById('resolveConfirmBtn');
const resolveCancelBtn = document.getElementById('resolveCancelBtn');
const commentsSection = document.getElementById('commentsSection');
const commentsList = document.getElementById('commentsList');
const commentsError = document.getElementById('commentsError');
const commentAuthor = document.getElementById('commentAuthor');
const commentContent = document.getElementById('commentContent');
const commentSubmitBtn = document.getElementById('commentSubmitBtn');

const CLOSED_STATUSES = ['已解决', '已关闭'];
let currentIssue = null;

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function init() {
  try {
    await Promise.all([loadProjects(), loadContactNames()]);
    if (isNew) {
      initNewMode();
    } else if (issueId) {
      await loadIssue();
      initEditMode();
    } else {
      throw new Error('缺少参数（new=1 或 id）');
    }
    hideLoading();
    issueCard.style.display = 'block';
  } catch (err) {
    hideLoading();
    showError(err.message);
  }
}

function initNewMode() {
  pageTitle.textContent = '新建问题';
  fFoundDate.value = todayLocal();
  if (presetProjectId) fProject.value = presetProjectId;
  statusGroup.style.display = 'none';
  deleteBtn.style.display = 'none';
  reopenBtn.style.display = 'none';
}

function initEditMode() {
  pageTitle.textContent = `${currentIssue.issue_no} ${currentIssue.title}`;
  pageSubtitle.textContent = `所属项目：${currentIssue.project_name || ''}`;
  fTitle.value = currentIssue.title || '';
  fProject.value = String(currentIssue.project_id);
  fSeverity.value = currentIssue.severity || '一般';
  fStatus.value = currentIssue.status || '新建';
  fAssignee.value = currentIssue.assignee || '';
  fHelper.value = currentIssue.helper || '';
  fFoundDate.value = formatDate(currentIssue.found_date);
  fDueDate.value = formatDate(currentIssue.due_date);
  fDescription.value = currentIssue.description || '';

  const closed = CLOSED_STATUSES.includes(currentIssue.status);
  reopenBtn.style.display = closed ? '' : 'none';
  deleteBtn.style.display = '';
  solutionHistory.style.display = 'none';
  if (closed && currentIssue.solution) {
    solutionHistory.style.display = 'block';
    solutionText.textContent = currentIssue.solution;
    resolvedAtText.textContent = currentIssue.resolved_at ? `实际解决日期：${formatDate(currentIssue.resolved_at)}` : '';
  }
  commentsSection.style.display = 'block';
  commentAuthor.value = localStorage.getItem('progress_reporter') || '';
  commentSubmitBtn.onclick = submitComment;
  loadComments();
}

async function loadProjects() {
  const resp = await fetch(`${API_BASE}/api/projects?pageSize=100`);
  const result = await resp.json();
  if (!result.success) throw new Error(result.error || '加载项目列表失败');
  fProject.innerHTML = '<option value="">请选择项目</option>';
  for (const p of result.data || []) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.project_name || `项目${p.id}`;
    fProject.appendChild(opt);
  }
}

async function loadContactNames() {
  try {
    const resp = await fetch(`${API_BASE}/api/contacts?pageSize=100`);
    const result = await resp.json();
    if (!result.success) return;
    const names = [...new Set((result.data || []).map(c => c.name).filter(Boolean))];
    document.getElementById('contactNames').innerHTML =
      names.map(n => `<option value="${escapeHtml(n)}">`).join('');
  } catch (err) {
    console.error('加载联系人联想失败（不影响录入）:', err);
  }
}

async function loadIssue() {
  const resp = await fetch(`${API_BASE}/api/issues/${issueId}`);
  if (resp.status === 404) throw new Error('问题不存在或已被删除');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const result = await resp.json();
  if (!result.success) throw new Error(result.error || '加载问题失败');
  currentIssue = result.data;
}

function collectPayload() {
  const payload = {
    project_id: fProject.value,
    title: fTitle.value.trim(),
    description: fDescription.value,
    severity: fSeverity.value,
    assignee: fAssignee.value,
    helper: fHelper.value,
    found_date: fFoundDate.value,
    due_date: fDueDate.value,
  };
  if (!isNew) payload.status = fStatus.value;
  return payload;
}

// 保存：若目标状态为终态，先弹层收集解决方案，再统一提交
issueForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = collectPayload();
  if (!payload.project_id) { alert('请选择所属项目'); return; }
  if (!payload.title) { alert('请填写问题标题'); return; }

  if (!isNew && CLOSED_STATUSES.includes(payload.status) && !CLOSED_STATUSES.includes(currentIssue.status)) {
    openResolveModal(payload);
    return;
  }
  await saveIssue(payload);
});

function openResolveModal(payload) {
  resolveError.style.display = 'none';
  resolveTitle.textContent = `将问题置为「${payload.status}」`;
  mSolution.value = '';
  mResolvedAt.value = todayLocal();
  resolveModal.style.display = 'flex';
  resolveConfirmBtn.onclick = async () => {
    if (!mSolution.value.trim()) {
      resolveError.textContent = '请填写解决方案';
      resolveError.style.display = 'block';
      return;
    }
    if (!mResolvedAt.value) {
      resolveError.textContent = '请选择实际解决日期';
      resolveError.style.display = 'block';
      return;
    }
    payload.solution = mSolution.value.trim();
    payload.resolved_at = mResolvedAt.value;
    resolveModal.style.display = 'none';
    await saveIssue(payload);
  };
  resolveCancelBtn.onclick = () => { resolveModal.style.display = 'none'; };
}

async function saveIssue(payload) {
  saveBtn.disabled = true;
  try {
    const resp = await fetch(isNew ? `${API_BASE}/api/issues` : `${API_BASE}/api/issues/${issueId}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(result.message || result.error || `HTTP ${resp.status}`);
    if (isNew) {
      window.location.href = `issue_detail.html?id=${result.id}`;
    } else {
      await loadIssue();
      initEditMode();
      alert('✅ 保存成功');
    }
  } catch (err) {
    alert('保存失败：' + err.message);
  } finally {
    saveBtn.disabled = false;
  }
}

reopenBtn.addEventListener('click', async () => {
  try {
    const resp = await fetch(`${API_BASE}/api/issues/${issueId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: '处理中' }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(result.message || result.error || `HTTP ${resp.status}`);
    await loadIssue();
    initEditMode();
  } catch (err) {
    alert('重新打开失败：' + err.message);
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!confirm(`确定删除问题 ${currentIssue.issue_no} 吗？其评论将一并删除，不可恢复。`)) return;
  try {
    const resp = await fetch(`${API_BASE}/api/issues/${issueId}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    window.location.href = 'issues.html';
  } catch (err) {
    alert('删除失败：' + err.message);
  }
});

async function loadComments() {
  commentsError.style.display = 'none';
  try {
    const resp = await fetch(`${API_BASE}/api/issues/${issueId}/comments`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '加载评论失败');
    renderComments(result.data || []);
  } catch (err) {
    commentsList.innerHTML = '';
    commentsError.textContent = '评论加载失败：' + err.message;
    commentsError.style.display = 'block';
  }
}

function renderComments(items) {
  if (items.length === 0) {
    commentsList.innerHTML = '<div class="comments-empty">暂无评论</div>';
    return;
  }
  commentsList.innerHTML = items.map(c => `
    <div class="comment-item">
      <div class="comment-meta">${escapeHtml(c.author || '匿名')} · ${formatDateTime(c.created_at)}</div>
      <div class="comment-text">${escapeHtml(c.content)}</div>
    </div>`).join('');
}

async function submitComment() {
  const content = commentContent.value.trim();
  if (!content) { alert('请填写评论内容'); return; }
  commentSubmitBtn.disabled = true;
  try {
    const resp = await fetch(`${API_BASE}/api/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, author: commentAuthor.value.trim() }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(result.message || result.error || `HTTP ${resp.status}`);
    if (commentAuthor.value.trim()) localStorage.setItem('progress_reporter', commentAuthor.value.trim());
    commentContent.value = '';
    await loadComments();
  } catch (err) {
    alert('发表评论失败：' + err.message);
  } finally {
    commentSubmitBtn.disabled = false;
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function hideLoading() { loadingEl.style.display = 'none'; }
function showError(msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; }

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

init();
