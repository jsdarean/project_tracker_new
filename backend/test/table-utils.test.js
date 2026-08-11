const test = require('node:test');
const assert = require('node:assert');
const { renderMarkdownTables } = require('../public/markdown-table.js');

test('合法表格渲染为 HTML 表格', () => {
  const md = '| 任务 | 负责人 |\n|---|---|\n| 数据库设计 | 张三 |\n| 接口开发 | 李四 |';
  const html = renderMarkdownTables(md);
  assert.ok(html.includes('<table class="md-table">'));
  assert.ok(html.includes('<th>任务</th>'));
  assert.ok(html.includes('<th>负责人</th>'));
  assert.ok(html.includes('<td>数据库设计</td>'));
  assert.ok(html.includes('<td>李四</td>'));
  assert.ok(html.includes('<tbody>'));
});

test('单元格内容转义防 XSS', () => {
  const md = '| 标题 |\n|---|\n| <script>alert(1)</script> |';
  const html = renderMarkdownTables(md);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('非表格文本原样保留并转义，表格前后文本共存', () => {
  const md = '本周完成：\n| 事项 | 状态 |\n|---|---|\n| 联调 | 完成 |\n下周计划见会议纪要 <重点>';
  const html = renderMarkdownTables(md);
  assert.ok(html.startsWith('本周完成：'));
  assert.ok(html.includes('<table class="md-table">'));
  assert.ok(html.includes('下周计划见会议纪要 &lt;重点&gt;'));
});

test('缺分隔行按纯文本处理', () => {
  const md = '| a | b |\n| c | d |';
  const html = renderMarkdownTables(md);
  assert.ok(!html.includes('<table'));
  assert.ok(html.includes('| a | b |'));
});

test('数据行列数不齐时表格截止、余行按纯文本', () => {
  const md = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 | 5 |\n| 6 | 7 |';
  const html = renderMarkdownTables(md);
  assert.ok(html.includes('<td>1</td>'));
  assert.ok(html.includes('<td>2</td>'));
  assert.ok(!html.includes('<td>3</td>'), '列数不齐的行不进入表格');
  assert.ok(html.includes('| 3 | 4 | 5 |'));
  assert.ok(html.includes('| 6 | 7 |'));
});

test('中英文混合与空单元格', () => {
  const md = '| 项目 | 金额（万元） |\n|---|---|\n| 网管系统开发 |  |';
  const html = renderMarkdownTables(md);
  assert.ok(html.includes('<th>金额（万元）</th>'));
  assert.ok(html.includes('<td></td>'));
});

const { gridToMarkdown, markdownToGrid, parseTsv, findTableRange } = require('../public/table-editor.js');

test('gridToMarkdown 生成紧凑管道表格，空单元格写空格，竖线转义', () => {
  const grid = [['任务', '负责人'], ['数据库设计', '张三'], ['A|B 测试', '']];
  const md = gridToMarkdown(grid);
  assert.strictEqual(
    md,
    '| 任务 | 负责人 |\n|---|---|\n| 数据库设计 | 张三 |\n| A\\|B 测试 |   |'
  );
});

test('markdownToGrid 解析并与 gridToMarkdown 互逆', () => {
  const grid = [['任务', '负责人'], ['数据库设计', '张三'], ['A|B 测试', '']];
  const md = gridToMarkdown(grid);
  const parsed = markdownToGrid(md);
  assert.deepStrictEqual(parsed, grid, '解析应与原网格一致（含 \\| 还原与空单元格）');
  assert.strictEqual(markdownToGrid('没有表格'), null);
  assert.strictEqual(markdownToGrid('| a |\n缺少分隔行'), null);
});

test('parseTsv：Excel 粘贴文本解析、尾部空行空列修剪、CRLF', () => {
  const grid = parseTsv('任务\t负责人\r\n设计\t张三\r\n开发\t李四\r\n');
  assert.deepStrictEqual(grid, [['任务', '负责人'], ['设计', '张三'], ['开发', '李四']]);
  assert.deepStrictEqual(parseTsv('a\t\t\n'), [['a']], '尾部全空列被修剪');
});

test('findTableRange：定位光标处的表格段', () => {
  const text = '前文\n| a | b |\n|---|---|\n| 1 | 2 |\n后文';
  const start = text.indexOf('| a');
  const range = findTableRange(text, start + 5, start + 5);
  assert.ok(range);
  assert.strictEqual(text.slice(range.start, range.end), '| a | b |\n|---|---|\n| 1 | 2 |');
  assert.strictEqual(findTableRange(text, 1, 1), null, '光标在非表格行返回 null');
});

test('findTableRange：光标在表格段但不是合法表格时返回 null', () => {
  const text = '| a | b |\n| 1 | 2 |';
  assert.strictEqual(findTableRange(text, 3, 3), null, '缺分隔行的段不算表格');
});

test('markdownToGrid：无首尾管道的表格也可载入（与展示端判定对齐）', () => {
  const grid = markdownToGrid('任务 | 负责人\n---|---\n设计 | 张三');
  assert.deepStrictEqual(grid, [['任务', '负责人'], ['设计', '张三']]);
});

test('markdownToGrid：转义竖线切分不依赖负后顾（字符循环实现）', () => {
  const grid = markdownToGrid('| a |\n|---|\n| x\\|y |');
  assert.deepStrictEqual(grid, [['a'], ['x|y']]);
});

test('表格外包 md-table-wrap 横向滚动容器', () => {
  const md = '| a |\n|---|\n| 1 |';
  const html = renderMarkdownTables(md);
  assert.ok(html.includes('<div class="md-table-wrap"><table class="md-table">'));
  assert.ok(html.includes('</table></div>'));
});
