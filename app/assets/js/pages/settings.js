import { disabledButton, pageHeader } from "../shared/dom.js";
import { shortSha } from "../shared/format.js";

function statusValue(value) {
  return value === undefined || value === null ? "—" : value;
}

export function renderSettings({ health, meta, apiError } = {}) {
  const connected = health?.status === "ok" && health?.database === "ok";
  return `<section class="page page-settings">
    ${pageHeader("设置", "连接、备份与基础配置")}
    <div class="settings-grid">
      <section class="setting-card"><div class="setting-title"><span>↗</span><div><h2>WorkBuddy 连接状态</h2><p>本机服务与数据层</p></div></div><div class="connection-status ${connected ? "is-online" : ""}"><i></i><strong>${apiError ? "连接异常" : connected ? "本地服务正常" : "正在检测…"}</strong></div><dl><div><dt>数据库</dt><dd>${statusValue(health?.database)}</dd></div><div><dt>Request ID</dt><dd>${statusValue(health?.requestId)}</dd></div></dl>${disabledButton("重新连接")}</section>
      <section class="setting-card"><div class="setting-title"><span>◫</span><div><h2>数据备份与恢复</h2><p>真实数据始终保留在老板电脑</p></div></div><p class="setting-copy">入口将在后续阶段接入安全备份流程，当前不可操作。</p><div class="setting-actions">${disabledButton("立即备份", "btn-primary")}${disabledButton("恢复数据")}</div></section>
      <section class="setting-card"><div class="setting-title"><span>▦</span><div><h2>四平台配置</h2><p>平台连接在后续阶段处理</p></div></div><div class="config-list">${["抖音","视频号","小红书","微博"].map((name) => `<div><span>${name}</span><span class="status-badge status-muted">未配置</span><input type="checkbox" disabled aria-label="${name} 配置开关"></div>`).join("")}</div></section>
      <section class="setting-card"><div class="setting-title"><span>♨</span><div><h2>热点关注关键词</h2><p>关键词编辑暂未开放</p></div></div><div class="keyword-list"><span>凯迪拉克</span><span>尊界</span><span>沃尔沃</span><span>豪华车</span><button disabled>＋ 添加关键词</button></div></section>
      <section class="setting-card setting-version"><div class="setting-title"><span>↻</span><div><h2>版本与更新</h2><p>来自 /api/v1/meta 的真实运行信息</p></div></div><dl class="version-grid"><div><dt>应用版本</dt><dd>${statusValue(meta?.appVersion)}</dd></div><div><dt>Git SHA</dt><dd title="${statusValue(meta?.gitSha)}">${shortSha(meta?.gitSha)}</dd></div><div><dt>Schema Version</dt><dd>${statusValue(meta?.schemaVersion)}</dd></div><div><dt>Upstream SHA</dt><dd title="${statusValue(meta?.upstreamSha)}">${shortSha(meta?.upstreamSha)}</dd></div></dl>${disabledButton("检查更新")}</section>
    </div>
  </section>`;
}
