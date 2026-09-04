import { disabledButton, emptyState, pageHeader, statCard } from "../shared/dom.js";

function reportCard(title, description) {
  return `<article class="report-card"><div class="section-heading"><h2>${title}</h2><span class="data-state">等待生成</span></div>${emptyState("暂无周期数据", description, "▤")}</article>`;
}

export function renderReports() {
  return `<section class="page page-reports">
    ${pageHeader("周报 / 月报", "自动汇总周期内容运营结果", `${disabledButton("复制报告")}${disabledButton("导出 Markdown", "btn-primary")}`)}
    <div class="view-switch"><button class="chip active">本周</button><button class="chip">本月</button></div>
    <div class="stats-grid stats-four">${statCard("新增灵感", "accent", "◉")}${statCard("新增内容", "pending", "▤")}${statCard("已发布", "success", "➤")}${statCard("总播放 / 阅读", "warning", "◉")}</div>
    <div class="report-grid">${reportCard("周期摘要", "报告生成将在 PHASE 6 接入。")}${reportCard("TOP 内容", "等待作品表现数据。")}${reportCard("四平台表现", "等待各平台指标。")}${reportCard("AI 周期结论", "当前不会调用外部 AI。")}${reportCard("热点 / 灵感沉淀", "等待本周期真实记录。")}${reportCard("下一周期建议", "等待完整数据后生成建议。")}</div>
  </section>`;
}
