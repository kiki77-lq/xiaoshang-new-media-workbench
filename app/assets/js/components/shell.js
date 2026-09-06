import { icon } from './icons.js';

const NAV_GROUPS = [
  { label: null, items: [{ name: "home", path: "/", label: "首页", icon: "house" }] },
  { label: "内容运营", items: [
    { name: "observations", path: "/observations", label: "热点 / 竞品观察", icon: "radar" },
    { name: "inspirations", path: "/inspirations", label: "灵感备忘", icon: "lightbulb" },
    { name: "contents", path: "/contents", label: "内容库", icon: "files" },
    { name: "calendar", path: "/calendar", label: "发布日历", icon: "calendar-days" }
  ] },
  { label: "数据洞察", items: [
    { name: "analytics", path: "/analytics", label: "数据看板", icon: "chart-no-axes-column" },
    { name: "reports", path: "/reports", label: "周报 / 月报", icon: "file-text" }
  ] },
  { label: "系统", items: [{ name: "settings", path: "/settings", label: "设置", icon: "settings" }] }
];

export function renderNavigation(activeName) {
  return NAV_GROUPS.map((group) => `${group.label ? `<p class="nav-group-label">${group.label}</p>` : ""}${group.items.map((item) => `
    <a href="${item.path}" data-route="${item.name}"${item.name === activeName ? ' aria-current="page"' : ""}>
      <span class="nav-icon" aria-hidden="true">${icon(item.icon)}</span><span>${item.label}</span>
    </a>`).join("")}`).join("");
}

export function renderShell(activeName) {
  return `<div class="app-shell">
    <aside class="sidebar" id="sidebar" aria-label="主导航">
      <div class="brand"><span class="brand-mark" aria-hidden="true">${icon('car-front')}</span><span><strong>小商的拍车日记</strong><small>新媒体运营工作台</small></span></div>
      <nav>${renderNavigation(activeName)}</nav>
      <div class="brand-slogan">内容为核心<br>平台为渠道</div>
    </aside>
    <div class="workspace">
      <div class="topbar">
        <button class="icon-button mobile-menu" id="menu-toggle" type="button" aria-label="打开导航" aria-expanded="false">${icon('menu')}</button>
        <label class="global-search"><span>${icon('search')}</span><input type="search" placeholder="搜索内容、灵感、数据…" disabled><small>即将开放</small></label>
        <button class="btn btn-primary quick-inspiration" type="button" data-quick-inspiration aria-label="快速新增灵感">${icon('plus')}<span class="button-label">快速新增灵感</span></button>
      </div>
      <main id="page-outlet" data-page="${activeName}" tabindex="-1"></main>
    </div>
    <div class="sidebar-scrim" id="sidebar-scrim"></div>
    <div id="modal-root"></div><div id="toast-root" aria-live="polite"></div>
  </div>`;
}
