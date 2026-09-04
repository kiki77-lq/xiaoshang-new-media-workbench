import { api } from "./api/client.js";
import { renderShell } from "./components/shell.js";
import { attachAnalytics } from "./pages/analytics.js";
import { attachCalendar } from "./pages/calendar.js";
import { getPage } from "./pages/index.js";
import { createRouter } from "./router.js";

const appRoot = document.querySelector("#app");
const state = { activeRoute: null, calendarDate: new Date(), health: null, meta: null, apiError: null };

function bindShellControls() {
  const sidebar = document.querySelector("#sidebar");
  const toggle = document.querySelector("#menu-toggle");
  const scrim = document.querySelector("#sidebar-scrim");
  const setOpen = (open) => {
    sidebar?.classList.toggle("is-open", open);
    scrim?.classList.toggle("is-visible", open);
    toggle?.setAttribute("aria-expanded", String(open));
  };
  toggle?.addEventListener("click", () => setOpen(!sidebar.classList.contains("is-open")));
  scrim?.addEventListener("click", () => setOpen(false));
}

function renderRoute(route) {
  state.activeRoute = route;
  const page = getPage(route.name);
  appRoot.innerHTML = renderShell(route.name);
  const outlet = document.querySelector("#page-outlet");
  outlet.innerHTML = page.render({ now: new Date(), calendarDate: state.calendarDate, health: state.health, meta: state.meta, apiError: state.apiError });
  document.title = `${page.title}｜小商的拍车日记`;
  bindShellControls();
  if (route.name === "calendar") attachCalendar(outlet, { onMonthChange(date) { state.calendarDate = date; renderRoute(route); } });
  if (route.name === "analytics") attachAnalytics(outlet);
}

const router = createRouter({ onRoute: renderRoute });
router.start();

async function loadRuntimeFacts() {
  const [healthResult, metaResult] = await Promise.allSettled([api.get("/health"), api.get("/meta")]);
  if (healthResult.status === "fulfilled") state.health = { ...healthResult.value.data, requestId: healthResult.value.requestId };
  if (metaResult.status === "fulfilled") state.meta = { ...metaResult.value.data, requestId: metaResult.value.requestId };
  const failure = [healthResult, metaResult].find((result) => result.status === "rejected");
  state.apiError = failure?.reason || null;
  if (state.activeRoute) renderRoute(state.activeRoute);
}

loadRuntimeFacts();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
