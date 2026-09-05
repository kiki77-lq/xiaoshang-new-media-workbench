import { closeModal, openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { emptyState, escapeHtml, pageHeader, statCard } from "../shared/dom.js";
import { serializeForm } from "../shared/forms.js";

const TYPE_LABELS = { organic: "纯享", commercial: "商单" };
const STATUS_LABELS = { preparing: "准备中", producing: "制作中", ready: "待发布", published: "已发布" };
const PUBLICATION_LABELS = { not_started: "未开始", preparing: "准备中", producing: "制作中", ready: "待发布", scheduled: "已排期", published: "已发布" };

function tagsFromInput(value) {
  return String(value || "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}

function presentError(error) {
  if (error?.code === "VERSION_CONFLICT") {
    showToast("这条内容已经被更新，请刷新后再修改。", "danger");
    return;
  }
  const request = error?.requestId ? `（请求 ${error.requestId}）` : "";
  showToast(`${error?.message || "操作失败，请稍后再试。"}${request}`, "danger");
}

function input(label, name, value = "", { required = false, placeholder = "" } = {}) {
  return `<label class="form-field"><span>${label}${required ? " *" : ""}</span><input name="${name}" value="${escapeHtml(value ?? "")}" placeholder="${escapeHtml(placeholder)}"${required ? " required" : ""}></label>`;
}

function contentForm(content = null) {
  const editing = Boolean(content);
  return `<form class="workbench-form" data-content-form data-content-id="${escapeHtml(content?.id || "")}" data-version="${escapeHtml(content?.version || "")}">
    ${input("内容标题", "title", content?.title, { required: true, placeholder: "这条内容讲什么" })}
    <label class="form-field"><span>内容类型 *</span><select name="contentType" required>${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}"${content?.contentType === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>
    <label class="form-field"><span>整体状态</span><select name="status">${Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}"${content?.status === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>
    ${input("品牌", "brand", content?.brand, { placeholder: "例如：凯迪拉克" })}
    ${input("车型", "vehicleModel", content?.vehicleModel, { placeholder: "例如：XT5" })}
    ${input("标签", "tags", content?.tags?.join(", "), { placeholder: "多个标签用逗号分隔" })}
    <label class="form-field form-field-wide"><span>内容摘要</span><textarea name="summary" rows="3">${escapeHtml(content?.summary || "")}</textarea></label>
    <label class="form-field form-field-wide"><span>制作备注</span><textarea name="notes" rows="3">${escapeHtml(content?.notes || "")}</textarea></label>
    <footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">${editing ? "保存修改" : "创建内容"}</button></footer>
  </form>`;
}

function writeValues(form) {
  const values = serializeForm(form);
  return {
    title: values.title,
    contentType: values.contentType,
    status: values.status,
    brand: values.brand,
    vehicleModel: values.vehicleModel,
    summary: values.summary,
    notes: values.notes,
    tags: tagsFromInput(values.tags)
  };
}

export function openCreateContent({ api, reload }) {
  openModal({ title: "新增内容", content: contentForm() });
  const form = document.querySelector("[data-content-form]");
  const idempotencyKey = crypto.randomUUID();
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api.post("/contents", writeValues(form), { idempotencyKey });
      closeModal();
      showToast("内容已创建，四个平台发布记录均为“未开始”。", "success");
      await reload();
    } catch (error) {
      submit.disabled = false;
      presentError(error);
    }
  });
}

function openEditContent(content, { api, reload }) {
  openModal({ title: "编辑内容", content: contentForm(content) });
  const form = document.querySelector("[data-content-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api.patch(`/contents/${content.id}`, writeValues(form), { version: content.version });
      closeModal();
      showToast("内容基础信息已更新。", "success");
      await reload();
    } catch (error) {
      submit.disabled = false;
      presentError(error);
    }
  });
}

function publicationGrid(publications = []) {
  return `<div class="publication-grid">${publications.map((publication) => `<div class="publication-state" data-publication-platform="${escapeHtml(publication.platformCode)}"><strong>${escapeHtml(publication.platformName)}</strong><span class="status-badge publication-${escapeHtml(publication.status)}">${escapeHtml(PUBLICATION_LABELS[publication.status] || publication.status)}</span></div>`).join("")}</div>`;
}

function openContentDetail(content, controls) {
  openModal({
    title: "查看内容",
    content: `<article class="content-detail">
      <div class="detail-heading"><div><span class="status-badge type-${escapeHtml(content.contentType)}">${escapeHtml(TYPE_LABELS[content.contentType])}</span><h3>${escapeHtml(content.title)}</h3><p>${escapeHtml([content.brand, content.vehicleModel].filter(Boolean).join(" · ") || "未标注品牌车型")}</p></div><span class="status-badge content-${escapeHtml(content.status)}">${escapeHtml(STATUS_LABELS[content.status])}</span></div>
      ${content.summary ? `<section><small>内容摘要</small><p>${escapeHtml(content.summary)}</p></section>` : ""}
      <section><small>四平台发布状态</small>${publicationGrid(content.publications)}</section>
      <footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>关闭</button><button class="btn btn-primary" type="button" data-detail-edit>编辑内容</button></footer>
    </article>`
  });
  document.querySelector("[data-detail-edit]")?.addEventListener("click", () => openEditContent(content, controls));
}

