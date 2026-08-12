const test = require('node:test');
const assert = require('node:assert');
const { formatDateStr, getWeekRange, isInWeek, formatWeeklyReport } = require('../public/weekly-utils');

test('formatDateStr 返回 YYYY-MM-DD', () => {
  assert.strictEqual(formatDateStr(new Date('2026-08-12T08:00:00Z')), '2026-08-12');
});

test('getWeekRange 周三返回上周六到本周五', () => {
  // 2026-08-12 是周三
  const { start, end } = getWeekRange('2026-08-12');
  assert.strictEqual(start, '2026-08-08'); // 周六
  assert.strictEqual(end, '2026-08-14');   // 周五
});

test('getWeekRange 周六当天返回当天到下周周五', () => {
  // 2026-08-08 是周六
  const { start, end } = getWeekRange('2026-08-08');
  assert.strictEqual(start, '2026-08-08');
  assert.strictEqual(end, '2026-08-14');
});

test('getWeekRange 周五返回上周六到当天', () => {
  // 2026-08-14 是周五
  const { start, end } = getWeekRange('2026-08-14');
  assert.strictEqual(start, '2026-08-08');
  assert.strictEqual(end, '2026-08-14');
});

test('isInWeek 边界判断', () => {
  assert.strictEqual(isInWeek('2026-08-08', '2026-08-08', '2026-08-14'), true);
  assert.strictEqual(isInWeek('2026-08-14', '2026-08-08', '2026-08-14'), true);
  assert.strictEqual(isInWeek('2026-08-07', '2026-08-08', '2026-08-14'), false);
  assert.strictEqual(isInWeek('2026-08-15', '2026-08-08', '2026-08-14'), false);
});

test('formatWeeklyReport 生成完整文本', () => {
  const text = formatWeeklyReport({
    projectName: '测试项目',
    weekStart: '2026-08-08',
    weekEnd: '2026-08-14',
    progressItems: [
      { report_date: '2026-08-12', reporter: '张三', completed_content: '完成A', next_plan: '计划B', risk_note: '风险C' },
      { report_date: '2026-08-10', reporter: '李四', completed_content: '完成D', next_plan: '', risk_note: '' },
    ],
    issues: [
      { issue_no: 'ISS-0001', title: '问题1', assignee: '张三', severity: '紧急', status: '处理中' },
      { issue_no: 'ISS-0002', title: '问题2', assignee: '', severity: '一般', status: '新建' },
    ],
  });
  assert.ok(text.includes('项目名称：测试项目'));
  assert.ok(text.includes('统计周期：2026-08-08 至 2026-08-14'));
  assert.ok(text.includes('【本周进展】'));
  assert.ok(text.includes('2026-08-12 张三'));
  assert.ok(text.includes('完成内容：完成A'));
  assert.ok(text.includes('2026-08-10 李四'));
  assert.ok(text.includes('【下阶段计划】'));
  assert.ok(text.includes('计划内容：计划B'));
  assert.ok(text.includes('【风险说明】'));
  assert.ok(text.includes('风险内容：风险C'));
  assert.ok(text.includes('【遗留问题】'));
  assert.ok(text.includes('ISS-0001 问题1 负责人：张三 严重程度：紧急 状态：处理中'));
  assert.ok(text.includes('ISS-0002 问题2 负责人：— 严重程度：一般 状态：新建'));
});

test('formatWeeklyReport 空数据时显示暂无记录', () => {
  const text = formatWeeklyReport({
    projectName: '空项目',
    weekStart: '2026-08-08',
    weekEnd: '2026-08-14',
    progressItems: [],
    issues: [],
  });
  assert.ok(text.includes('本周暂无记录'));
  assert.ok(text.includes('暂无未关闭问题'));
});
