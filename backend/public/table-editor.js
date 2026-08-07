// 表格编辑弹层：双导出（浏览器挂 window.attachTableEditor，Node 可 require 纯函数测试）
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.attachTableEditor = api.attachTableEditor;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---------- 纯函数 ---------- */

  // 网格 → Markdown（紧凑格式；空单元格写空格；| 转义为 \|）
  function gridToMarkdown(grid) {
    if (!grid.length || !grid[0].length) return '';
    const esc = (s) => {
      const v = String(s === null || s === undefined ? '' : s).trim().replace(/\|/g, '\\|');
      return v === '' ? ' ' : v;
    };
    const lines = [];
    lines.push('| ' + grid[0].map(esc).join(' | ') + ' |');
    lines.push('|' + grid[0].map(() => '---').join('|') + '|');
    for (const row of grid.slice(1)) {
      lines.push('| ' + row.map(esc).join(' | ') + ' |');
    }
    return lines.join('\n');
  }

  // Markdown → 网格；不是合法表格返回 null
  function markdownToGrid(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter((l) => l !== '');
    if (lines.length < 2) return null;
    if (!lines[0].includes('|')) return null;
    if (!lines[1].includes('|') || !lines[1].includes('-') || !/^\|?[\s:|-]+\|?$/.test(lines[1])) return null;
    // 逐字符切分：\| 还原为 |，裸 | 为分隔（不用负后顾，兼容 Safari < 16.4）
    const split = (line) => {
      const t = line.replace(/^\|/, '').replace(/\|$/, '');
      const cells = [];
      let cur = '';
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '\\' && t[i + 1] === '|') {
          cur += '|';
          i++;
        } else if (t[i] === '|') {
          cells.push(cur.trim());
          cur = '';
        } else {
          cur += t[i];
        }
      }
      cells.push(cur.trim());
      return cells;
    };
    const header = split(lines[0]);
    const grid = [header];
    for (const line of lines.slice(2)) {
      if (!line.includes('|')) return null;
      const cells = split(line);
      if (cells.length !== header.length) return null;
      grid.push(cells);
    }
    return grid;
  }

  // Excel/TSV 粘贴文本 → 网格（去尾部空行与尾部全空列）
  function parseTsv(text) {
    const rows = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    while (rows.length && rows[rows.length - 1].trim() === '') rows.pop();
    const grid = rows.map((r) => r.split('\t').map((c) => c.trim()));
    let maxCol = 1;
    for (const row of grid) {
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c] !== '') { maxCol = Math.max(maxCol, c + 1); break; }
      }
    }
    return grid.map((row) => row.slice(0, maxCol));
  }

  // 定位选区/光标所在的 Markdown 表格段，返回 {start, end}（字符偏移），无则 null
  function findTableRange(fullText, selStart, selEnd) {
    const text = String(fullText || '');
    const lines = text.split('\n');
    const offsets = [];
    let pos = 0;
    for (const line of lines) {
      offsets.push(pos);
      pos += line.length + 1;
    }
    let row = -1;
    for (let i = 0; i < lines.length; i++) {
      if (offsets[i] <= selStart && selStart <= offsets[i] + lines[i].length) { row = i; break; }
    }
    if (row === -1) return null;
    const isRow = (l) => (l || '').trim().includes('|');
    if (!isRow(lines[row])) return null;
    let start = row;
    let end = row;
    while (start > 0 && isRow(lines[start - 1])) start--;
    while (end < lines.length - 1 && isRow(lines[end + 1])) end++;
    const block = lines.slice(start, end + 1).join('\n');
    if (!markdownToGrid(block)) return null;
    return { start: offsets[start], end: offsets[end] + lines[end].length };
  }

  /* ---------- DOM 部分（仅浏览器调用） ---------- */

  function escapeAttr(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 把「表格」按钮绑定到文本框：点击打开网格弹层，载入/插入/替换 Markdown 表格
  function attachTableEditor(textarea, button) {
    let grid = [];
    let replaceRange = null; // null 表示在光标处插入
    let focusCell = { r: 0, c: 0 };

    const overlay = document.createElement('div');
    overlay.className = 'te-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="te-card">
        <div class="te-toolbar">
          <button type="button" class="btn-secondary te-add-row">加行</button>
          <button type="button" class="btn-secondary te-add-col">加列</button>
          <span class="te-hint">可直接 Ctrl+V 粘贴 Excel 区域</span>
        </div>
        <div class="te-grid-wrap"><table class="te-grid"></table></div>
        <div class="te-actions">
          <button type="button" class="btn-primary te-ok">确定</button>
          <button type="button" class="btn-secondary te-cancel">取消</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const gridTable = overlay.querySelector('.te-grid');

    function renderGrid() {
      const rowsHtml = grid.map((row, ri) => {
        const tag = ri === 0 ? 'th' : 'td';
        return '<tr>' + row.map((cell, ci) =>
          `<${tag}><input type="text" data-r="${ri}" data-c="${ci}" value="${escapeAttr(cell)}"></${tag}>`
        ).join('') + `<td class="te-del te-row-del" data-r="${ri}" title="删除本行">×</td></tr>`;
      }).join('');
      const colDel = '<tr class="te-col-del-row">' + grid[0].map((_, ci) =>
        `<td class="te-del te-col-del" data-c="${ci}" title="删除本列">×</td>`
      ).join('') + '<td></td></tr>';
      gridTable.innerHTML = rowsHtml + colDel;
    }

    function open() {
      const selStart = textarea.selectionStart !== undefined ? textarea.selectionStart : textarea.value.length;
      const selEnd = textarea.selectionEnd !== undefined ? textarea.selectionEnd : selStart;
      replaceRange = findTableRange(textarea.value, selStart, selEnd);
      if (replaceRange) {
        grid = markdownToGrid(textarea.value.slice(replaceRange.start, replaceRange.end));
      } else {
        grid = [[' ', ' ', ' '], [' ', ' ', ' '], [' ', ' ', ' ']];
      }
      focusCell = { r: 0, c: 0 };
      renderGrid();
      overlay.style.display = 'flex';
    }

    function close() {
      overlay.style.display = 'none';
    }

    function confirmWrite() {
      const md = gridToMarkdown(grid.map((row) => row.map((c) => c.trim())));
      if (!md || grid.every((row) => row.every((c) => c.trim() === ''))) {
        if (!confirm('表格内容为空，确定不插入并关闭吗？')) return;
        close();
        return;
      }
      const val = textarea.value;
      if (replaceRange) {
        textarea.value = val.slice(0, replaceRange.start) + md + val.slice(replaceRange.end);
        const pos = replaceRange.start + md.length;
        textarea.setSelectionRange(pos, pos);
      } else {
        const pos = selStartSafe();
        const before = val.slice(0, pos);
        const after = val.slice(pos);
        const prefix = before === '' || before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
        const suffix = after === '' || after.startsWith('\n\n') ? '' : (after.startsWith('\n') ? '\n' : '\n\n');
        textarea.value = before + prefix + md + '\n' + suffix + after;
        const newPos = (before + prefix + md + '\n').length;
        textarea.setSelectionRange(newPos, newPos);
      }
      // 触发 input 让预览区等监听器刷新
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      close();
    }

    function selStartSafe() {
      return textarea.selectionStart !== undefined ? textarea.selectionStart : textarea.value.length;
    }

    button.addEventListener('click', open);
    overlay.querySelector('.te-ok').addEventListener('click', confirmWrite);
    overlay.querySelector('.te-cancel').addEventListener('click', close);
    overlay.querySelector('.te-add-row').addEventListener('click', () => {
      grid.push(new Array(grid[0].length).fill(''));
      renderGrid();
    });
    overlay.querySelector('.te-add-col').addEventListener('click', () => {
      for (const row of grid) row.push('');
      renderGrid();
    });

    // 单元格输入实时同步到 grid（不触发重绘，避免丢焦点）
    gridTable.addEventListener('input', (e) => {
      const input = e.target.closest('input[data-r]');
      if (!input) return;
      grid[Number(input.dataset.r)][Number(input.dataset.c)] = input.value;
    });
    gridTable.addEventListener('focusin', (e) => {
      const input = e.target.closest('input[data-r]');
      if (input) focusCell = { r: Number(input.dataset.r), c: Number(input.dataset.c) };
    });
    gridTable.addEventListener('click', (e) => {
      const rowDel = e.target.closest('.te-row-del');
      if (rowDel) {
        grid.splice(Number(rowDel.dataset.r), 1);
        if (grid.length === 0) grid.push(new Array(grid[0] ? grid[0].length : 1).fill(''));
        if (grid.length > 0 && grid[0].length === 0) grid = [['']];
        renderGrid();
        return;
      }
      const colDel = e.target.closest('.te-col-del');
      if (colDel) {
        const ci = Number(colDel.dataset.c);
        for (const row of grid) row.splice(ci, 1);
        if (grid[0].length === 0) grid = grid.map(() => ['']);
        renderGrid();
      }
    });

    // Excel 粘贴：从焦点单元格起填充，自动扩行列
    overlay.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
      e.preventDefault();
      let data = parseTsv(text);
      if (data.length > 500) {
        data = data.slice(0, 500);
        alert('粘贴内容超过 500 行，已截断');
      }
      const needRows = focusCell.r + data.length;
      const needCols = focusCell.c + Math.max(...data.map((r) => r.length));
      while (grid.length < needRows) grid.push(new Array(grid[0].length).fill(''));
      for (const row of grid) while (row.length < needCols) row.push('');
      for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < data[r].length; c++) {
          if (data[r][c] !== '') grid[focusCell.r + r][focusCell.c + c] = data[r][c];
        }
      }
      renderGrid();
    });
  }

  return { gridToMarkdown, markdownToGrid, parseTsv, findTableRange, attachTableEditor };
});
