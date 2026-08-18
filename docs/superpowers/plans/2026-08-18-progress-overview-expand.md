# 首页“最近更新”溢出展开实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首页“进展概览”卡片中，当最近更新项目超过 10 个时，提供“展开剩余 N 个”入口，按需加载并展示剩余项目，同时支持收起。

**Architecture:** 后端 `/api/progress/overview` 增加 `recent_total` 和可选 `limit` 参数；前端维护展开状态与缓存，初始渲染 10 条，展开时再请求全部（上限 100），用事件委托处理展开/收起/重试。

**Tech Stack:** Node.js + Express + MySQL（后端），原生 HTML/JS/CSS（前端），Node 内置 test runner（测试）。

## Global Constraints

- 默认最近更新仍最多展示 10 条。
- 展开时再请求后端，避免首屏数据过大。
- `limit` 参数上限 200，防止异常大值。
- 样式沿用现有 CSS 变量（`--primary`、`--ink-mute`、`--space-xs` 等）。
- 每次任务完成后需运行 `npm test`，唯一允许失败的仍是 `api-escalation.test.js` 的 SMTP 问题。

---

## File Structure

- **Create:** 无新文件。
- **Modify:**
  - `backend/server.js:730-766` — `/api/progress/overview` 接口增加 `recent_total` 与 `limit` 参数。
  - `backend/public/app.js` — 增加展开状态、缓存、渲染按钮与事件处理。
  - `backend/public/style.css:1159-1192` 附近 — 增加展开/收起按钮样式。
  - `backend/test/api-progress-overview.test.js` — 补充 `recent_total` 与 `limit` 参数测试。

---

## Task 1: 后端接口支持 `recent_total` 与 `limit`

**Files:**
- Modify: `backend/server.js:730-766`
- Test: `backend/test/api-progress-overview.test.js`

**Interfaces:**
- Consumes: HTTP query `limit` (integer, optional, default 10).
- Produces: Response `data.recent_total` (integer) and `data.recent` limited by `limit`.

- [ ] **Step 1: 修改后端接口返回 `recent_total` 并支持 `limit`**

  在 `backend/server.js` 中找到 `/api/progress/overview` 处理函数，替换为：

  ```js
  app.get('/api/progress/overview', async (req, res) => {
    try {
      const requestedLimit = parseInt(req.query.limit, 10);
      const limit = Number.isNaN(requestedLimit) ? 10 : Math.min(requestedLimit, 200);

      const recentTotalRow = await query(
        `SELECT COUNT(DISTINCT pp.project_id) AS total
         FROM project_progress pp
         JOIN projects p ON p.id = pp.project_id`
      );
      const recentTotal = recentTotalRow[0].total;

      const recent = await query(
        `SELECT pp.id, pp.project_id, p.project_name, pp.report_date, pp.completed_content, pp.tags, pp.reporter,
                w.watch_type
         FROM project_progress pp
         JOIN projects p ON p.id = pp.project_id
         LEFT JOIN watch_projects w ON w.project_id = pp.project_id
         WHERE pp.id = (
           SELECT p2.id FROM project_progress p2
           WHERE p2.project_id = pp.project_id
           ORDER BY p2.report_date DESC, p2.id DESC
           LIMIT 1
         )
         ORDER BY pp.report_date DESC, pp.id DESC
         LIMIT ?`,
        [limit]
      );

      const stale = await query(
        `SELECT p.id AS project_id, p.project_name,
                (SELECT MAX(report_date) FROM project_progress pp WHERE pp.project_id = p.id) AS last_progress_date,
                DATEDIFF(CURDATE(), (SELECT MAX(report_date) FROM project_progress pp WHERE pp.project_id = p.id)) AS days_stale
         FROM projects p
         WHERE (p.project_status IS NULL OR p.project_status != '已结项')
           AND (
             NOT EXISTS (SELECT 1 FROM project_progress pp WHERE pp.project_id = p.id)
             OR DATEDIFF(CURDATE(), (SELECT MAX(report_date) FROM project_progress pp WHERE pp.project_id = p.id)) > ?
           )
         ORDER BY last_progress_date ASC, p.id ASC`,
        [STALE_DAYS]
      );

      res.json({ success: true, data: { recent, recent_total: recentTotal, stale } });
    } catch (err) {
      console.error('查询进展概览失败:', err);
      res.status(500).json({ error: '查询进展概览失败', message: err.message });
    }
  });
  ```

