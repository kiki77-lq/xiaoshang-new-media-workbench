import { disabledButton, emptyState, pageHeader, statCard } from "../shared/dom.js";

export function renderInspirations() {
  return `<section class="page page-inspirations">
    ${pageHeader("灵感备忘", "随手记录，后续由 AI 辅助整理", disabledButton("＋ 新增灵感", "btn-primary"))}
    <div class="stats-grid stats-three">${statCard("本周新增", "accent", "✎")}${statCard("待整理", "pending", "⌛")}${statCard("已转内容", "success", "✓")}</div>
    <section class="content-section filter-panel"><label class="search-control"><span>⌕</span><input type="search" placeholder="搜索灵感、标签、来源…" disabled></label><div class="chips"><button class="chip active">全部</button><button class="chip">置顶</button><button class="chip">待整理</button><button class="chip">已转内容</button></div></section>
    <section class="content-section inspiration-list"><div class="empty-card-preview"><span class="pin">★ 置顶位置</span><div class="idea-icon">▤</div><div><strong>灵感卡片将显示在这里</strong><p>保留老板原话、来源、标签和整理状态。</p></div>${disabledButton("转为内容")}</div>${emptyState("还没有灵感记录", "本阶段只完成容器与空态，不会向 SQLite 写入演示数据。", "✦")}</section>
  </section>`;
}
