import { platformMark } from '../components/platform-mark.js';
import { emptyState, escapeHtml, pageHeader, statCard, icon } from "../shared/dom.js";

const CONTENT_STATUS = { preparing: "准备中", producing: "制作中", ready: "待发布", published: "已发布" };
const PUBLICATION_STATUS = { not_started: "未开始", preparing: "准备中", producing: "制作中", ready: "待发布", scheduled: "已排期", published: "已发布" };

function renderPlatform(platform, index, recentContents) {
  const publications = recentContents.flatMap((content) => content.publications || []).filter((publication) => publication.platformCode === platform.code);
  const completed = publications.filter((publication) => publication.status === "published").length;
  return `<article class="platform-card"><div><span class="platform-logo platform-${index}">${platformMark(platform.displayName)}</span><strong>${escapeHtml(platform.displayName)}</strong></div><span class="status-badge ${platform.enabled ? "badge-success" : "status-muted"}">${platform.enabled ? "已启用" : "未启用"}</span><p>最近内容状态</p><b>${publications.length ? escapeHtml(PUBLICATION_STATUS[publications[0].status] || publications[0].status) : "—"}</b><small>最近 ${publications.length} 条 · 已发布 ${completed}</small></article>`;
}

function renderRecent(content) {
  return `<article class="recent-content" data-recent-content="${escapeHtml(content.id)}"><div><span class="content-symbol">${icon('files')}</span><div><strong>${escapeHtml(content.title)}</strong><small>${escapeHtml(CONTENT_STATUS[content.status] || content.status)}</small></div></div><div class="recent-publications">${(content.publications || []).map((publication) => `<span title="${escapeHtml(publication.platformName)}">${platformMark(publication.platformName)}<small>${escapeHtml(PUBLICATION_STATUS[publication.status] || publication.status)}</small></span>`).join("")}</div></article>`;
}

function renderHotspotItem(item) {
  const tags = (item.tags || []).slice(0, 3);
  const reason = (item.worthReason || '').replace(/\s+/g, ' ').trim();
  return `<article class="home-radar-item"><div class="home-radar-head"><span class="home-radar-score" title="拍摄机会分（0–100 人工评分）">${item.heatScore ?? '—'}</span><a class="home-radar-title" href="/observations" data-route title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || '')}</a></div>${tags.length ? `<div class="tag-list home-radar-tags">${tags.map((tag) => `<span># ${escapeHtml(tag)}</span>`).join("")}</div>` : ''}${reason ? `<p class="home-radar-reason">${escapeHtml(reason)}</p>` : ''}</article>`;
}

function renderCompetitorItem(item) {
  const tags = (item.tags || []).slice(0, 3);
  const meta = [item.competitorName, item.sourcePlatform].filter(Boolean).map(escapeHtml).join(' · ');
  const signal = (item.summary || item.worthReason || '').replace(/\s+/g, ' ').trim();
  return `<article class="home-radar-item home-competitor-item"><div class="home-radar-head">${meta ? `<span class="home-competitor-meta">${meta}</span>` : ''}<a class="home-radar-title" href="/observations" data-route title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || '')}</a></div>${tags.length ? `<div class="tag-list home-radar-tags">${tags.map((tag) => `<span># ${escapeHtml(tag)}</span>`).join("")}</div>` : ''}${signal ? `<p class="home-radar-reason">${escapeHtml(signal)}</p>` : ''}</article>`;
}

export function renderHome({ data, loading = false, error = null } = {}) {
  const dashboard = data || {};
  const recentContents = dashboard.recentContents || [];
  const platforms = dashboard.platforms || [];
  const knownValues = !loading && !error;
  const metric = (value) => knownValues ? String(value ?? 0) : "—";
  let recent = recentContents.map(renderRecent).join("");
  if (loading) recent = '<div class="loading-state">正在聚合本地数据…</div>';
  if (error) recent = emptyState("首页数据读取失败", escapeHtml(error.message || "请确认本地服务正在运行。"), "!");
  if (knownValues && !recentContents.length) recent = emptyState("还没有内容分发记录", "从灵感转为内容或直接新建内容后，这里会实时更新。", "▱");
  const radar = dashboard.hotspotSummary || [];
  const competitors = dashboard.competitorSummary || [];
  const readError = (label) => `<div role="alert">${emptyState(label + "读取失败", `请刷新页面重试。${error?.requestId ? ' Request ID：' + escapeHtml(error.requestId) : ''}`, "!")}</div>`;
  const radarList = error ? readError("拍摄机会")
    : loading ? '<div class="loading-state">正在读取机会…</div>'
    : radar.length ? radar.map(renderHotspotItem).join("")
    : emptyState("暂无值得关注的拍摄机会", "可在热点 / 竞品观察中记录候选车型或事件。", "◎");
  const competitorList = error ? readError("竞品观察")
    : loading ? '<div class="loading-state">正在读取竞品讯号…</div>'
    : competitors.length ? competitors.map(renderCompetitorItem).join("")
    : emptyState("暂无值得关注的竞品变化", "有可靠讯号时会显示在这里，不为凑数展示。", "◎");

  return `<section class="page page-home">
    ${pageHeader("首页", "四平台内容运营总览 · 数据来自本地 SQLite")}
    <div class="stats-grid stats-four">
      ${statCard("本月内容", "accent", "▤", "按上海时间自然月统计", metric(dashboard.monthContentCount), "month-content-count")}${statCard("制作中", "pending", "▷", "整体状态为制作中", metric(dashboard.producingCount), "producing-count")}${statCard("今日待发布", "warning", "◷", "上海今日 · 尚未完成的发布排期", metric(dashboard.todayPublishCount), "today-publish-count")}${statCard("需要处理", "danger", "!", "尚未完成的待确认安排", metric(dashboard.needsAttentionCount), "needs-attention-count")}
    </div>
    <div class="home-grid">
      <section class="content-section platform-section"><div class="section-heading"><div><h2>四平台矩阵</h2><p>统一查看内容在各渠道的当前状态</p></div><span class="data-state">SQLite 实时数据</span></div>
        <div class="platform-grid">${platforms.length ? platforms.map((platform, index) => renderPlatform(platform, index, recentContents)).join("") : ["抖音", "视频号", "小红书", "微博"].map((name, index) => renderPlatform({ code: String(index), displayName: name, enabled: false }, index, [])).join("")}</div>
        <div class="section-heading compact"><h2>最新内容分发</h2><span class="data-state">${recentContents.length} 条内容</span></div>
        <div class="recent-content-list">${recent}</div>
      </section>
      <aside class="content-section radar-panel home-summary-rail">
        <div class="section-heading"><div><h2>拍摄机会雷达</h2><p>当前最值得拍的 Top 3</p></div></div>
        <div class="home-radar-list">${radarList}</div>
        <a class="home-summary-link" href="/observations" data-route>查看机会 →</a>
        <div class="section-heading home-competitor-heading"><div><h2>竞品观察</h2><p>最近值得注意的 Top 3 变化讯号</p></div></div>
        <div class="home-radar-list">${competitorList}</div>
        <a class="home-summary-link" href="/observations" data-route>查看竞品 →</a>
      </aside>
    </div>
  </section>`;
}