function renderContentRow(content) {
  return `<article class="content-row" data-content-row="${escapeHtml(content.id)}">
    <div class="content-main"><span class="content-symbol">▣</span><div><h3>${escapeHtml(content.title)}</h3><p>${escapeHtml([content.brand, content.vehicleModel].filter(Boolean).join(" · ") || "未标注品牌车型")}</p>${content.tags?.length ? `<div class="tag-list">${content.tags.map((tag) => `<span># ${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</div></div>
    <span class="status-badge type-${escapeHtml(content.contentType)}">${escapeHtml(TYPE_LABELS[content.contentType])}</span>
    <span class="status-badge content-${escapeHtml(content.status)}">${escapeHtml(STATUS_LABELS[content.status])}</span>
    <span class="source-count">${content.sourceInspirationIds?.length ? `${content.sourceInspirationIds.length} 条灵感` : "手动创建"}</span>
    ${publicationGrid(content.publications)}
    <div class="content-row-actions"><button class="btn btn-secondary" type="button" data-view-content="${escapeHtml(content.id)}" aria-label="查看内容 ${escapeHtml(content.title)}">查看</button><button class="btn btn-secondary" type="button" data-edit-content="${escapeHtml(content.id)}" aria-label="编辑内容 ${escapeHtml(content.title)}">编辑</button></div>
  </article>`;
}

export function renderContents({ data, loading = false, error = null, filters = {} } = {}) {
  const items = data?.items || [];
  const statusCounts = Object.fromEntries(Object.keys(STATUS_LABELS).map((status) => [status, items.filter((item) => item.status === status).length]));
  let list = items.map(renderContentRow).join("");
  if (loading) list = '<div class="loading-state">正在读取本地内容库…</div>';
  if (error) list = emptyState("内容读取失败", error.message || "请确认本地服务正在运行。", "!");
  if (!loading && !error && !items.length) list = emptyState("内容库目前为空", "可以从灵感转入，也可以直接新建内容；数据只保存在本地 SQLite。", "▣");
  const status = filters.status || "all";
  const contentType = filters.contentType || "all";
  return `<section class="page page-contents">
    ${pageHeader("内容库", "从制作到四平台发布统一管理", '<button class="btn btn-primary" type="button" data-new-content>＋ 新增内容</button>')}
    <section class="content-section content-toolbar"><label class="search-control"><span>⌕</span><input type="search" data-content-search placeholder="搜索标题、标签、品牌…" value="${escapeHtml(filters.search || "")}"></label><div class="toolbar-filters"><div class="chips">${[["all", "全部"], ...Object.entries(STATUS_LABELS)].map(([value, label]) => `<button class="chip${status === value ? " active" : ""}" type="button" data-content-status="${value}">${label}</button>`).join("")}</div><div class="chips">${[["all", "全部类型"], ...Object.entries(TYPE_LABELS)].map(([value, label]) => `<button class="chip${contentType === value ? " active" : ""}" type="button" data-content-type="${value}">${label}</button>`).join("")}</div></div></section>
    <div class="stats-grid stats-four">${statCard("准备中", "accent", "▤", "当前筛选结果", statusCounts.preparing)}${statCard("制作中", "pending", "▷", "当前筛选结果", statusCounts.producing)}${statCard("待发布", "warning", "◷", "当前筛选结果", statusCounts.ready)}${statCard("已发布", "success", "✓", "当前筛选结果", statusCounts.published)}</div>
    <section class="content-section content-table"><div class="table-head"><span>内容信息</span><span>类型</span><span>整体状态</span><span>灵感来源</span><span>平台发布状态</span><span>操作</span></div><div class="content-list">${list}</div></section>
  </section>`;
}

export function attachContents(root, { api, data, filters, reload, setFilters }) {
  const items = data?.items || [];
  const controls = { api, reload };
  root.querySelector("[data-new-content]")?.addEventListener("click", () => openCreateContent(controls));
  root.querySelectorAll("[data-view-content]").forEach((button) => button.addEventListener("click", () => {
    const content = items.find(({ id }) => id === button.dataset.viewContent);
    if (content) openContentDetail(content, controls);
  }));
  root.querySelectorAll("[data-edit-content]").forEach((button) => button.addEventListener("click", () => {
    const content = items.find(({ id }) => id === button.dataset.editContent);
    if (content) openEditContent(content, controls);
  }));
  root.querySelectorAll("[data-content-status]").forEach((button) => button.addEventListener("click", () => setFilters({ ...filters, status: button.dataset.contentStatus })));
  root.querySelectorAll("[data-content-type]").forEach((button) => button.addEventListener("click", () => setFilters({ ...filters, contentType: button.dataset.contentType })));
  const search = root.querySelector("[data-content-search]");
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const value = search.value.trim();
      queueMicrotask(() => setFilters({ ...filters, search: value }));
    }
  });
}
