import { emptyState, pageHeader, statCard } from "../shared/dom.js";

export function renderHome() {
  return `<section class="page page-home">
    ${pageHeader("首页", "四平台内容运营总览")}
    <div class="stats-grid stats-four">
      ${statCard("本月内容", "accent", "▤")}${statCard("制作中", "pending", "▷")}${statCard("今日待发布", "warning", "◷")}${statCard("需要处理", "danger", "!")}
    </div>
    <div class="home-grid">
      <section class="content-section platform-section"><div class="section-heading"><div><h2>四平台矩阵</h2><p>统一查看内容在各渠道的状态</p></div><span class="data-state">等待数据</span></div>
        <div class="platform-grid">
          ${["抖音","视频号","小红书","微博"].map((name, index) => `<article class="platform-card"><div><span class="platform-logo platform-${index}">${name.slice(0,1)}</span><strong>${name}</strong></div><span class="status-badge status-muted">未配置</span><p>最近发布</p><b>—</b><small>本月表现 —</small></article>`).join("")}
        </div>
        <div class="section-heading compact"><h2>最新内容分发</h2><span class="data-state">等待内容 API</span></div>
        ${emptyState("还没有内容分发记录", "PHASE 3 接入真实内容后，这里将呈现四平台分发状态。", "▱")}
      </section>
      <aside class="content-section radar-panel"><div class="section-heading"><div><h2>热点雷达摘要</h2><p>关注值得判断的汽车话题</p></div></div>${emptyState("雷达暂时安静", "当前阶段不联网搜索，也不会调用外部 AI。", "⌁")}</aside>
    </div>
  </section>`;
}
