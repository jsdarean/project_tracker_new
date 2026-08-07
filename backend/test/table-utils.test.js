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
