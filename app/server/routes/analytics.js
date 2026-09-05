import { authenticateRequest } from '../http/auth.js';
import { readJson } from '../http/body.js';
import { sendData } from '../http/response.js';
import { createIngestion, listIngestionRuns } from '../services/ingestion-service.js';
import { getOverview, getContentReview } from '../services/analytics-service.js';
import { DEFAULT_MAPPING, METRICS, invalid } from '../services/metric-model.js';

function query(req, allowed) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length > 1) invalid('Unsupported or repeated query parameter.');
  }
  return params;
}
export function registerAnalyticsRoutes(router, { config, db }) {
  router.add('POST','/api/v1/ingestion',async(req,res,context) => {
    const principal = authenticateRequest(req,config);
    const body = await readJson(req,config.bodyLimitBytes);
    const result = await createIngestion(body, { db, actor: principal.actor, requestId: context.requestId,
      idempotencyKey: req.headers['idempotency-key'] });
    sendData(res,result.status,result.body,{ requestId: context.requestId, idempotencyReplayed: result.replayed });
  });
  router.add('GET','/api/v1/ingestion',async(req,res,context) => {
    query(req,[]);
    sendData(res,200,listIngestionRuns(db),{ requestId: context.requestId });
  });
  router.add('GET','/api/v1/ingestion/mapping',async(req,res,context) => {
    query(req,[]);
    sendData(res,200,{ mapping: DEFAULT_MAPPING, metrics: METRICS },{ requestId: context.requestId });
  });
  router.add('GET','/api/v1/analytics/overview',async(req,res,context) => {
    const month = query(req,['month']).get('month') ?? undefined;
    sendData(res,200,getOverview(db,month),{ requestId: context.requestId });
  });
  router.add('GET','/api/v1/contents/:id/review',async(req,res,context) => {
    const platform = query(req,['platformCode']).get('platformCode') ?? undefined;
    sendData(res,200,getContentReview(db,context.params.id,platform),{ requestId: context.requestId });
  });
}
