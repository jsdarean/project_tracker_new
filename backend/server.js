require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const xlsx = require('xlsx');
const { exec, spawn } = require('child_process');
const { query, initDatabase, projectColumns, contactColumns, setDbConfig, getDbConfig } = require('./db');
const { extract } = require('./extractor');
const issuesRouter = require('./routes/issues');
const { loadSettings, saveSettings, EMAIL_DEFAULTS } = require('./settings-store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 联系人可维护字段
const contactFields = ['city', 'company', 'department', 'position', 'name', 'phone', 'email', 'remarks', 'related_project'];

// 项目状态与健康度合法取值（VARCHAR + 应用层校验，不用数据库 ENUM）
const PROJECT_STATUS_VALUES = ['未启动', '进行中', '已暂停', '已结项'];
const HEALTH_STATUS_VALUES = ['正常', '关注', '风险'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 进展标签合法取值与进展滞后阈值（天）
const PROGRESS_TAG_VALUES = ['里程碑达成', '风险上升', '需领导决策'];
const STALE_DAYS = 14;

// 校验跟踪字段：未传/null/空字符串跳过；非法值返回错误消息，合法返回 null
function validateTrackingFields(data) {
  if (data.project_status && !PROJECT_STATUS_VALUES.includes(data.project_status)) {
    return `project_status 取值必须是：${PROJECT_STATUS_VALUES.join(' / ')}`;
  }
  if (data.health_status && !HEALTH_STATUS_VALUES.includes(data.health_status)) {
    return `health_status 取值必须是：${HEALTH_STATUS_VALUES.join(' / ')}`;
  }
  for (const f of ['planned_start_date', 'planned_end_date']) {
    if (data[f] && !DATE_RE.test(data[f])) {
      return `${f} 必须是 YYYY-MM-DD 格式`;
    }
  }
  return null;
}

// 字段 -> 中文注释映射
const COMMENT_MAP = {};
for (const def of projectColumns) {
  const nameMatch = def.match(/^`([^`]+)`/);
  const commentMatch = def.match(/COMMENT\s+'([^']*)'/);
  if (nameMatch && commentMatch) {
    COMMENT_MAP[nameMatch[1]] = commentMatch[1];
  }
}

// 请求日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${duration}ms ${req.ip || ''}`);
  });
  next();
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 获取归档设置
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    const masked = { ...settings };
    if (masked.smtp_pass) masked.smtp_pass = '';
    if (masked.imap_pass) masked.imap_pass = '';
    res.json({ success: true, data: masked });
  } catch (err) {
    console.error('读取设置失败:', err);
    res.status(500).json({ error: '读取设置失败', message: err.message });
  }
});

// 保存归档与数据库设置
app.post('/api/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const old = await loadSettings();
    const folder = String(body.archive_folder || '').trim();
    const dldir = String(body.download_dir || '').trim();
    const dbHost = String(body.db_host || '').trim() || 'localhost';
    const dbPort = Number(body.db_port) || 3306;
    const dbUser = String(body.db_user || '').trim() || 'root';
    const dbPassword = String(body.db_password || '');
    const dbName = String(body.db_name || '').trim() || 'project_tracker';
    const exportFields = Array.isArray(body.export_fields)
      ? body.export_fields.filter(f => typeof f === 'string' && f)
      : old.export_fields;

    // 关注标签配置：保留旧值兜底，过滤非法项
    let watchTags;
    if (Array.isArray(body.watch_tags)) {
      watchTags = body.watch_tags
        .filter(t => t && typeof t.name === 'string' && t.name.trim())
        .map(t => ({
          name: t.name.trim(),
          color: /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#533afd',
        }));
    } else {
      watchTags = old.watch_tags;
    }

    if (!folder) {
      return res.status(400).json({ error: '请填写归档文件夹路径' });
    }
    if (!dldir) {
      return res.status(400).json({ error: '请填写浏览器默认下载目录' });
    }

    // 检查下载目录是否存在
    try {
      await fs.access(dldir);
    } catch (e) {
      return res.status(400).json({ error: '浏览器默认下载目录不存在或无法访问', path: dldir });
    }

    // 归档文件夹不存在则自动创建
    await fs.mkdir(folder, { recursive: true });

    // 先测试数据库连接再保存
    const testConfig = {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
    };
    let dbTest;
    try {
      dbTest = await require('mysql2/promise').createConnection(testConfig);
      await dbTest.execute('SELECT 1');
      await dbTest.changeUser({ database: dbName });
      await dbTest.end();
    } catch (dbErr) {
      if (dbTest) {
        try { await dbTest.end(); } catch (e) {}
      }
      return res.status(400).json({ error: '数据库连接测试失败：' + dbErr.message });
    }

    const settings = {
      archive_folder: folder,
      download_dir: dldir,
      db_host: dbHost,
      db_port: dbPort,
      db_user: dbUser,
      db_password: dbPassword,
      db_name: dbName,
      export_fields: exportFields,
      watch_tags: watchTags,
    };
    // 邮件催办配置：body 未传保留旧值，密码空字符串表示不修改，imap 状态原样保留
    for (const [key, def] of Object.entries(EMAIL_DEFAULTS)) {
      if (key === 'smtp_pass' || key === 'imap_pass') continue;
      settings[key] = body[key] !== undefined ? body[key] : (old[key] !== undefined ? old[key] : def);
    }
    settings.smtp_pass = body.smtp_pass ? String(body.smtp_pass) : (old.smtp_pass || '');
    settings.imap_pass = body.imap_pass ? String(body.imap_pass) : (old.imap_pass || '');
    if (old.imap_last_uid !== undefined) settings.imap_last_uid = old.imap_last_uid;
    if (old.imap_uidvalidity !== undefined) settings.imap_uidvalidity = old.imap_uidvalidity;
    await saveSettings(settings);

    // 立即应用数据库配置
    setDbConfig({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
    });

    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('保存设置失败:', err);
    res.status(500).json({ error: '保存设置失败', message: err.message });
  }
});

