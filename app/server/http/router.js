export function createRouter() {
  const routes = [];
  return {
    add(method, path, handler) {
      routes.push({ method, path, handler });
      return this;
    },
    async dispatch(req, res, context) {
      const route = routes.find((candidate) => (
        candidate.method === req.method && candidate.path === context.pathname
      ));
      if (!route) return false;
      await route.handler(req, res, context);
      return true;
    }
  };
}
