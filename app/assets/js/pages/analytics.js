import { renderChart } from "../components/chart.js";
import { emptyState, pageHeader, statCard } from "../shared/dom.js";

export function renderAnalytics() {
  return `<section class="page page-analytics">
    ${pageHeader("数据看板", "四平台表现与单条作品复盘")}
    <div class="view-switch" role="tablist"><button class="chip active" data-analytics-tab="overview">数据总览</button><button class="chip" data-analytics-tab="review">单条作品复盘</button></div>
    <div data-analytics-panel="overview"><div class="stats-grid stats-four">${statCard("总播放 / 阅读", "accent", "▷")}${statCard("本月内容数", "pending", "▤")}${statCard("本月最佳内容", "warning", "☆")}${statCard("本月涨粉", "success", "♙")}</div>
      <div class="analytics-grid"><section class="content-section trend-panel"><div class="section-heading"><div><h2>数据趋势</h2><p>等待正式指标导入</p></div><span class="data-state">更新时间 —</span></div>${renderChart()}</section><section class="content-section ranking-panel"><div class="section-heading"><h2>内容排行</h2></div>${emptyState("暂无排行", "接入真实作品指标后自动形成排行。", "☷")}</section></div>
      <section class="content-section"><div class="section-heading"><div><h2>四平台表现</h2><p>只展示结构，不伪造平台数据</p></div></div><div class="platform-grid">${["抖音","视频号","小红书","微博"].map((name) => `<article class="platform-card"><div><span class="platform-logo">${name[0]}</span><strong>${name}</strong></div><span class="status-badge status-muted">未接入</span><p>播放 / 阅读</p><b>—</b><small>互动率 — · 涨粉 —</small></article>`).join("")}</div></section>
    </div>
    <div data-analytics-panel="review" hidden><section class="content-section review-shell"><div class="section-heading"><div><h2>单条作品复盘</h2><p>选择作品后查看完整诊断</p></div></div><div class="review-grid">${["核心指标","流量生命周期","留存曲线","互动结构","流量来源","TOP 高互动段落","AI 做得好的判断","AI 问题诊断","下一条优化建议"].map((title) => `<article class="review-card"><h3>${title}</h3><p>等待真实作品数据</p><strong>—</strong></article>`).join("")}</div></section></div>
  </section>`;
}

export function attachAnalytics(root) {
  root.querySelectorAll("[data-analytics-tab]").forEach((button) => button.addEventListener("click", () => {
    root.querySelectorAll("[data-analytics-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
    root.querySelectorAll("[data-analytics-panel]").forEach((panel) => { panel.hidden = panel.dataset.analyticsPanel !== button.dataset.analyticsTab; });
  }));
}
