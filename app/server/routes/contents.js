import { authenticateRequest } from "../http/auth.js";
import { readJson } from "../http/body.js";
import { HttpError } from "../http/errors.js";
import { sendData } from "../http/response.js";
import { getContent, listContents } from "../repositories/content-repository.js";
import { updatePublication } from '../services/publication-service.js';
import { createContent, updateContent } from "../services/content-service.js";

function queryParams(req) {
  return new URL(req.url, "http://127.0.0.1").searchParams;
}

export function registerContentRoutes(router, { config, db }) {
  router.add('PATCH','/api/v1/contents/:id/publications/:platformCode',async(req,res,context)=>{
    const principal=authenticateRequest(req,config);
    const body=await readJson(req,config.bodyLimitBytes);
    const result=updatePublication(context.params.id,context.params.platformCode,body,body?.version,{db,actor:principal.actor,requestId:context.requestId});
    sendData(res,200,result,{requestId:context.requestId});
  });
  router.add("GET", "/api/v1/contents", async (req, res, context) => {
    const query = queryParams(req);
    const contentType = query.get("contentType") || undefined;
    const status = query.get("status") || undefined;
    if (contentType && !["organic", "commercial"].includes(contentType)) {
      throw new HttpError(400, "VALIDATION_ERROR", "contentType is invalid.", [{ field: "contentType" }]);
    }
    if (status && !["preparing", "producing", "ready", "published"].includes(status)) {
      throw new HttpError(400, "VALIDATION_ERROR", "status is invalid.", [{ field: "status" }]);
    }
    const items = listContents(db, { search: query.get("search")?.trim() || undefined, contentType, status });
    sendData(res, 200, { items, total: items.length }, { requestId: context.requestId });
  });

  router.add("POST", "/api/v1/contents", async (req, res, context) => {
    const principal = authenticateRequest(req, config);
    const body = await readJson(req, config.bodyLimitBytes);
    const created = await createContent(body, {
      db, actor: principal.actor, requestId: context.requestId,
      idempotencyKey: req.headers["idempotency-key"]
    });
    const { idempotencyReplayed, ...data } = created;
    sendData(res, 201, data, { requestId: context.requestId, idempotencyReplayed });
  });

  router.add("GET", "/api/v1/contents/:id", async (_req, res, context) => {
    const content = getContent(db, context.params.id);
    if (!content) throw new HttpError(404, "CONTENT_NOT_FOUND", "Content was not found.");
    sendData(res, 200, content, { requestId: context.requestId });
  });

  router.add("PATCH", "/api/v1/contents/:id", async (req, res, context) => {
    const principal = authenticateRequest(req, config);
    const body = await readJson(req, config.bodyLimitBytes);
    const updated = await updateContent(context.params.id, body, {
      db, actor: principal.actor, requestId: context.requestId, expectedVersion: body?.version
    });
    sendData(res, 200, updated, { requestId: context.requestId });
  });
}