- [ ] **Step 2: 编写后端测试**

  在 `backend/test/api-progress-overview.test.js` 的 `test.after` 之前插入：

  ```js
  test('GET /api/progress/overview 返回 recent_total 且 limit 参数生效', async () => {
    const resp = await fetch(`${baseUrl}/api/progress/overview`);
    const body = await resp.json();
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(body.success, true);
    assert.ok(Number.isInteger(body.data.recent_total));
    assert.ok(body.data.recent_total >= 3, 'recent_total 应包含所有有进展的项目');
    assert.ok(body.data.recent.length <= 10, '默认 limit 最多 10 条');

    const limited = await fetch(`${baseUrl}/api/progress/overview?limit=1`);
    const limitedBody = await limited.json();
    assert.strictEqual(limited.status, 200);
    assert.strictEqual(limitedBody.success, true);
    assert.strictEqual(limitedBody.data.recent.length, 1, 'limit=1 应只返回 1 条');
    assert.strictEqual(limitedBody.data.recent_total, body.data.recent_total, 'recent_total 不受 limit 影响');
  });
  ```

- [ ] **Step 3: 运行测试验证后端**

  Run: `cd backend && npm test`
  Expected: 112 pass, 1 fail（`api-escalation.test.js` SMTP 问题）。

- [ ] **Step 4: Commit**

  ```bash
  git add backend/server.js backend/test/api-progress-overview.test.js
  git commit -m "feat: /api/progress/overview 返回 recent_total 并支持 limit 参数"
  ```

---

## Task 2: 前端状态与展开逻辑

**Files:**
- Modify: `backend/public/app.js`

**Interfaces:**
- Consumes: `data.recent_total` from `/api/progress/overview`.
- Produces: `expandRecent()`, `collapseRecent()`, updated `renderOverviewRecent(items, total)`.

- [ ] **Step 1: 新增前端状态变量**

  在 `backend/public/app.js` 顶部（`let staleExpanded = false;` 附近）添加：

  ```js
  let recentTotal = 0;
  let recentExpanded = false;
  let recentAllItems = null;
  let recentExpandError = false;
  ```

- [ ] **Step 2: 修改 `loadOverview` 重置状态并读取总数**

  替换 `loadOverview` 函数为：

  ```js
  async function loadOverview() {
    try {
      const resp = await fetch(`${API_BASE}/api/progress/overview`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || '加载失败');
      recentTotal = result.data.recent_total || 0;
      recentExpanded = false;
      recentAllItems = null;
      recentExpandError = false;
      renderOverviewRecent(result.data.recent || [], recentTotal);
      renderOverviewStale(result.data.stale || []);
    } catch (err) {
      overviewRecent.innerHTML = '<div class="overview-empty">进展概览加载失败</div>';
      overviewStale.innerHTML = '';
    }
  }
  ```

- [ ] **Step 3: 新增展开/收起/重试函数**

  在 `loadOverview` 之后添加：

  ```js
  async function expandRecent() {
    if (recentAllItems) {
      recentExpanded = true;
      recentExpandError = false;
      renderOverviewRecent(recentAllItems, recentTotal);
      return;
    }
    const toggle = overviewRecent.querySelector('.overview-expand-toggle');
    if (toggle) toggle.textContent = '加载中…';
    try {
      const resp = await fetch(`${API_BASE}/api/progress/overview?limit=100`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || '加载失败');
      recentAllItems = result.data.recent || [];
      recentExpanded = true;
      recentExpandError = false;
      renderOverviewRecent(recentAllItems, recentTotal);
    } catch (err) {
      console.error('展开最近更新失败:', err);
      recentExpandError = true;
      const toggle = overviewRecent.querySelector('.overview-expand-toggle');
      if (toggle) toggle.textContent = '加载失败，点击重试';
    }
  }

  function collapseRecent() {
    recentExpanded = false;
    recentExpandError = false;
    if (recentAllItems) {
      renderOverviewRecent(recentAllItems.slice(0, 10), recentTotal);
    }
  }
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add backend/public/app.js
  git commit -m "feat: 前端新增最近更新展开状态与请求逻辑"
  ```

---

## Task 3: 前端渲染展开/收起按钮并绑定事件

**Files:**
- Modify: `backend/public/app.js`
- Modify: `backend/public/style.css`

