import { icon as renderIcon } from '../components/icons.js';
export { icon } from '../components/icons.js';

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}

export function pageHeader(title, subtitle, actions = "") {
  return `<header class="page-header"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="page-actions">${actions}</div></header>`;
}

export function statCard(label, tone = "accent", icon = "◇", note = "等待业务数据", value = "—", metric = "", valueStyle = "number") {
  const metricAttribute = metric ? ` data-metric="${escapeHtml(metric)}"` : "";
  return `<article class="stat-card"${metricAttribute}><span class="stat-icon tone-${tone}">${renderIcon(icon)}</span><div><span class="stat-label">${escapeHtml(label)}</span><strong${valueStyle === "text" ? ' class="stat-text-value"' : ""}>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div></article>`;
}

export function emptyState(title, description, icon = "◇") {
  return `<div class="empty-state"><span class="empty-icon">${renderIcon(icon)}</span><strong>${title}</strong><p>${description}</p></div>`;
}

export function disabledButton(label, className = "btn-secondary") {
  return `<button class="btn ${className}" type="button" disabled title="将在后续阶段开放">${label}<span class="future-tag">后续开放</span></button>`;
}
