import { api } from "./api/client.js";
import { renderShell } from "./components/shell.js";
import { attachAnalytics } from "./pages/analytics.js";
import { attachCalendar, calendarRange } from "./pages/calendar.js";
import { attachContents } from "./pages/contents.js";
import { getPage } from "./pages/index.js";
import { attachInspirations, openCreateInspiration } from "./pages/inspirations.js";
import { createRouter } from "./router.js";
import { currentMonth } from './shared/metrics.js';

const appRoot = document.querySelector("#app");
const state = {
  activeRoute: null,
  calendarDate: new Date(),
  health: null,
  meta: null,
  apiError: null,
  pageData: {},
  pageErrors: {},
  pageLoading: {},
  requestSequence: 0,
  filters: {
    inspirations: { filter: "all", search: "" },
    contents: { status: "all", contentType: "all", search: "" },
    calendar: { eventType: 'all' },
    analytics: { month: currentMonth() }
  }
};

function queryForPage(name) {
  const query = new URLSearchParams();
  if (name === "inspirations") {
    const filters = state.filters.inspirations;
    if (filters.search) query.set("search", filters.search);
    if (filters.filter === "pinned") query.set("pinned", "true");
    if (["inbox", "converted"].includes(filters.filter)) query.set("status", filters.filter);
  }
  if (name === "contents") {
    const filters = state.filters.contents;
    if (filters.search) query.set("search", filters.search);
    if (filters.status !== "all") query.set("status", filters.status);
    if (filters.contentType !== "all") query.set("contentType", filters.contentType);
  }
  const value = query.toString();
  return value ? `?${value}` : "";
}

function pageEndpoint(name) {
  if (name === "home") return "/dashboard";
  if (name === "inspirations") return `/inspirations${queryForPage(name)}`;
  if (name === "contents") return `/contents${queryForPage(name)}`;
  if (name === 'analytics') return `/analytics/overview?month=${encodeURIComponent(state.filters.analytics.month)}`;
  if (name === 'calendar') {
    const query = new URLSearchParams(calendarRange(state.calendarDate));
    if (state.filters.calendar.eventType !== 'all') query.set('eventType', state.filters.calendar.eventType);
    return `/calendar-events?${query}`;
  }
  return null;
}

function coreControls(name) {
  const reload = () => loadPage(state.activeRoute, { showLoading: false });
  if (name === 'analytics') return {
    api, data: state.pageData.analytics, reload, month: state.filters.analytics.month,
    setMonth(month) { state.filters.analytics.month = month; loadPage(state.activeRoute); }
  };
  if (name === 'calendar') return {
    api, data: state.pageData.calendar, reload,
    setFilters(filters) { state.filters.calendar = filters; loadPage(state.activeRoute); },
    onMonthChange(date) { state.calendarDate = date; loadPage(state.activeRoute); }
  };
  if (name === "inspirations") {
    return {
      api,
      data: state.pageData.inspirations,
      filters: state.filters.inspirations,
      reload,
      setFilters(filters) {
        state.filters.inspirations = filters;
        loadPage(state.activeRoute);
      }
    };
  }
  return {
    api,
    data: state.pageData.contents,
    filters: state.filters.contents,
    reload,
    setFilters(filters) {
      state.filters.contents = filters;
      loadPage(state.activeRoute);
    }
  };
}

function renderPage(route) {
  if (!route || state.activeRoute?.name !== route.name) return;
  const page = getPage(route.name);
  const outlet = document.querySelector("#page-outlet");
  if (!outlet) return;
  outlet.dataset.page = route.name;
  outlet.innerHTML = page.render({
    now: new Date(),
    calendarDate: state.calendarDate,
    health: state.health,
    meta: state.meta,
    apiError: state.apiError,
    data: state.pageData[route.name],
    error: state.pageErrors[route.name],
    loading: state.pageLoading[route.name],
    filters: state.filters[route.name]
  });
  document.title = `${page.title}｜小商的拍车日记`;
  if (route.name === "calendar") attachCalendar(outlet, coreControls('calendar'));
  if (route.name === "analytics") attachAnalytics(outlet, coreControls('analytics'));
  if (route.name === "inspirations") attachInspirations(outlet, coreControls("inspirations"));
  if (route.name === "contents") attachContents(outlet, coreControls("contents"));
}

async function loadPage(route, { showLoading = true } = {}) {
  const endpoint = pageEndpoint(route?.name);
  if (!endpoint) return;
  const sequence = ++state.requestSequence;
  if (showLoading) {
    state.pageLoading[route.name] = true;
    state.pageErrors[route.name] = null;
    renderPage(route);
  }
  try {
    const [result, contentResult] = await Promise.all([api.get(endpoint), ['calendar','analytics'].includes(route.name) ? api.get('/contents') : Promise.resolve(null)]);
    if (sequence !== state.requestSequence || state.activeRoute?.name !== route.name) return;
    state.pageData[route.name] = contentResult ? { ...result.data, contents: contentResult.data.items } : result.data;
    state.pageErrors[route.name] = null;
  } catch (error) {
    if (sequence !== state.requestSequence || state.activeRoute?.name !== route.name) return;
    state.pageErrors[route.name] = error;
  } finally {
    if (sequence === state.requestSequence && state.activeRoute?.name === route.name) {
      state.pageLoading[route.name] = false;
      renderPage(route);
    }
  }
  return state.pageData[route.name];
}

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
  document.querySelector("[data-quick-inspiration]")?.addEventListener("click", () => {
    if (state.activeRoute?.name !== "inspirations") router.navigate("/inspirations");
    openCreateInspiration({ api, reload: () => loadPage(state.activeRoute, { showLoading: false }) });
  });
}

function renderRoute(route) {
  state.activeRoute = route;
  appRoot.innerHTML = renderShell(route.name);
  bindShellControls();
  renderPage(route);
  loadPage(route);
}

const router = createRouter({ onRoute: renderRoute });
router.start();

async function loadRuntimeFacts() {
  const [healthResult, metaResult] = await Promise.allSettled([api.get("/health"), api.get("/meta")]);
  if (healthResult.status === "fulfilled") state.health = { ...healthResult.value.data, requestId: healthResult.value.requestId };
  if (metaResult.status === "fulfilled") state.meta = { ...metaResult.value.data, requestId: metaResult.value.requestId };
  const failure = [healthResult, metaResult].find((result) => result.status === "rejected");
  state.apiError = failure?.reason || null;
  if (state.activeRoute?.name === "settings") renderPage(state.activeRoute);
}

loadRuntimeFacts();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
