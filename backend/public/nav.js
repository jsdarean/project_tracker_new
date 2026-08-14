(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.Nav = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  const NAV_ITEMS = [
    { key: 'index', label: '项目查询', href: 'index.html' },
    { key: 'issues', label: '问题跟踪', href: 'issues.html' },
    { key: 'escalation', label: '催办管理', href: 'escalation.html' },
    { key: 'contacts', label: '联系人', href: 'contacts.html' },
    { key: 'company_contacts', label: '公司通讯录', href: 'company_contacts.html' },
    { key: 'settings', label: '设置', href: 'settings.html' },
  ];

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderNav({ current, breadcrumb, actions }) {
    const itemsHtml = NAV_ITEMS.map(item => {
      const isCurrent = item.key === current;
      return `<a class="nav-item${isCurrent ? ' nav-item-current' : ''}" href="${item.href}">${escapeHtml(item.label)}</a>`;
    }).join('');

    let breadcrumbHtml = '';
    if (breadcrumb && breadcrumb.length > 0) {
      const parts = breadcrumb.map((crumb, idx) => {
        const isLast = idx === breadcrumb.length - 1;
        if (isLast || !crumb.href) {
          return `<span class="breadcrumb-current">${escapeHtml(crumb.label)}</span>`;
        }
        return `<a href="${crumb.href}">${escapeHtml(crumb.label)}</a>`;
      });
      breadcrumbHtml = `<div class="breadcrumb">${parts.join('<span class="breadcrumb-sep">&gt;</span>')}</div>`;
    }

    return `
      <nav class="main-nav">
        <div class="nav-items">${itemsHtml}</div>
        <div class="nav-actions">${actions || ''}</div>
      </nav>
      ${breadcrumbHtml}
    `;
  }

  function render(container, options) {
    if (!container) return;
    container.innerHTML = renderNav(options);
  }

  return { NAV_ITEMS, renderNav, render };
});
