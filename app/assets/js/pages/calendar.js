import { openModal } from "../components/modal.js";
import { emptyState, pageHeader, statCard } from "../shared/dom.js";
import { formatMonth } from "../shared/format.js";

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildMonthGrid(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, monthIndex, 1 - mondayOffset + index);
    return { isoDate: isoDate(date), day: date.getDate(), inCurrentMonth: date.getMonth() === monthIndex };
  });
}

export function eventPresentation(type) {
  return ({
    publish: { label: "发布", tone: "danger" },
    shoot: { label: "拍摄 / 项目安排", tone: "info" },
    pending: { label: "待确认", tone: "pending" }
  })[type];
}

export function renderCalendar({ now = new Date(), calendarDate = now } = {}) {
  const days = buildMonthGrid(calendarDate.getFullYear(), calendarDate.getMonth());
  const today = isoDate(now);
  return `<section class="page page-calendar" data-calendar-year="${calendarDate.getFullYear()}" data-calendar-month="${calendarDate.getMonth()}">
    ${pageHeader("发布日历", "把拍摄、发布、待确认排进同一张月历")}
    <div class="stats-grid stats-four">${statCard("今日待发", "danger", "➤")}${statCard("本周待发", "warning", "▦")}${statCard("已排期", "accent", "▣")}${statCard("待确认", "pending", "?")}</div>
    <div class="calendar-layout"><section class="content-section calendar-panel"><div class="calendar-toolbar"><div><button class="icon-button" data-calendar-action="prev" aria-label="上个月">‹</button><button class="icon-button" data-calendar-action="next" aria-label="下个月">›</button><strong>${formatMonth(calendarDate)}</strong></div><button class="btn btn-secondary" data-calendar-action="today">今天</button></div><div class="calendar-weekdays">${["周一","周二","周三","周四","周五","周六","周日"].map((day) => `<span>${day}</span>`).join("")}</div><div class="calendar-grid">${days.map((day) => `<button type="button" class="calendar-day${day.inCurrentMonth ? "" : " is-outside"}${day.isoDate === today ? " is-today" : ""}" data-calendar-day="${day.isoDate}" aria-label="${day.isoDate}"><span>${day.day}</span></button>`).join("")}</div><div class="calendar-legend">${["publish","shoot","pending"].map((type) => { const item = eventPresentation(type); return `<span><i class="tone-${item.tone}"></i>${item.label}</span>`; }).join("")}</div></section><aside class="content-section day-panel"><div class="section-heading"><div><h2>单日详情</h2><p>选择日期查看安排</p></div></div>${emptyState("当天没有安排", "业务排期将在后续阶段从 schedule_events 读取。", "▦")}</aside></div>
  </section>`;
}

export function attachCalendar(root, { now = new Date(), onMonthChange } = {}) {
  root.querySelectorAll("[data-calendar-action]").forEach((button) => button.addEventListener("click", () => {
    const page = root.querySelector(".page-calendar");
    let year = Number(page.dataset.calendarYear);
    let month = Number(page.dataset.calendarMonth);
    if (button.dataset.calendarAction === "today") { year = now.getFullYear(); month = now.getMonth(); }
    if (button.dataset.calendarAction === "prev") month -= 1;
    if (button.dataset.calendarAction === "next") month += 1;
    onMonthChange(new Date(year, month, 1));
  }));
  root.querySelectorAll("[data-calendar-day]").forEach((button) => button.addEventListener("click", () => openModal({
    title: `${button.dataset.calendarDay} 安排`,
    content: emptyState("当天没有安排", "本阶段只展示日详情基础 Modal。", "▦")
  })));
}
