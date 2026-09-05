export function createRouter() {
  const routes = [];
  return {
    add(method, path, handler) {
      const names = [];
      const pattern = path
        .split("/")
        .map((segment) => {
          if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          names.push(segment.slice(1));
          return "([^/]+)";
        })
        .join("/");
      routes.push({ method, path, handler, names, regex: new RegExp(`^${pattern}$`) });
      return this;
    },
    async dispatch(req, res, context) {
      let matched;
      let match;
      for (const candidate of routes) {
        if (candidate.method !== req.method) continue;
        const candidateMatch = candidate.regex.exec(context.pathname);
        if (candidateMatch) { matched = candidate; match = candidateMatch; break; }
      }
      if (!matched) return false;
      const params = Object.fromEntries(matched.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
      await matched.handler(req, res, { ...context, params });
      return true;
    }
  };
}
