export const ROUTES = Object.freeze([
  { name: "home", path: "/" },
  { name: "inspirations", path: "/inspirations" },
  { name: "contents", path: "/contents" },
  { name: "calendar", path: "/calendar" },
  { name: "analytics", path: "/analytics" },
  { name: "reports", path: "/reports" },
  { name: "observations", path: "/observations" },
  { name: "settings", path: "/settings" }
]);

function normalizePath(pathname = "/") {
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
}

export function resolveRoute(pathname) {
  const normalized = normalizePath(pathname);
  return ROUTES.find(({ path }) => path === normalized) || ROUTES[0];
}

export function createRouter({ onRoute, windowRef = window }) {
  const dispatch = () => onRoute(resolveRoute(windowRef.location.pathname));
  const click = (event) => {
    const link = event.target.closest("a[data-route]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    windowRef.history.pushState({}, "", link.getAttribute("href"));
    dispatch();
  };
  windowRef.document.addEventListener("click", click);
  windowRef.addEventListener("popstate", dispatch);
  return { start: dispatch, navigate(path) { windowRef.history.pushState({}, "", path); dispatch(); } };
}
