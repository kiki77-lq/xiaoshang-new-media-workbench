import { authenticateRequest } from '../http/auth.js';
import { readJson } from '../http/body.js';
import { sendData } from '../http/response.js';
import { previewReport,createReport,getReport,listReports } from '../services/report-service.js';
import { createObservation,updateObservation,convertObservation,listObservations,getObservation } from '../services/observation-service.js';
import { getSettings,updateSettings } from '../services/settings-service.js';

export function registerPhase6Routes(router,{config,db}) {
  const get=(route,fn)=>router.add('GET',`/api/v1${route}`,async(req,res,ctx)=>sendData(res,200,fn(ctx,new URL(req.url,'http://localhost').searchParams),{requestId:ctx.requestId}));
  const write=(method,route,fn,idempotent=false)=>router.add(method,`/api/v1${route}`,async(req,res,ctx)=>{
    const principal=authenticateRequest(req,config),body=await readJson(req,config.bodyLimitBytes);
    const result=await fn(body,{...ctx,db,actor:principal.actor,key:req.headers['idempotency-key']});
    sendData(res,idempotent?result.status:200,idempotent?result.body:result,{requestId:ctx.requestId,...(idempotent?{idempotencyReplayed:result.replayed}:{})});
  });
  get('/reports',(_ctx,q)=>({items:listReports(db,q.get('periodType')??undefined)}));
  get('/reports/preview',(_ctx,q)=>previewReport(db,{periodType:q.get('periodType'),anchorDate:q.get('anchorDate')??undefined}));
  get('/reports/:id',ctx=>getReport(db,ctx.params.id));
  get('/reports/:id/markdown',ctx=>{const r=getReport(db,ctx.params.id);return {markdown:r.markdown,fileName:`${r.periodType}-${r.periodStart}-${r.id}.md`};});
  write('POST','/reports',createReport,true);
  get('/observations',(_ctx,q)=>listObservations(db,Object.fromEntries(['kind','status','search'].filter(k=>q.has(k)).map(k=>[k,q.get(k)]))));
  get('/observations/:id',ctx=>getObservation(db,ctx.params.id));
  write('POST','/observations',createObservation,true);
  write('PATCH','/observations/:id',(body,ctx)=>updateObservation(ctx.params.id,body,ctx));
  write('POST','/observations/:id/convert',(body,ctx)=>convertObservation(ctx.params.id,body,ctx),true);
  get('/settings',()=>getSettings(db,config));
  write('PATCH','/settings',(body,ctx)=>updateSettings(body,ctx,config));
}
