import { disabledButton, emptyState, pageHeader, statCard } from "../shared/dom.js";

export function renderObservations() {
  return `<section class="page page-observations">
    ${pageHeader("热点 / 竞品观察", "筛选值得关注的汽车内容机会", disabledButton("↻ 刷新热点", "btn-primary"))}
    <div class="stats-grid stats-four">${statCard("今日新热点", "danger", "♨")}${statCard("高热趋势", "warning", "↗")}${statCard("待老板判断", "pending", "♙")}${statCard("本周转入灵感", "success", "◉")}</div>
    <div class="observations-grid"><section class="content-section"><div class="section-heading"><div><h2>热点雷达</h2><p>汽车行业与用户讨论</p></div></div><article class="observation-preview"><span class="rank tone-danger">1</span><div><h3>热点条目将显示在这里</h3><div class="chips"><span class="chip">话题</span><span class="chip">来源</span></div><p>当前阶段不联网抓取，也不会写入模拟热点。</p><div class="inline-actions">${disabledButton("收入灵感", "btn-primary")}${disabledButton("查看来源")}${disabledButton("忽略")}</div></div></article>${emptyState("暂无热点", "待后续接入受控的数据来源。", "⌁")}</section><section class="content-section"><div class="section-heading"><div><h2>竞品观察</h2><p>关注账号与内容动作</p></div></div>${emptyState("暂无竞品记录", "本阶段不接平台 API，也不执行爬虫。", "◎")}</section></div>
  </section>`;
}
