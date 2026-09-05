import { authenticateRequest } from '../http/auth.js';
import { readJson } from '../http/body.js';
import { sendData } from '../http/response.js';
import { createCalendarEvent, listCalendarEvents, updateCalendarEvent, deleteCalendarEvent } from '../services/calendar-service.js';

export function registerCalendarRoutes(router,{config,db}) {
  router.add('GET','/api/v1/calendar-events',async(req,res,context)=>{
    const query=new URL(req.url,'http://localhost').searchParams;
    const result=listCalendarEvents({from:query.get('from'),to:query.get('to'),eventType:query.has('eventType')?query.get('eventType'):undefined},{db});
    sendData(res,200,result,{requestId:context.requestId});
  });
  router.add('POST','/api/v1/calendar-events',async(req,res,context)=>{
    const principal=authenticateRequest(req,config);
    const body=await readJson(req,config.bodyLimitBytes);
    const result=await createCalendarEvent(body,{db,actor:principal.actor,requestId:context.requestId,idempotencyKey:req.headers['idempotency-key']});
    sendData(res,201,result.event,{requestId:context.requestId,idempotencyReplayed:result.idempotencyReplayed});
  });
  for(const [method,handler] of [['PATCH',updateCalendarEvent],['DELETE',deleteCalendarEvent]]) router.add(method,'/api/v1/calendar-events/:id',async(req,res,context)=>{
    const principal=authenticateRequest(req,config);
    const body=await readJson(req,config.bodyLimitBytes);
    sendData(res,200,handler(context.params.id,body,{db,actor:principal.actor,requestId:context.requestId}),{requestId:context.requestId});
  });
}
