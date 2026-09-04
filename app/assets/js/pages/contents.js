import { disabledButton, emptyState, pageHeader, statCard } from "../shared/dom.js";

export function renderContents() {
  const platforms = ["抖音", "视频号", "小红书", "微博"];
  return `<section class="page page-contents">
    ${pageHeader("内容库", "从制作到四平台发布统一管理", disabledButton("＋ 新增内容", "btn-primary"))}
    <section class="content-section content-toolbar"><div class="chips"><button class="chip active">全部</button><button class="chip">准备中</button><button class="chip">制作中</button><button class="chip">待发布</button><button class="chip">已发布</button></div><div class="chips"><button class="chip active">全部类型</button><button class="chip">纯享</button><button class="chip">商单</button></div></section>
    <div class="stats-grid stats-four">${statCard("准备中", "accent", "▤")}${statCard("制作中", "pending", "▷")}${statCard("待发布", "warning", "◷")}${statCard("本月已发布", "success", "✓")}</div>
    <section class="content-section content-table"><div class="table-head"><span>内容信息</span><span>类型</span><span>整体状态</span><span>灵感来源</span><span>平台发布状态</span></div><div class="content-empty-row"><div>${emptyState("内容库目前为空", "PHASE 3 才会接入 Content CRUD；当前不生成任何业务数据。", "▣")}</div><div class="platform-statuses">${platforms.map((name) => `<span><b>${name}</b><small>未开始</small></span>`).join("")}</div></div></section>
  </section>`;
}
