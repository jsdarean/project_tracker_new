(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.WeeklyUtils = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  function formatDateStr(date) {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getWeekRange(dateStr) {
    const today = dateStr ? new Date(dateStr) : new Date();
    const day = today.getDay(); // 0=周日, 1=周一, ..., 6=周六
    // 距离本周六的天数：周六(6)→0, 周日(0)→-1, 周一(1)→-2, ..., 周五(5)→-6
    const offset = day === 6 ? 0 : -(day + 1);
    const saturday = new Date(today);
    saturday.setDate(today.getDate() + offset);
    const friday = new Date(saturday);
    friday.setDate(saturday.getDate() + 6);
    return { start: formatDateStr(saturday), end: formatDateStr(friday) };
  }

  function isInWeek(dateStr, weekStart, weekEnd) {
    return dateStr >= weekStart && dateStr <= weekEnd;
  }

  function formatWeeklyReport({ projectName, weekStart, weekEnd, progressItems, issues }) {
    const lines = [];
    lines.push(`项目名称：${projectName || '未知项目'}`);
    lines.push(`统计周期：${weekStart} 至 ${weekEnd}`);
    lines.push('');

    const sections = [
      { key: 'completed_content', title: '【本周进展】', label: '完成内容' },
      { key: 'next_plan', title: '【下阶段计划】', label: '计划内容' },
      { key: 'risk_note', title: '【风险说明】', label: '风险内容' },
    ];

    for (const sec of sections) {
      lines.push(sec.title);
      const items = (progressItems || []).filter(p => p[sec.key]);
      if (items.length === 0) {
        lines.push('本周暂无记录');
      } else {
        for (const item of items) {
          lines.push(`${item.report_date} ${item.reporter || ''}`.trim());
          lines.push(`${sec.label}：${item[sec.key]}`);
          lines.push('');
        }
      }
      lines.push('');
    }

    lines.push('【遗留问题】');
    const activeIssues = (issues || []).filter(i => i.status !== '已关闭');
    if (activeIssues.length === 0) {
      lines.push('暂无未关闭问题');
    } else {
      for (const issue of activeIssues) {
        lines.push(`${issue.issue_no} ${issue.title} 负责人：${issue.assignee || '—'} 严重程度：${issue.severity} 状态：${issue.status}`);
      }
    }

    return lines.join('\n');
  }

  return { formatDateStr, getWeekRange, isInWeek, formatWeeklyReport };
});
