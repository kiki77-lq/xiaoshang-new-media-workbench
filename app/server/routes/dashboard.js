import { sendData } from "../http/response.js";
import { getDashboard } from "../services/dashboard-service.js";

export function registerDashboardRoutes(router, { db }) {
  router.add("GET", "/api/v1/dashboard", async (_req, res, context) => {
    sendData(res, 200, getDashboard({ db }), { requestId: context.requestId });
  });
}
