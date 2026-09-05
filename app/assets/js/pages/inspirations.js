import { closeModal, openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { emptyState, escapeHtml, pageHeader, statCard } from "../shared/dom.js";
import { serializeForm } from "../shared/forms.js";
import { displayShanghai } from "../shared/format.js";

const SOURCE_LABELS = {manual:'手动记录',workbuddy:'WorkBuddy',wechat:'微信原文',hotspot:'热点来源',other:'其他来源'};

const STATUS_LABELS = {
  inbox: "待整理",
  organized: "已整理",
  converted: "已转内容",
  archived: "已归档"
};

function tagsFromInput(value) {
  return String(value || "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}

function presentError(error) {
  if (error?.code === "VERSION_CONFLICT") {
    showToast("这条灵感已经被更新，请刷新后再修改。", "danger");
    return;
  }
  const request = error?.requestId ? `（请求 ${error.requestId}）` : "";
  showToast(`${error?.message || "操作失败，请稍后再试。"}${request}`, "danger");
}

function field(label, name, value = "", { type = "text", placeholder = "", required = false } = {}) {
  return `<label class="form-field"><span>${label}${required ? " *" : ""}</span><input type="${type}" name="${name}" value="${escapeHtml(value ?? "")}" placeholder="${escapeHtml(placeholder)}"${required ? " required" : ""}></label>`;
}

function inspirationForm(inspiration = null) {
  const editing = Boolean(inspiration);
  return `<form class="workbench-form" data-inspiration-form data-inspiration-id="${escapeHtml(inspiration?.id || "")}" data-version="${escapeHtml(inspiration?.version || "")}">
    <label class="form-field form-field-wide"><span>老板原始表达 *</span><textarea name="rawText" rows="5" placeholder="完整保留老板当时怎么说的…" required${editing ? " disabled" : ""}>${escapeHtml(inspiration?.rawText || "")}</textarea>${editing ? '<small class="immutable-note">创建后永久不可修改，数据库与 API 已双重保护。</small>' : ""}</label>
    ${field("整理标题", "summaryTitle", inspiration?.summaryTitle, { placeholder: "未填写时仅使用原话截取，不代表 AI 已整理" })}
    ${field("品牌", "brand", inspiration?.brand, { placeholder: "例如：凯迪拉克" })}
    ${field("车型", "vehicleModel", inspiration?.vehicleModel, { placeholder: "例如：XT5" })}
    ${field("标签", "tags", inspiration?.tags?.join(", "), { placeholder: "多个标签用逗号分隔" })}
    ${field("来源", "sourcePlatform", inspiration?.sourcePlatform, { placeholder: "例如：线下沟通" })}
    ${field("参考链接", "sourceUrl", inspiration?.sourceUrl, { type: "url", placeholder: "https://…" })}
    ${editing ? `<label class="form-field"><span>整理状态</span><select name="status">${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}"${inspiration.status === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>` : ""}
    <label class="check-field"><input type="checkbox" name="pinned"${inspiration?.pinned ? " checked" : ""}><span>置顶这条灵感</span></label>
    <footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">${editing ? "保存修改" : "保存灵感"}</button></footer>
  </form>`;
}

function valuesForWrite(form, { editing = false } = {}) {
  const values = serializeForm(form);
  const output = {
    summaryTitle: values.summaryTitle,
    brand: values.brand,
    vehicleModel: values.vehicleModel,
    tags: tagsFromInput(values.tags),
    sourcePlatform: values.sourcePlatform,
    sourceUrl: values.sourceUrl,
    pinned: values.pinned === "on"
  };
  if (!editing) output.rawText = values.rawText;
  if (editing) output.status = values.status;
  return output;
}

export function openCreateInspiration({ api, reload }) {
  openModal({ title: "新增灵感", content: inspirationForm() });
  const form = document.querySelector("[data-inspiration-form]");
  const idempotencyKey = crypto.randomUUID();
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api.post("/inspirations", valuesForWrite(form), { idempotencyKey });
      closeModal();
      showToast("灵感已保存到本地数据库。", "success");
      await reload();
    } catch (error) {
      submit.disabled = false;
      presentError(error);
    }
  });
}

function openEditInspiration(inspiration, { api, reload }) {
  openModal({ title: "编辑灵感", content: inspirationForm(inspiration) });
  const form = document.querySelector("[data-inspiration-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api.patch(`/inspirations/${inspiration.id}`, valuesForWrite(form, { editing: true }), { version: inspiration.version });
      closeModal();
      showToast("灵感结构化信息已更新。", "success");
      await reload();
    } catch (error) {
      submit.disabled = false;
      presentError(error);
    }
  });
}

function openConvertInspiration(inspiration, { api, reload }) {
  const suggestedTitle = [inspiration.brand, inspiration.vehicleModel].filter(Boolean).join(" ") || inspiration.summaryTitle;
  openModal({
    title: "转为内容",
    content: `<form class="workbench-form" data-convert-form>
      <div class="conversion-source"><small>来源灵感</small><strong>${escapeHtml(inspiration.summaryTitle)}</strong><p>${escapeHtml(inspiration.rawText)}</p></div>
      ${field("内容标题", "title", suggestedTitle, { required: true })}
      <label class="form-field"><span>内容类型 *</span><select name="contentType" required><option value="organic">纯享</option><option value="commercial">商单</option></select></label>
      <footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">确认转为内容</button></footer>
    </form>`
  });
  const form = document.querySelector("[data-convert-form]");
  const idempotencyKey = crypto.randomUUID();
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = serializeForm(form);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api.post(`/inspirations/${inspiration.id}/convert`, {
        title: values.title,
        contentType: values.contentType
      }, { version: inspiration.version, idempotencyKey });
      closeModal();
      showToast(result.data.alreadyConverted ? "这条灵感已关联原有内容。" : "已转为内容，并创建四个平台发布记录。", "success");
      await reload();
    } catch (error) {
      submit.disabled = false;
      presentError(error);
    }
  });
}

function renderCard(inspiration) {
  const title = escapeHtml(inspiration.summaryTitle);
  const status = STATUS_LABELS[inspiration.status] || inspiration.status;
  return `<article class="inspiration-card${inspiration.pinned ? " is-pinned" : ""}" data-inspiration-id="${escapeHtml(inspiration.id)}">
    <div class="inspiration-card-top">
      <div class="inspiration-title"><span class="idea-icon">▤</span><div><div class="badge-row">${inspiration.pinned ? '<span class="status-badge badge-warning">★ 置顶</span>' : ""}<span class="status-badge status-${escapeHtml(inspiration.status)}">${escapeHtml(status)}</span>${inspiration.isFallbackTitle ? '<span class="status-badge status-muted">原话截取 · 未经 AI 整理</span>' : ""}</div><h3>${title}</h3></div></div>
      <div class="card-actions"><button class="btn btn-secondary" type="button" data-edit-inspiration="${escapeHtml(inspiration.id)}" aria-label="编辑灵感 ${title}">编辑</button>${inspiration.convertedContentId ? `<a class="btn btn-secondary" href="/contents?focus=${encodeURIComponent(inspiration.convertedContentId)}" data-route="contents">查看关联内容</a>` : `<button class="btn btn-primary" type="button" data-convert-inspiration="${escapeHtml(inspiration.id)}" aria-label="转为内容 ${title}">转为内容</button>`}</div>
    </div>
    <blockquote><span>老板原话</span>${escapeHtml(inspiration.rawText)}</blockquote>
    <div class="inspiration-meta"><span>${escapeHtml([inspiration.brand, inspiration.vehicleModel].filter(Boolean).join(" · ") || "未标注车型")}</span><span>${escapeHtml([SOURCE_LABELS[inspiration.sourceType] || '手动记录',inspiration.sourcePlatform].filter(Boolean).join(' · '))}</span><span>${escapeHtml(displayShanghai(inspiration.createdAt))}</span></div>
    ${inspiration.tags?.length ? `<div class="tag-list">${inspiration.tags.map((tag) => `<span># ${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
  </article>`;
}

export function renderInspirations({ data, loading = false, error = null, filters = {} } = {}) {
  const items = data?.items || [];
  const now = Date.now();
  const weekCount = items.filter((item) => now - new Date(item.createdAt).getTime() <= 7 * 86400000).length;
  const pendingCount = items.filter((item) => item.status === "inbox").length;
  const convertedCount = items.filter((item) => item.status === "converted").length;
  const filter = filters.filter || "all";
  const chips = [["all", "全部"], ["pinned", "置顶"], ["inbox", "待整理"], ["converted", "已转内容"]];
  let list = items.map(renderCard).join("");
  if (loading) list = '<div class="loading-state">正在读取本地灵感…</div>';
  if (error) list = emptyState("灵感读取失败", error.message || "请确认本地服务正在运行。", "!");
  if (!loading && !error && !items.length) list = emptyState("还没有灵感记录", "点击“新增灵感”，老板原话会安全保存在本地 SQLite。", "✦");

  return `<section class="page page-inspirations">
    ${pageHeader("灵感备忘", "保留老板原话，再逐步整理为可执行内容", '<button class="btn btn-primary" type="button" data-new-inspiration>＋ 新增灵感</button>')}
    <div class="stats-grid stats-three">${statCard("近 7 天新增", "accent", "✎", "当前筛选结果", weekCount)}${statCard("待整理", "pending", "⌛", "仍是原话截取标题", pendingCount)}${statCard("已转内容", "success", "✓", "保留原灵感记录", convertedCount)}</div>
    <section class="content-section filter-panel"><label class="search-control"><span>⌕</span><input type="search" data-inspiration-search placeholder="搜索灵感、标签、来源…" value="${escapeHtml(filters.search || "")}"></label><div class="chips">${chips.map(([value, label]) => `<button class="chip${filter === value ? " active" : ""}" type="button" data-inspiration-filter="${value}">${label}</button>`).join("")}</div></section>
    <section class="content-section inspiration-list">${list}</section>
  </section>`;
}

export function attachInspirations(root, { api, data, filters, reload, setFilters }) {
  const items = data?.items || [];
  root.querySelector("[data-new-inspiration]")?.addEventListener("click", () => openCreateInspiration({ api, reload }));
  root.querySelectorAll("[data-edit-inspiration]").forEach((button) => button.addEventListener("click", () => {
    const inspiration = items.find(({ id }) => id === button.dataset.editInspiration);
    if (inspiration) openEditInspiration(inspiration, { api, reload });
  }));
  root.querySelectorAll("[data-convert-inspiration]").forEach((button) => button.addEventListener("click", () => {
    const inspiration = items.find(({ id }) => id === button.dataset.convertInspiration);
    if (inspiration) openConvertInspiration(inspiration, { api, reload });
  }));
  root.querySelectorAll("[data-inspiration-filter]").forEach((button) => button.addEventListener("click", () => setFilters({ ...filters, filter: button.dataset.inspirationFilter })));
  const search = root.querySelector("[data-inspiration-search]");
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const value = search.value.trim();
      queueMicrotask(() => setFilters({ ...filters, search: value }));
    }
  });
}
