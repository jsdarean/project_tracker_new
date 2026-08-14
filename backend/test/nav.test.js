const test = require('node:test');
const assert = require('node:assert');
const Nav = require('../public/nav');

test('NAV_ITEMS 包含 6 个导航项', () => {
  assert.strictEqual(Nav.NAV_ITEMS.length, 6);
  const keys = Nav.NAV_ITEMS.map(i => i.key);
  assert.deepStrictEqual(keys, ['index', 'issues', 'escalation', 'contacts', 'company_contacts', 'settings']);
});

test('renderNav 生成包含当前页高亮的导航栏', () => {
  const html = Nav.renderNav({
    current: 'issues',
    breadcrumb: [{ label: '首页', href: 'index.html' }, { label: '问题跟踪' }],
    actions: '<button>新建问题</button>',
  });
  assert.ok(html.includes('项目查询'));
  assert.ok(html.includes('问题跟踪'));
  assert.ok(html.includes('催办管理'));
  assert.ok(html.includes('联系人'));
  assert.ok(html.includes('公司通讯录'));
  assert.ok(html.includes('设置'));
  assert.ok(html.includes('nav-item-current'));
  assert.ok(html.includes('新建问题'));
});

test('renderNav 面包屑可点击', () => {
  const html = Nav.renderNav({
    current: 'detail',
    breadcrumb: [{ label: '首页', href: 'index.html' }, { label: '项目详情' }],
    actions: '',
  });
  assert.ok(html.includes('<a href="index.html">首页</a>'));
  assert.ok(html.includes('<span class="breadcrumb-current">项目详情</span>'));
});

test('renderNav 面包屑单级时无分隔符', () => {
  const html = Nav.renderNav({
    current: 'index',
    breadcrumb: [{ label: '首页' }],
    actions: '',
  });
  assert.ok(!html.includes('&gt;'));
  assert.ok(html.includes('首页'));
});

test('render 将导航渲染到容器', () => {
  const container = { innerHTML: '' };
  Nav.render(container, {
    current: 'settings',
    breadcrumb: [{ label: '首页', href: 'index.html' }, { label: '设置' }],
    actions: '',
  });
  assert.ok(container.innerHTML.includes('设置'));
  assert.ok(container.innerHTML.includes('nav-item-current'));
});
