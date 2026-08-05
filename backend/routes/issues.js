const express = require('express');
const { query } = require('../db');

const router = express.Router();

// 问题枚举取值（VARCHAR + 应用层校验，与全项目惯例一致）
const ISSUE_SEVERITY_VALUES = ['一般', '重要', '紧急'];
const ISSUE_STATUS_VALUES = ['新建', '处理中', '待确认', '已解决', '已关闭'];
const ISSUE_CLOSED_STATUSES = ['已解决', '已关闭'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 本地时区今天（YYYY-MM-DD）
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 基础校验：isPartial=true（PUT）时未传字段跳过
function validateIssuePayload(data, isPartial) {
  if (!isPartial || data.title !== undefined) {
    if (!data.title || !String(data.title).trim()) return 'title 必填且不能为空';
  }
  if (data.severity && !ISSUE_SEVERITY_VALUES.includes(data.severity)) {
    return `severity 取值必须是：${ISSUE_SEVERITY_VALUES.join(' / ')}`;
  }
  if (data.status && !ISSUE_STATUS_VALUES.includes(data.status)) {
    return `status 取值必须是：${ISSUE_STATUS_VALUES.join(' / ')}`;
  }
  for (const f of ['found_date', 'due_date', 'resolved_at']) {
    if (data[f] && !DATE_RE.test(data[f])) {
      return `${f} 必须是 YYYY-MM-DD 格式`;
    }
  }
  return null;
}

// 终态校验：目标状态为已解决/已关闭时 solution 必填；resolved_at 未传由调用方默认填今天
function validateTerminal(data) {
  if (data.status && ISSUE_CLOSED_STATUSES.includes(data.status)) {
    if (!data.solution || !String(data.solution).trim()) {
      return '置为已解决/已关闭时 solution（解决方案）必填';
    }
  }
  return null;
}

// 生成下一个问题编号（ISS-0001 起），唯一索引冲突时由调用方重试
async function generateIssueNo() {
  const rows = await query(`SELECT issue_no FROM issues ORDER BY issue_no DESC LIMIT 1`);
  let next = 1;
  if (rows.length > 0) {
    const m = String(rows[0].issue_no).match(/^ISS-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `ISS-${String(next).padStart(4, '0')}`;
}

const ISSUE_COLUMNS = [
  'project_id', 'title', 'description', 'severity', 'assignee', 'helper',
  'status', 'found_date', 'due_date', 'resolved_at', 'solution', 'created_by',
];

// 列表查询（多值筛选 + 逾期标记 + 分页）
router.get('/api/issues', async (req, res) => {
  try {
    const { project_id, assignee, keyword, overdue } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * size;

    let where = ' WHERE 1=1';
    const params = [];
    if (req.query.status) {
      const values = req.query.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (values.length > 0) {
        where += ` AND issues.status IN (${values.map(() => '?').join(',')})`;
        params.push(...values);
      }
    }
    if (req.query.severity) {
      const values = req.query.severity.split(',').map((s) => s.trim()).filter(Boolean);
      if (values.length > 0) {
        where += ` AND issues.severity IN (${values.map(() => '?').join(',')})`;
        params.push(...values);
      }
    }
    if (project_id) {
      where += ' AND issues.project_id = ?';
      params.push(project_id);
    }
    if (assignee) {
      where += ' AND issues.assignee LIKE ?';
      params.push(`%${assignee}%`);
    }
    if (keyword) {
      where += ' AND (issues.issue_no LIKE ? OR issues.title LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (overdue === '1') {
      where += ` AND issues.due_date IS NOT NULL AND issues.due_date < CURDATE() AND issues.status NOT IN ('已解决','已关闭')`;
    }

    const rows = await query(
      `SELECT issues.*, p.project_name,
              (issues.due_date IS NOT NULL AND issues.due_date < CURDATE() AND issues.status NOT IN ('已解决','已关闭')) AS is_overdue,
              (CASE WHEN issues.due_date IS NOT NULL AND issues.due_date < CURDATE() AND issues.status NOT IN ('已解决','已关闭')
                    THEN DATEDIFF(CURDATE(), issues.due_date) ELSE NULL END) AS overdue_days
       FROM issues
       LEFT JOIN projects p ON p.id = issues.project_id
       ${where}
       ORDER BY issues.updated_at DESC
       LIMIT ${size} OFFSET ${offset}`,
      params
    );
    const [countRow] = await query(`SELECT COUNT(*) AS total FROM issues${where}`, params);

    res.json({ success: true, data: rows, total: countRow.total });
  } catch (err) {
    console.error('查询问题列表失败:', err);
    res.status(500).json({ error: '查询问题列表失败', message: err.message });
  }
});

// 统计卡片（注意：必须注册在 /api/issues/:id 之前）
router.get('/api/issues/stats', async (req, res) => {
  try {
    const rows = await query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status NOT IN ('已解决','已关闭') THEN 1 ELSE 0 END) AS \`open\`,
              SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURDATE() AND status NOT IN ('已解决','已关闭') THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN status IN ('已解决','已关闭') THEN 1 ELSE 0 END) AS closed
       FROM issues`
    );
    const r = rows[0];
    res.json({
      success: true,
      data: {
        total: Number(r.total) || 0,
        open: Number(r.open) || 0,
        overdue: Number(r.overdue) || 0,
        closed: Number(r.closed) || 0,
      },
    });
  } catch (err) {
    console.error('查询问题统计失败:', err);
    res.status(500).json({ error: '查询问题统计失败', message: err.message });
  }
});

// 问题详情（含项目名）
router.get('/api/issues/:id', async (req, res) => {
  try {
    const rows = await query(
      `SELECT issues.*, p.project_name FROM issues
       LEFT JOIN projects p ON p.id = issues.project_id
       WHERE issues.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '问题不存在' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('查询问题详情失败:', err);
    res.status(500).json({ error: '查询问题详情失败', message: err.message });
  }
});

// 创建问题（issue_no 服务端生成，唯一索引冲突重试一次）
router.post('/api/issues', async (req, res) => {
  try {
    const data = req.body;
    if (!data.project_id) return res.status(400).json({ error: '参数校验失败', message: 'project_id 必填' });
    const projectRows = await query('SELECT id FROM projects WHERE id = ?', [data.project_id]);
    if (projectRows.length === 0) return res.status(404).json({ error: '项目不存在' });

    const invalid = validateIssuePayload(data, false) || validateTerminal(data);
    if (invalid) return res.status(400).json({ error: '参数校验失败', message: invalid });

    const values = {
      project_id: data.project_id,
      title: String(data.title).trim(),
      description: data.description || null,
      severity: data.severity || '一般',
      assignee: data.assignee || null,
      helper: data.helper || null,
      status: data.status || '新建',
      found_date: data.found_date || todayLocal(),
      due_date: data.due_date || null,
      resolved_at: data.resolved_at || (ISSUE_CLOSED_STATUSES.includes(data.status) ? todayLocal() : null),
      solution: data.solution || null,
      created_by: data.created_by || null,
    };
    const fields = ['issue_no', ...ISSUE_COLUMNS];
    const buildInsert = (issueNo) =>
      query(
        `INSERT INTO issues (${fields.map((f) => `\`${f}\``).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
        [issueNo, ...ISSUE_COLUMNS.map((f) => values[f])]
      );

    let result;
    try {
      result = await buildInsert(await generateIssueNo());
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') {
        result = await buildInsert(await generateIssueNo());
      } else {
        throw err;
      }
    }
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('创建问题失败:', err);
    res.status(500).json({ error: '创建问题失败', message: err.message });
  }
});

// 更新问题（含转派 = 改 assignee；终态需 solution + resolved_at）
router.put('/api/issues/:id', async (req, res) => {
  try {
    const data = req.body;
    const invalid = validateIssuePayload(data, true) || validateTerminal(data);
    if (invalid) return res.status(400).json({ error: '参数校验失败', message: invalid });

    if (data.project_id) {
      const projectRows = await query('SELECT id FROM projects WHERE id = ?', [data.project_id]);
      if (projectRows.length === 0) return res.status(404).json({ error: '项目不存在' });
    }
    // 终态未传 resolved_at 时默认填今天
    if (data.status && ISSUE_CLOSED_STATUSES.includes(data.status) && !data.resolved_at) {
      data.resolved_at = todayLocal();
    }

    const updates = [];
    const values = [];
    for (const f of ISSUE_COLUMNS) {
      if (data[f] !== undefined) {
        updates.push(`\`${f}\` = ?`);
        values.push(data[f] === '' ? null : data[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: '没有可更新字段' });

    const existing = await query('SELECT id FROM issues WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: '问题不存在' });

    values.push(req.params.id);
    await query(`UPDATE issues SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    console.error('更新问题失败:', err);
    res.status(500).json({ error: '更新问题失败', message: err.message });
  }
});

// 删除问题（级联删除评论）
router.delete('/api/issues/:id', async (req, res) => {
  try {
    const existing = await query('SELECT id FROM issues WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: '问题不存在' });

    await query('DELETE FROM issue_comments WHERE issue_id = ?', [req.params.id]);
    await query('DELETE FROM issues WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('删除问题失败:', err);
    res.status(500).json({ error: '删除问题失败', message: err.message });
  }
});

module.exports = router;
