// Markdown 表格渲染工具：纯函数，双导出（浏览器挂 window.renderMarkdownTables，Node 可 require 测试）
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.renderMarkdownTables = api.renderMarkdownTables;
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 分隔行：只含 | - : 空格，且必须有 -（如 |---|---| 或 | --- | :---: |）
  function isSeparatorRow(line) {
    const t = line.trim();
    if (!t.includes('|') || !t.includes('-')) return false;
    return /^\|?[\s:|-]+\|?$/.test(t);
  }

  function isTableRow(line) {
    const t = line.trim();
    return t.startsWith('|') && t.endsWith('|');
  }

  // 按未转义的 | 切分；\| 还原为 |
  function splitRow(line) {
    const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
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
  }

  function renderMarkdownTables(text) {
    const lines = String(text || '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
        const header = splitRow(lines[i]);
        const bodyRows = [];
        let j = i + 2;
        while (j < lines.length && isTableRow(lines[j])) {
          const cells = splitRow(lines[j]);
          if (cells.length !== header.length) break; // 列数不齐：表格截止
          bodyRows.push(cells);
          j++;
        }
        let html = '<table class="md-table"><thead><tr>';
        html += header.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
        html += '</tr></thead><tbody>';
        for (const cells of bodyRows) {
          html += '<tr>' + cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>';
        }
        html += '</tbody></table>';
        out.push(html);
        i = j;
      } else {
        out.push(escapeHtml(lines[i]));
        i++;
      }
    }
    return out.join('\n');
  }

  return { renderMarkdownTables };
});
