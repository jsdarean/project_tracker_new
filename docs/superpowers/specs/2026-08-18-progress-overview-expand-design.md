# 首页“最近更新”溢出展开设计

## 背景

首页“进展概览”卡片的“最近更新”列目前最多固定展示 10 个项目。用户希望当实际有最新进展的项目超过 10 个时，提供一个方式让用户能够继续查看剩余项目。

## 目标

- 保持首页首屏简洁，默认仍展示 10 条最近更新。
- 当总数超过 10 时，提供“展开剩余 N 个”入口。
- 展开后再请求剩余数据，避免首屏加载过多。
- 支持收起回 10 条。

## 方案选型

采用 **方案 A-1**：
- 后端接口仍默认返回 10 条，但附带总数 `recent_total`。
- 前端初始只渲染 10 条。
- 点击“展开剩余 N 个”后，再调用接口请求更多数据（通过 `limit` 参数），并渲染全部。
- 再次点击可收起。

未采用的其他方案：
- **方案 B（独立页面）**：跳转成本高，不符合“在首页继续看”的诉求。
- **方案 C（卡片内分页）**：破坏连续浏览体验。
- **方案 A-2（一次返回全部）**：首屏数据量不可控，可能影响加载速度。

## 后端设计

### 接口：`GET /api/progress/overview`

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `limit` | integer | 否 | 返回的最近更新条数上限，默认 10。展开时传一个足够大的值（如 100，覆盖当前实际业务量）。 |

#### 响应

```json
{
  "success": true,
  "data": {
    "recent": [...],
    "recent_total": 25,
    "stale": [...]
  }
}
```

- `recent`：按 `report_date DESC, id DESC` 排序后的最近更新列表，最多 `limit` 条。
- `recent_total`：有最新进展的项目总数（去重后），用于计算“剩余 N 个”。
- `stale`：保持不变。

#### SQL 调整

1. `recent_total` 通过独立计数查询获取：

```sql
SELECT COUNT(*) AS total
FROM (
  SELECT DISTINCT project_id
  FROM project_progress
) t
```

2. `recent` 查询保留现有逻辑，仅根据 `limit` 参数调整 `LIMIT` 值。

## 前端设计

### 状态

- `recentTotal`：最近更新项目总数。
- `recentExpanded`：当前是否展开全部，默认 `false`。
- `recentAllItems`：展开后缓存的全部数据，默认 `null`。

### 渲染逻辑

`renderOverviewRecent(items, total)`：
- 如果 `total <= 10`，正常渲染，不显示展开按钮。
- 如果 `total > 10` 且未展开：
  - 渲染前 10 条。
  - 底部显示 `展开剩余 ${total - 10} 个`。
- 如果已展开：
  - 渲染 `recentAllItems` 全部数据。
  - 底部显示 `收起`。

### 交互

- 点击“展开剩余 N 个”：
  - 如果 `recentAllItems` 已缓存，直接切换 `recentExpanded`。
  - 如果未缓存，调用 `loadOverview({ limit: 100 })`，保存结果到 `recentAllItems`，再切换状态。
- 点击“收起”：切换 `recentExpanded` 为 `false`。

### 样式

新增 `.overview-expand-toggle` 类：
- 居中显示在“最近更新”列底部。
- 使用 `var(--ink-mute)` 文字色，`--primary` hover 色。
- 字体大小 12px，带小手光标。

## 错误处理

- 展开请求失败时，按钮文案变为“加载失败，点击重试”。
- 重试时重新发起请求。
- 保留原有数据不变，避免展开失败导致列表清空。

## 测试

### 后端

- 在 `test/api-progress-overview.test.js` 中补充：
  - 验证 `recent_total` 返回正确。
  - 验证 `limit` 参数生效。
  - 验证 `recent` 仍按默认最多 10 条返回。

### 前端

- 手工验证：
  - 总数 ≤ 10 时不显示展开按钮。
  - 总数 > 10 时显示“展开剩余 N 个”。
  - 点击展开后显示全部并变为“收起”。
  - 点击收起后恢复 10 条。
  - 展开请求失败显示重试文案，重试成功后可正常展开。

## 实现范围

- 后端：`backend/server.js`
- 前端：`backend/public/app.js`、`backend/public/style.css`
- 测试：`backend/test/api-progress-overview.test.js`