// 测试数据库连通性（不保存）
app.post('/api/db/test', async (req, res) => {
  try {
    const body = req.body || {};
    const testConfig = {
      host: String(body.db_host || '').trim() || 'localhost',
      port: Number(body.db_port) || 3306,
      user: String(body.db_user || '').trim() || 'root',
      password: String(body.db_password || ''),
      database: String(body.db_name || '').trim() || 'project_tracker',
    };

    const connection = await require('mysql2/promise').createConnection({
      host: testConfig.host,
      port: testConfig.port,
      user: testConfig.user,
      password: testConfig.password,
    });
    await connection.execute('SELECT 1');
    await connection.changeUser({ database: testConfig.database });
    await connection.end();
    res.json({ success: true, message: '数据库连接正常' });
  } catch (err) {
    console.error('数据库连通性测试失败:', err);
    res.status(400).json({ success: false, error: '数据库连接失败：' + err.message });
  }
});

// 打开项目对应的本地文件夹
app.post('/api/open-folder', async (req, res) => {
  try {
    const { project_code, project_name } = req.body || {};
    if (!project_code) {
      return res.status(400).json({ error: '缺少 project_code' });
    }

    const settings = await loadSettings();
    if (!settings.archive_folder) {
      return res.status(400).json({ error: '未配置归档文件夹' });
    }

    const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    const subFolder = project_name ? `${safeName(project_code)}-${safeName(project_name)}` : safeName(project_code);
    const targetDir = path.resolve(settings.archive_folder, subFolder);

    if (!fsSync.existsSync(targetDir)) {
      return res.status(404).json({ error: '项目文件夹不存在', path: targetDir });
    }

    // Windows 使用 explorer.exe 打开文件夹；start /max 尝试最大化，但 File Explorer 不一定始终生效
    const escapedDir = targetDir.replace(/"/g, '""');
    const cmd = `cmd /c start "" /max explorer.exe "${escapedDir}"`;
    exec(cmd, (err) => {
      if (err) {
        console.error('打开文件夹失败:', err);
      }
    });

    res.json({ success: true, path: targetDir });
  } catch (err) {
    console.error('打开文件夹失败:', err);
    res.status(500).json({ error: '打开文件夹失败', message: err.message });
  }
});

// 整理下载的立项批复文件：移动/重命名并生成字段 Excel
app.post('/api/organize-download', async (req, res) => {
  try {
    const { project_code, project_name, source_relative_path, fields } = req.body || {};
    if (!project_code) {
      return res.status(400).json({ error: '缺少 project_code' });
    }
    if (!source_relative_path) {
      return res.status(400).json({ error: '缺少 source_relative_path' });
    }

    const settings = await loadSettings();
    console.log('[organize] 当前设置:', settings);
    if (!settings.archive_folder) {
      return res.status(400).json({ error: '未配置归档文件夹，请先在网页设置' });
    }

    // Chrome downloads API 返回的 filename 可能是相对路径，也可能是绝对路径
    const sourceAbsolute = path.isAbsolute(source_relative_path)
      ? path.resolve(source_relative_path)
      : path.resolve(settings.download_dir, source_relative_path);
    console.log('[organize] 源文件绝对路径:', sourceAbsolute);

    try {
      await fs.access(sourceAbsolute);
    } catch (e) {
      return res.status(400).json({ error: '下载源文件不存在或无法访问', path: sourceAbsolute });
    }

    // 用于文件夹/文件名的安全名称
    function safeName(s) {
      return String(s || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const safeCode = safeName(project_code);
    const safeName2 = safeName(project_name);
    const subFolderName = safeName2 ? `${safeCode}-${safeName2}` : safeCode;
    const targetDir = path.resolve(settings.archive_folder, subFolderName);
    await fs.mkdir(targetDir, { recursive: true });

    const ext = path.extname(source_relative_path) || '.doc';
    const docFileName = safeName2
      ? `${safeCode}-${safeName2}-立项批复（发文）${ext}`
      : `${safeCode}-立项批复（发文）${ext}`;
    const targetDocPath = path.join(targetDir, docFileName);

    // 如果目标已存在则先删除
    try {
      await fs.unlink(targetDocPath);
    } catch (e) {
      // ignore
    }

    // 文件可能被浏览器短暂锁定，重试几次；跨磁盘时 copy+unlink
    let moveError = null;
    for (let i = 0; i < 5; i++) {
      try {
        await fs.rename(sourceAbsolute, targetDocPath);
        moveError = null;
        break;
      } catch (e) {
        moveError = e;
        console.log(`[organize] 移动文件失败，第 ${i + 1} 次重试:`, e.message);
        if (e.code === 'EXDEV') {
          // 跨磁盘，改用复制
          try {
            await fs.copyFile(sourceAbsolute, targetDocPath);
            await fs.unlink(sourceAbsolute);
            moveError = null;
            break;
          } catch (copyErr) {
            moveError = copyErr;
            console.log('[organize] 复制文件失败:', copyErr.message);
          }
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    if (moveError) throw moveError;

    // 生成字段 Excel
    const excelFileName = safeName2
      ? `${safeCode}-${safeName2}-立项批复（发文）.xlsx`
      : `${safeCode}-立项批复（发文）.xlsx`;
    const excelPath = path.join(targetDir, excelFileName);

    // 字段顺序以 projectColumns 为准，排除系统字段
    const excludeFields = new Set(['id', 'created_at', 'updated_at']);
    const orderedFields = projectColumns
      .map(def => {
        const m = def.match(/^`([^`]+)`/);
        return m ? m[1] : '';
      })
      .filter(f => f && !excludeFields.has(f));

    const headers = orderedFields.map(f => COMMENT_MAP[f] || f);
    const dataRow = orderedFields.map(f => {
      const v = fields && fields[f];
      if (v === undefined || v === null) return '';
      return v;
    });

    const ws = xlsx.utils.aoa_to_sheet([headers, dataRow]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '项目信息');
    xlsx.writeFile(wb, excelPath);

    res.json({
      success: true,
      target_dir: targetDir,
      doc_file: targetDocPath,
      excel_file: excelPath
    });
  } catch (err) {
    console.error('整理归档文件失败:', err);
    res.status(500).json({ error: '整理归档文件失败', message: err.message });
  }
});

// 获取 projects 表字段及中文注释（用于展示网页表头）
app.get('/api/projects/columns', async (req, res) => {
  try {
    const rows = await query('SHOW FULL COLUMNS FROM projects');
    const data = rows.map(r => ({
      field: r.Field,
      comment: r.Comment || r.Field,
      type: r.Type,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('获取字段注释失败:', err);
    res.status(500).json({ error: '获取字段注释失败', message: err.message });
  }
});

// 提取字段（不保存）
app.post('/api/extract', (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: '缺少 text 参数' });
  }
  try {
    const result = extract(text);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('提取失败:', err);
    res.status(500).json({ error: '提取失败', message: err.message });
  }
});

// 检查项目编码是否已存在
app.get('/api/projects/check', async (req, res) => {
  try {
    const { project_code } = req.query;
    if (!project_code) {
      return res.status(400).json({ error: '缺少 project_code 参数' });
    }
    const rows = await query('SELECT id, project_name, doc_number FROM projects WHERE project_code = ? LIMIT 1', [project_code]);
    if (rows.length > 0) {
      res.json({ success: true, exists: true, data: rows[0] });
    } else {
      res.json({ success: true, exists: false, data: null });
    }
  } catch (err) {
    console.error('检查项目编码失败:', err);
    res.status(500).json({ error: '检查失败', message: err.message });
  }
});

// 创建项目
app.post('/api/projects', async (req, res) => {
  try {
    const data = req.body;
    const invalid = validateTrackingFields(data);
    if (invalid) return res.status(400).json({ error: '参数校验失败', message: invalid });
    const fields = [
      'source_url', 'extracted_text', 'doc_number', 'category', 'project_code', 'project_name',
      'approval_date', 'design_date', 'completion_date', 'project_set', 'project_subset',
      'project_manager', 'planning_manager',
      'investment_dept', 'investment_person', 'engineering_dept', 'engineering_person',
      'software_dept', 'software_person', 'maintenance_dept', 'maintenance_person',
      'procurement_dept', 'procurement_person',
      'approval_amount', 'amount_note', 'change_status',
      'mid_year_budget', 'budget_increase', 'undecided_supplement', 'decided_budget',
      'decided_in_project', 'undecided_in_project', 'remarks', 'estimated_actual',
      'releasable_amount', 'design_amount', 'completion_amount', 'build_level', 'listed',
      'region', 'is_rnd', 'decision_method', 'status',
      'project_status', 'health_status', 'planned_start_date', 'planned_end_date'
    ];
    const placeholders = fields.map(() => '?').join(',');
    const values = fields.map(f => {
      if (data[f] === undefined || data[f] === '') return null;
      // 数字字段空字符串转 null
      if (['approval_amount', 'estimated_actual', 'releasable_amount', 'design_amount', 'completion_amount'].includes(f)) {
        const n = parseFloat(data[f]);
        return isNaN(n) ? null : n;
      }
      return data[f];
    });

    const sql = `INSERT INTO projects (${fields.map(f => `\`${f}\``).join(',')}) VALUES (${placeholders})`;
    const result = await query(sql, values);
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('保存失败:', err);
    res.status(500).json({ error: '保存失败', message: err.message });
  }
});

// 列表查询
app.get('/api/projects', async (req, res) => {
  try {
    const { status, keyword, build_level, is_rnd, project_status, health_status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * size;

    let where = ' WHERE 1=1';
    const params = [];
    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }
    if (keyword) {
      where += ' AND (project_name LIKE ? OR project_code LIKE ? OR doc_number LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (build_level) {
      where += ' AND build_level = ?';
      params.push(build_level);
    }
    if (is_rnd) {
      where += ' AND is_rnd = ?';
      params.push(is_rnd);
    }
    if (project_status) {
      const values = project_status.split(',').map((s) => s.trim()).filter(Boolean);
      if (values.length > 0) {
        where += ` AND project_status IN (${values.map(() => '?').join(',')})`;
        params.push(...values);
      }
    }
    if (health_status) {
      const values = health_status.split(',').map((s) => s.trim()).filter(Boolean);
      if (values.length > 0) {
        where += ` AND health_status IN (${values.map(() => '?').join(',')})`;
        params.push(...values);
      }
    }

    // 排序字段白名单，未识别回退 id DESC
    const SORTABLE_COLUMNS = new Set([
      'project_status', 'health_status', 'planned_start_date', 'planned_end_date', 'last_progress_date',
    ]);
    let orderBy = ' ORDER BY id DESC';
    if (SORTABLE_COLUMNS.has(req.query.sort)) {
      const dir = String(req.query.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      orderBy = ` ORDER BY \`${req.query.sort}\` ${dir}, id DESC`;
    }

    // LIMIT/OFFSET 直接拼入 SQL，避免部分 MySQL 版本对占位符的支持问题
    const rows = await query(
      `SELECT projects.*,
              (SELECT MAX(report_date) FROM project_progress pp WHERE pp.project_id = projects.id) AS last_progress_date
       FROM projects${where}${orderBy} LIMIT ${size} OFFSET ${offset}`,
      params
    );
    const [countRow] = await query(`SELECT COUNT(*) AS total FROM projects${where}`, params);

    res.json({ success: true, data: rows, total: countRow.total });
  } catch (err) {
    console.error('查询失败:', err);
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

// 单条查询
app.get('/api/projects/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: '查询失败', message: err.message });
  }
});

// 更新
app.put('/api/projects/:id', async (req, res) => {
  try {
    const data = req.body;
    const invalid = validateTrackingFields(data);
    if (invalid) return res.status(400).json({ error: '参数校验失败', message: invalid });
    const fields = [
      'source_url', 'extracted_text', 'doc_number', 'category', 'project_code', 'project_name',
      'approval_date', 'design_date', 'completion_date', 'project_set', 'project_subset',
      'project_manager', 'planning_manager',
      'investment_dept', 'investment_person', 'engineering_dept', 'engineering_person',
      'software_dept', 'software_person', 'maintenance_dept', 'maintenance_person',
      'procurement_dept', 'procurement_person',
      'approval_amount', 'amount_note', 'change_status',
      'mid_year_budget', 'budget_increase', 'undecided_supplement', 'decided_budget',
      'decided_in_project', 'undecided_in_project', 'remarks', 'estimated_actual',
      'releasable_amount', 'design_amount', 'completion_amount', 'build_level', 'listed',
      'region', 'is_rnd', 'decision_method', 'status',
      'project_status', 'health_status', 'planned_start_date', 'planned_end_date'
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (data[f] !== undefined) {
        updates.push(`\`${f}\` = ?`);
        if (['approval_amount', 'estimated_actual', 'releasable_amount', 'design_amount', 'completion_amount'].includes(f)) {
          const n = parseFloat(data[f]);
          values.push(isNaN(n) ? null : n);
        } else {
          values.push(data[f] === '' ? null : data[f]);
        }
      }
    });
    if (updates.length === 0) return res.status(400).json({ error: '没有可更新字段' });
    values.push(req.params.id);
    const sql = `UPDATE projects SET ${updates.join(',')} WHERE id = ?`;
    await query(sql, values);
    res.json({ success: true });
  } catch (err) {
    console.error('更新失败:', err);
    res.status(500).json({ error: '更新失败', message: err.message });
  }
});

// 删除
app.delete('/api/projects/:id', async (req, res) => {
  try {
    await query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败', message: err.message });
  }
});

/* ---------- 进展跟踪接口 ---------- */

// 校验进展数据：isPartial=true（PUT）时未传字段跳过；否则（POST）report_date/completed_content 必填
function validateProgressPayload(data, isPartial) {
  if (!isPartial || data.report_date !== undefined) {
    if (!data.report_date || !DATE_RE.test(data.report_date)) {
      return 'report_date 必填且必须是 YYYY-MM-DD 格式';
    }
  }
  if (!isPartial || data.completed_content !== undefined) {
    if (!data.completed_content || !String(data.completed_content).trim()) {
      return 'completed_content 必填且不能为空';
    }
  }
  if (data.tags) {
    const tags = String(data.tags).split(',').map((s) => s.trim()).filter(Boolean);
    const invalid = tags.filter((t) => !PROGRESS_TAG_VALUES.includes(t));
    if (invalid.length > 0) {
      return `tags 含非法值：${invalid.join('、')}，可选值为：${PROGRESS_TAG_VALUES.join(' / ')}`;
    }
  }
  return null;
}

// 查询某项目进展列表（支持 from/to 按填报日期过滤）
app.get('/api/projects/:id/progress', async (req, res) => {
  try {
    const projectRows = await query('SELECT id FROM projects WHERE id = ?', [req.params.id]);
    if (projectRows.length === 0) return res.status(404).json({ error: '项目不存在' });

    let sql = 'SELECT * FROM project_progress WHERE project_id = ?';
    const params = [req.params.id];
    const { from, to } = req.query;
    if (from && DATE_RE.test(from)) {
      sql += ' AND report_date >= ?';
      params.push(from);
    }
    if (to && DATE_RE.test(to)) {
      sql += ' AND report_date <= ?';
      params.push(to);
    }
    sql += ' ORDER BY report_date DESC, id DESC';

    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('查询进展失败:', err);
    res.status(500).json({ error: '查询进展失败', message: err.message });
  }
});

// 新增进展（attachments 为后续阶段预留，本期恒为 NULL，不接受传入）
app.post('/api/projects/:id/progress', async (req, res) => {
  try {
    const projectRows = await query('SELECT id FROM projects WHERE id = ?', [req.params.id]);
    if (projectRows.length === 0) return res.status(404).json({ error: '项目不存在' });

    const data = req.body;
    const invalid = validateProgressPayload(data, false);
    if (invalid) return res.status(400).json({ error: '参数校验失败', message: invalid });

    const result = await query(
      `INSERT INTO project_progress (project_id, report_date, completed_content, next_plan, risk_note, tags, reporter)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        data.report_date,
        String(data.completed_content).trim(),
        data.next_plan || null,
        data.risk_note || null,
        data.tags ? String(data.tags) : null,
        data.reporter || null,
      ]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('新增进展失败:', err);
    res.status(500).json({ error: '新增进展失败', message: err.message });
  }
});

// 修改进展
app.put('/api/progress/:id', async (req, res) => {
  try {
    const data = req.body;
    const invalid = validateProgressPayload(data, true);
    if (invalid) return res.status(400).json({ error: '参数校验失败', message: invalid });

    const fields = ['report_date', 'completed_content', 'next_plan', 'risk_note', 'tags', 'reporter'];
    const updates = [];
    const values = [];
    for (const f of fields) {
      if (data[f] !== undefined) {
        updates.push(`\`${f}\` = ?`);
        values.push(data[f] === '' ? null : data[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: '没有可更新字段' });

    // mysql2 默认 UPDATE 值未变时 affectedRows=0，不能据此判断 404，先查存在性
    const exists = await query('SELECT id FROM project_progress WHERE id = ?', [req.params.id]);
    if (exists.length === 0) return res.status(404).json({ error: '进展记录不存在' });
    values.push(req.params.id);

    await query(`UPDATE project_progress SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    console.error('更新进展失败:', err);
    res.status(500).json({ error: '更新进展失败', message: err.message });
  }
});

// 删除进展
app.delete('/api/progress/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM project_progress WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: '进展记录不存在' });
    res.json({ success: true });
  } catch (err) {
    console.error('删除进展失败:', err);
    res.status(500).json({ error: '删除进展失败', message: err.message });
  }
});

// 首页进展概览：最近更新 + 进展滞后/未填报（stale 排除已结项项目）
app.get('/api/progress/overview', async (req, res) => {
  try {
    const recent = await query(
      `SELECT pp.id, pp.project_id, p.project_name, pp.report_date, pp.completed_content, pp.tags, pp.reporter
       FROM project_progress pp
       JOIN projects p ON p.id = pp.project_id
       ORDER BY pp.report_date DESC, pp.id DESC
       LIMIT 5`
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

    res.json({ success: true, data: { recent, stale } });
  } catch (err) {
    console.error('查询进展概览失败:', err);
    res.status(500).json({ error: '查询进展概览失败', message: err.message });
  }
});

/* ---------- 联系人接口 ---------- */

// 获取地市/公司可选值（用于筛选下拉框）
app.get('/api/contacts/filters', async (req, res) => {
  try {
    const cities = await query("SELECT DISTINCT city FROM contacts WHERE city IS NOT NULL AND city != '' ORDER BY city");
    const companies = await query("SELECT DISTINCT company FROM contacts WHERE company IS NOT NULL AND company != '' ORDER BY company");
    res.json({
      success: true,
      data: {
        cities: cities.map(r => r.city),
        companies: companies.map(r => r.company),
      },
    });
  } catch (err) {
    res.status(500).json({ error: '获取筛选项失败', message: err.message });
  }
});

// 列表查询
app.get('/api/contacts', async (req, res) => {
  try {
    const { keyword, city, company, sort, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * size;

    let where = ' WHERE 1=1';
    const params = [];
    if (keyword) {
      where += ' AND (`name` LIKE ? OR `company` LIKE ? OR `department` LIKE ? OR `phone` LIKE ? OR `related_project` LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (city) {
      where += ' AND `city` = ?';
      params.push(city);
    }
    if (company) {
      where += ' AND `company` = ?';
      params.push(company);
    }

    // 排序字段白名单，防止注入
    const sortable = { city: 'city', company: 'company' };
    let orderBy = 'id DESC';
    if (sortable[sort]) {
      const dir = order === 'asc' ? 'ASC' : 'DESC';
      orderBy = `\`${sortable[sort]}\` ${dir}, id DESC`;
    }

    const rows = await query(`SELECT * FROM contacts${where} ORDER BY ${orderBy} LIMIT ${size} OFFSET ${offset}`, params);
    const [countRow] = await query(`SELECT COUNT(*) AS total FROM contacts${where}`, params);

    res.json({ success: true, data: rows, total: countRow.total });
  } catch (err) {
    console.error('查询联系人失败:', err);
    res.status(500).json({ error: '查询联系人失败', message: err.message });
  }
});

// 单条查询
app.get('/api/contacts/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM contacts WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '联系人不存在' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: '查询联系人失败', message: err.message });
  }
});

// 创建联系人
app.post('/api/contacts', async (req, res) => {
  try {
    const data = req.body || {};
    const values = contactFields.map(f => {
      const v = data[f];
      return v === undefined || v === '' ? null : v;
    });
    const placeholders = contactFields.map(() => '?').join(',');
    const sql = `INSERT INTO contacts (${contactFields.map(f => '\`' + f + '\`').join(',')}) VALUES (${placeholders})`;
    const result = await query(sql, values);
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('创建联系人失败:', err);
    res.status(500).json({ error: '创建联系人失败', message: err.message });
  }
});

// 更新联系人
app.put('/api/contacts/:id', async (req, res) => {
  try {
    const data = req.body || {};
    const updates = [];
    const values = [];
    for (const f of contactFields) {
      if (data[f] !== undefined) {
        updates.push('\`' + f + '\` = ?');
        values.push(data[f] === '' ? null : data[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: '没有可更新字段' });
    values.push(req.params.id);
    const sql = `UPDATE contacts SET ${updates.join(',')} WHERE id = ?`;
    await query(sql, values);
    res.json({ success: true });
  } catch (err) {
    console.error('更新联系人失败:', err);
    res.status(500).json({ error: '更新联系人失败', message: err.message });
  }
});

// 删除联系人
app.delete('/api/contacts/:id', async (req, res) => {
  try {
    await query('DELETE FROM contacts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除联系人失败', message: err.message });
  }
});

/* ---------- 关注项目接口 ---------- */

// 关注项目列表（关联 projects 表取项目信息）
app.get('/api/watch-projects', async (req, res) => {
  try {
    const { keyword } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * size;

    let where = ' WHERE 1=1';
    const params = [];
    if (keyword) {
      where += ' AND (p.project_name LIKE ? OR p.project_code LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // 排序字段白名单，默认按立项批复日期从早到晚（空日期排最后）
    const sortable = {
      approval_date: 'p.approval_date',
      project_code: 'p.project_code',
      project_name: 'p.project_name',
      project_set: 'p.project_set',
      project_subset: 'p.project_subset',
      investment_person: 'p.investment_person',
      maintenance_person: 'p.maintenance_person',
    };
    const sortCol = sortable[req.query.sort] || 'p.approval_date';
    const sortDir = req.query.order === 'desc' ? 'DESC' : 'ASC';
    const orderBy = `${sortCol} IS NULL, ${sortCol} ${sortDir}, w.id DESC`;

    const rows = await query(`
      SELECT w.id, w.project_id, w.watch_type, w.created_at,
             p.project_code, p.project_name, p.approval_date, p.project_set, p.project_subset,
             p.investment_person, p.maintenance_person,
             (SELECT COUNT(*) FROM watch_progress wp WHERE wp.watch_id = w.id) AS progress_count,
             (SELECT wp.description FROM watch_progress wp WHERE wp.watch_id = w.id ORDER BY wp.id DESC LIMIT 1) AS latest_progress
      FROM watch_projects w
      LEFT JOIN projects p ON p.id = w.project_id
      ${where}
      ORDER BY ${orderBy} LIMIT ${size} OFFSET ${offset}
    `, params);

    const [countRow] = await query(`
      SELECT COUNT(*) AS total FROM watch_projects w LEFT JOIN projects p ON p.id = w.project_id ${where}
    `, params);

    res.json({ success: true, data: rows, total: countRow.total });
  } catch (err) {
    console.error('查询关注项目失败:', err);
    res.status(500).json({ error: '查询关注项目失败', message: err.message });
  }
});

// 添加关注项目
app.post('/api/watch-projects', async (req, res) => {
  try {
    const projectId = parseInt(req.body.project_id, 10);
    if (!projectId) {
      return res.status(400).json({ error: '缺少 project_id' });
    }
    const watchType = String(req.body.watch_type || '').trim() || null;
    const rows = await query('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '项目不存在' });
    }
    try {
      const result = await query('INSERT INTO watch_projects (project_id, watch_type) VALUES (?, ?)', [projectId, watchType]);
      res.json({ success: true, id: result.insertId });
    } catch (dupErr) {
      if (dupErr.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: '该项目已在关注列表中' });
      }
      throw dupErr;
    }
  } catch (err) {
    console.error('添加关注项目失败:', err);
    res.status(500).json({ error: '添加关注项目失败', message: err.message });
  }
});

// 修改关注类型
app.put('/api/watch-projects/:id', async (req, res) => {
  try {
    const watchType = String(req.body.watch_type || '').trim() || null;
    await query('UPDATE watch_projects SET watch_type = ? WHERE id = ?', [watchType, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '修改关注类型失败', message: err.message });
  }
});

// 删除关注项目（同时删除其进展记录）
app.delete('/api/watch-projects/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await query('DELETE FROM watch_progress WHERE watch_id = ?', [id]);
    await query('DELETE FROM watch_projects WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除关注项目失败', message: err.message });
  }
});

// 某关注项目的进展列表
app.get('/api/watch-projects/:id/progress', async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, watch_id, description, created_at, updated_at FROM watch_progress WHERE watch_id = ? ORDER BY id DESC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: '查询进展失败', message: err.message });
  }
});

