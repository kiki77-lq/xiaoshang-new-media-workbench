import { renderAnalytics } from "./analytics.js";
import { renderCalendar } from "./calendar.js";
import { renderContents } from "./contents.js";
import { renderHome } from "./home.js";
import { renderInspirations } from "./inspirations.js";
import { renderObservations } from "./observations.js";
import { renderReports } from "./reports.js";
import { renderSettings } from "./settings.js";

export const PAGE_DEFINITIONS = Object.freeze([
  { name: "home", title: "首页", render: renderHome },
  { name: "inspirations", title: "灵感备忘", render: renderInspirations },
  { name: "contents", title: "内容库", render: renderContents },
  { name: "calendar", title: "发布日历", render: renderCalendar },
  { name: "analytics", title: "数据看板", render: renderAnalytics },
  { name: "reports", title: "周报 / 月报", render: renderReports },
  { name: "observations", title: "热点 / 竞品观察", render: renderObservations },
  { name: "settings", title: "设置", render: renderSettings }
]);

export function getPage(name) {
  return PAGE_DEFINITIONS.find((page) => page.name === name) || PAGE_DEFINITIONS[0];
}
