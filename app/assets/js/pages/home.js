import { emptyState, escapeHtml, pageHeader, statCard } from "../shared/dom.js";

const CONTENT_STATUS = { preparing: "准备中", producing: "制作中", ready: "待发布", published: "已发布" };
const PUBLICATION_STATUS = { not_started: "未开始", preparing: "准备中", producing: "制作中", ready: "待发布", scheduled: "已排期", published: "已发布" };

function renderPlatform(platform, index, recentContents) {
  const publications = recentContents.flatMap((content) => content.publications || []).filter((publication) => publication.platformCode === platform.code);
  const completed = publications.filter((publication) => publication.status === "published").length;
  return `<article class="platform-card"><div><span class="platform-logo platform-${index}">${escapeHtml(platform.displayName.slice(0, 1))}</span><strong>${escapeHtml(platform.displayName)}</strong></div><span class="status-badge ${platform.enabled ? "badge-success" : "status-muted"}">${platform.enabled ? "已启用" : "未启用"}</span><p>最近内容状态</p><b>${publications.length ? escapeHtml(PUBLICATION_STATUS[publications[0].status] || publications[0].status) : "—"}</b><small>最近 ${publications.length} 条 · 已发布 ${completed}</small></article>`;
}

function renderRecent(content) {
  return `<article class="recent-content" data-recent-content="${escapeHtml(content.id)}"><div><span class="content-symbol">▣</span><div><strong>${escapeHtml(content.title)}</strong><small>${escapeHtml(CONTENT_STATUS[content.status] || content.status)}</small></div></div><div class="recent-publications">${(content.publications || []).map((publication) => `<span title="${escapeHtml(publication.platformName)}">${escapeHtml(publication.platformName.slice(0, 1))}<small>${escapeHtml(PUBLICATION_STATUS[publication.status] || publication.status)}</small></span>`).join("")}</div></article>`;
}

export function renderHome({ data, loading = false, error = null } = {}) {
  const dashboard = data || {};
  const recentContents = dashboard.recentContents || [];
  const platforms = dashboard.platforms || [];
  const knownValues = !loading && !error;
  const metric = (value) => knownValues ? String(value ?? 0) : "—";
  let recent = recentContents.map(renderRecent).join("");
  if (loading) recent = '<div class="loading-state">正在聚合本地数据…</div>';
  if (error) recent = emptyState("首页数据读取失败", error.message || "请确认本地服务正在运行。", "!");
  if (knownValues && !recentContents.length) recent = emptyState("还没有内容分发记录", "从灵感转为内容或直接新建内容后，这里会实时更新。", "▱");
  const radar = dashboard.hotspotSummary || [];

  return `<section class="page page-home">
    ${pageHeader("首页", "四平台内容运营总览 · 数据来自本地 SQLite")}
    <div class="stats-grid stats-four">
      ${statCard("本月内容", "accent", "▤", "按当前自然月统计", metric(dashboard.monthContentCount), "month-content-count")}${statCard("制作中", "pending", "▷", "整体状态为制作中", metric(dashboard.producingCount), "producing-count")}${statCard("今日待发布", "warning", "◷", "发布日历将在 PHASE 4 接入", metric(dashboard.todayPublishCount), "today-publish-count")}${statCard("需要处理", "danger", "!", "暂无对应数据来源", metric(dashboard.needsAttentionCount), "needs-attention-count")}
    </div>
    <div class="home-grid">
      <section class="content-section platform-section"><div class="section-heading"><div><h2>四平台矩阵</h2><p>统一查看内容在各渠道的当前状态</p></div><span class="data-state">SQLite 实时数据</span></div>
        <div class="platform-grid">${platforms.length ? platforms.map((platform, index) => renderPlatform(platform, index, recentContents)).join("") : ["抖音", "视频号", "小红书", "微博"].map((name, index) => renderPlatform({ code: String(index), displayName: name, enabled: false }, index, [])).join("")}</div>
        <div class="section-heading compact"><h2>最新内容分发</h2><span class="data-state">${recentContents.length} 条内容</span></div>
        <div class="recent-content-list">${recent}</div>
      </section>
      <aside class="content-section radar-panel"><div class="section-heading"><div><h2>热点雷达摘要</h2><p>关注值得判断的汽车话题</p></div></div>${radar.length ? radar.map((item) => `<article>${escapeHtml(item.title || "")}</article>`).join("") : emptyState("雷达暂时安静", "热点模块尚未进入实施阶段，当前真实结果为空。", "⌁")}</aside>
    </div>
  </section>`;
}