// 新增进展
app.post('/api/watch-projects/:id/progress', async (req, res) => {
  try {
    const description = String(req.body.description || '').trim();
    if (!description) {
      return res.status(400).json({ error: '说明不能为空' });
    }
    const result = await query(
      'INSERT INTO watch_progress (watch_id, description) VALUES (?, ?)',
      [req.params.id, description]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: '新增进展失败', message: err.message });
  }
});

// 修改进展
app.put('/api/watch-progress/:id', async (req, res) => {
  try {
    const description = String(req.body.description || '').trim();
    if (!description) {
      return res.status(400).json({ error: '说明不能为空' });
    }
    await query('UPDATE watch_progress SET description = ? WHERE id = ?', [description, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '修改进展失败', message: err.message });
  }
});

// 删除进展
app.delete('/api/watch-progress/:id', async (req, res) => {
  try {
    await query('DELETE FROM watch_progress WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除进展失败', message: err.message });
  }
});

/* ---------- 公司通讯录（原 WorkBuddy 项目集成） ---------- */

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// 搜索公司通讯录人员（默认最新批次），用于联系人页面复制信息
app.get('/api/company-contacts/search', async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    if (!keyword) {
      return res.json({ success: true, data: [] });
    }

    // 优先使用指定批次，否则取最新批次
    let batchId = String(req.query.batch_id || '').trim();
    if (!batchId) {
      const batchRows = await query(`
        SELECT batch_id FROM oa_contacts.personnel
        WHERE batch_id IS NOT NULL AND batch_id != ''
        GROUP BY batch_id ORDER BY batch_id DESC LIMIT 1
      `);
      if (batchRows.length === 0) {
        return res.json({ success: true, data: [] });
      }
      batchId = batchRows[0].batch_id;
    }

    const like = `%${keyword}%`;
    const rows = await query(`
      SELECT name, title, mobile_phone, short_number, email, dept_path
      FROM oa_contacts.personnel
      WHERE batch_id = ? AND (
        name LIKE ? OR mobile_phone LIKE ? OR short_number LIKE ? OR email LIKE ? OR dept_path LIKE ?
      )
      ORDER BY name
      LIMIT 10
    `, [batchId, like, like, like, like, like]);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('搜索公司通讯录人员失败:', err);
    res.status(500).json({ error: '搜索公司通讯录人员失败', message: err.message });
  }
});