**Interfaces:**
- Consumes: `recentTotal`, `recentExpanded`, `recentExpandError`, `expandRecent()`, `collapseRecent()`.
- Produces: HTML toggle button with `data-action` attribute and delegated click handler.

- [ ] **Step 1: 修改 `renderOverviewRecent` 渲染按钮**

  替换 `renderOverviewRecent` 函数为：

  ```js
  function renderOverviewRecent(items, total) {
    if (items.length === 0) {
      overviewRecent.innerHTML = '<div class="overview-empty">暂无进展记录</div>';
      return;
    }
    const toggleHtml = (() => {
      if (recentExpandError && !recentExpanded) {
        return '<div class="overview-expand-toggle" data-action="retry">加载失败，点击重试</div>';
      }
      if (recentExpanded) {
        return '<div class="overview-expand-toggle" data-action="collapse">收起</div>';
      }
      if (total > items.length) {
        return `<div class="overview-expand-toggle" data-action="expand">展开剩余 ${total - items.length} 个</div>`;
      }
      return '';
    })();

    overviewRecent.innerHTML = items.map(item => {
      const tags = (item.tags || '').split(',').map(s => s.trim()).filter(Boolean);
      const tagsHtml = tags.map(t => `<span class="badge badge-tag-${progressTagClass(t)}">${escapeHtml(t)}</span>`).join(' ');
      const watchBadgesHtml = renderWatchTypeBadges(item.watch_type);
      return `<div class="overview-item">
        <a href="detail.html?id=${item.project_id}">${escapeHtml(truncate(item.project_name, 40))}</a> ${watchBadgesHtml}
        <span class="overview-meta">${formatDate(item.report_date)}</span>
        <div class="overview-summary">${escapeHtml(truncate(item.completed_content, 40))} ${tagsHtml}</div>
      </div>`;
    }).join('') + toggleHtml;
  }
  ```

- [ ] **Step 2: 在 `init` 中绑定事件委托**

  在 `init` 函数末尾（`loadOverview();` 之后）添加：

  ```js
  overviewRecent.addEventListener('click', (e) => {
    const toggle = e.target.closest('.overview-expand-toggle');
    if (!toggle) return;
    const action = toggle.dataset.action;
    if (action === 'expand' || action === 'retry') {
      expandRecent();
    } else if (action === 'collapse') {
      collapseRecent();
    }
  });
  ```

- [ ] **Step 3: 添加按钮样式**

  在 `backend/public/style.css` 的“进展概览卡片”区域（约 1192 行后）添加：

  ```css
  .overview-expand-toggle {
    text-align: center;
    color: var(--ink-mute);
    font-size: 12px;
    cursor: pointer;
    padding: var(--space-xs) 0;
    margin-top: var(--space-xs);
    user-select: none;
  }
  .overview-expand-toggle:hover { color: var(--primary); }
  ```

- [ ] **Step 4: 运行测试**

  Run: `cd backend && npm test`
  Expected: 112 pass, 1 fail（`api-escalation.test.js` SMTP 问题）。

- [ ] **Step 5: Commit**

  ```bash
  git add backend/public/app.js backend/public/style.css
  git commit -m "feat: 首页最近更新支持展开剩余项目"
  ```

---

## Task 4: 推送到远程

**Files:**
- None

- [ ] **Step 1: Push**

  ```bash
  git push new main
  ```

---

## Self-Review

### Spec Coverage

| 需求 | 对应任务 |
|------|----------|
| 默认展示 10 条 | Task 1 默认 limit=10，Task 3 初始渲染 10 条 |
| 超过 10 条显示“展开剩余 N 个” | Task 3 `renderOverviewRecent` toggleHtml |
| 展开时再请求后端 | Task 2 `expandRecent` 调用 `?limit=100` |
| 支持收起 | Task 2 `collapseRecent` + Task 3 按钮 |
| 错误重试 | Task 2/3 `recentExpandError` 与 retry action |
| 后端返回 `recent_total` | Task 1 新增计数查询 |
| 测试覆盖 | Task 1 补充测试 |

### Placeholder Scan

- 无 TBD/TODO。
- 所有代码片段包含具体实现。
- 无模糊描述。

### Type Consistency

- `recentTotal` 为整数，来自 `recentTotalRow[0].total`。
- `recentAllItems` 为数组或 `null`。
- `limit` 参数在后端解析为整数并限制上限 200。
- 展开/收起/重试统一通过 `data-action` 属性分发。
