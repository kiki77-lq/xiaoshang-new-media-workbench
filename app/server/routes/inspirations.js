import { authenticateRequest } from "../http/auth.js";
import { readJson } from "../http/body.js";
import { HttpError } from "../http/errors.js";
import { sendData } from "../http/response.js";
import { getInspiration, listInspirations } from "../repositories/inspiration-repository.js";
import { convertInspiration, createInspiration, updateInspiration } from "../services/inspiration-service.js";

function searchParams(req) {
  return new URL(req.url, "http://127.0.0.1").searchParams;
}

function requiredIdempotencyKey(req) {
  return req.headers["idempotency-key"];
}

export function registerInspirationRoutes(router, { config, db }) {
  router.add("GET", "/api/v1/inspirations", async (req, res, context) => {
    const query = searchParams(req);
    const status = query.get("status") || undefined;
    if (status && !["inbox", "organized", "converted", "archived"].includes(status)) {
      throw new HttpError(400, "VALIDATION_ERROR", "status is invalid.", [{ field: "status" }]);
    }
    const pinnedValue = query.get("pinned");
    if (pinnedValue && !["true", "false"].includes(pinnedValue)) {
      throw new HttpError(400, "VALIDATION_ERROR", "pinned must be true or false.", [{ field: "pinned" }]);
    }
    const items = listInspirations(db, {
      search: query.get("search")?.trim() || undefined,
      status,
      pinned: pinnedValue === null ? undefined : pinnedValue === "true"
    });
    sendData(res, 200, { items, total: items.length }, { requestId: context.requestId });
  });

  router.add("POST", "/api/v1/inspirations", async (req, res, context) => {
    const principal = authenticateRequest(req, config);
    const body = await readJson(req, config.bodyLimitBytes);
    const created = await createInspiration(body, {
      db, actor: principal.actor, requestId: context.requestId,
      idempotencyKey: requiredIdempotencyKey(req)
    });
    const { idempotencyReplayed, ...data } = created;
    sendData(res, 201, data, { requestId: context.requestId, idempotencyReplayed });
  });

  router.add("GET", "/api/v1/inspirations/:id", async (_req, res, context) => {
    const inspiration = getInspiration(db, context.params.id);
    if (!inspiration) throw new HttpError(404, "INSPIRATION_NOT_FOUND", "Inspiration was not found.");
    sendData(res, 200, inspiration, { requestId: context.requestId });
  });

  router.add("PATCH", "/api/v1/inspirations/:id", async (req, res, context) => {
    const principal = authenticateRequest(req, config);
    const body = await readJson(req, config.bodyLimitBytes);
    const updated = await updateInspiration(context.params.id, body, {
      db, actor: principal.actor, requestId: context.requestId, expectedVersion: body?.version
    });
    sendData(res, 200, updated, { requestId: context.requestId });
  });

  router.add("POST", "/api/v1/inspirations/:id/convert", async (req, res, context) => {
    const principal = authenticateRequest(req, config);
    const body = await readJson(req, config.bodyLimitBytes);
    const result = await convertInspiration(context.params.id, body, {
      db, actor: principal.actor, requestId: context.requestId,
      expectedVersion: body?.version, idempotencyKey: requiredIdempotencyKey(req)
    });
    const { idempotencyReplayed, ...data } = result;
    sendData(res, data.alreadyConverted ? 200 : 201, data, { requestId: context.requestId, idempotencyReplayed });
  });
}