// 所有批次
app.get('/api/company-contacts/batch_ids', async (req, res) => {
  try {
    const rows = await query(`
      SELECT batch_id, COUNT(*) AS cnt, MAX(scraped_at) AS latest
      FROM oa_contacts.personnel
      WHERE batch_id IS NOT NULL AND batch_id != ''
      GROUP BY batch_id
      ORDER BY batch_id DESC
    `);
    const data = rows.map(r => ({
      batch_id: r.batch_id,
      count: r.cnt,
      latest: formatDateTime(r.latest),
    }));
    res.json(data);
  } catch (err) {
    console.error('查询通讯录批次失败:', err);
    res.status(500).json({ error: '查询通讯录批次失败', message: err.message });
  }
});

// 部门树
app.get('/api/company-contacts/departments', async (req, res) => {
  try {
    const rows = await query(`
      SELECT dept_path, dept_name, level, sort_order
      FROM oa_contacts.departments
      ORDER BY level, sort_order
    `);
    res.json({ data: rows });
  } catch (err) {
    console.error('查询通讯录部门失败:', err);
    res.status(500).json({ error: '查询通讯录部门失败', message: err.message });
  }
});

// 人员列表
app.get('/api/company-contacts/personnel', async (req, res) => {
  try {
    const batch_id = req.query.batch_id;
    if (!batch_id) {
      return res.status(400).json({ error: 'batch_id is required' });
    }

    // 构建部门排序映射
    const deptRows = await query(`
      SELECT dept_path, sort_order
      FROM oa_contacts.departments
      ORDER BY level, sort_order
    `);
    const pathSort = {};
    for (const r of deptRows) {
      pathSort[r.dept_path] = r.sort_order != null ? r.sort_order : 9999;
    }
    const deptSortMap = {};
    for (const dept_path in pathSort) {
      const parts = dept_path.split(' > ');
      const sortParts = [];
      let current = '';
      for (const part of parts) {
        current = current ? `${current} > ${part}` : part;
        sortParts.push(String(pathSort[current] || 9999).padStart(5, '0'));
      }
      deptSortMap[dept_path] = sortParts.join('.');
    }
    const hasDeptSort = deptRows.length > 0;

    const rows = await query(`
      SELECT id, dept_path, name, title, mobile_phone, short_number, email,
             scraped_at, batch_id, channel, sort_order
      FROM oa_contacts.personnel
      WHERE batch_id = ?
    `, [batch_id]);

    for (const row of rows) {
      if (row.scraped_at) row.scraped_at = formatDateTime(row.scraped_at);
      row.dept_sort_key = deptSortMap[row.dept_path] || '';
      if (row.sort_order == null) row.sort_order = 9999;
    }

    if (hasDeptSort) {
      rows.sort((a, b) => (a.dept_sort_key > b.dept_sort_key ? 1 : a.dept_sort_key < b.dept_sort_key ? -1 : 0)
        || (a.sort_order - b.sort_order));
    } else {
      rows.sort((a, b) => (a.dept_path || '').localeCompare(b.dept_path || '') || (a.sort_order - b.sort_order));
    }

    res.json({ batch_id, total: rows.length, data: rows });
  } catch (err) {
    console.error('查询通讯录人员失败:', err);
    res.status(500).json({ error: '查询通讯录人员失败', message: err.message });
  }
});

// 问题跟踪模块（独立 Router，第三阶段起新模块不再内联）
app.use(issuesRouter);

async function start() {
  // 加载本地设置并应用数据库配置（覆盖环境变量默认值）
  try {
    const settings = await loadSettings();
    if (settings.db_host) {
      setDbConfig({
        host: settings.db_host,
        port: Number(settings.db_port) || 3306,
        user: settings.db_user,
        password: settings.db_password,
        database: settings.db_name,
      });
    }
  } catch (err) {
    console.warn('加载本地设置失败，使用环境变量默认配置:', err.message);
  }

  await initDatabase();
  app.listen(PORT, () => {
    console.log(`项目信息提取后端已启动: http://localhost:${PORT}`);
  });
}

// 直接运行时启动服务；被测试 require 时仅导出 app
if (require.main === module) {
  start().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
  });
}

module.exports = { app, start };
