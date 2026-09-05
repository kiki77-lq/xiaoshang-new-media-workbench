import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbuddyClient } from '../../../workbuddy/client.mjs';

const token='fictional-test-token-'.repeat(3);
const response=data=>new Response(JSON.stringify({data,meta:{requestId:'request-test'}}));
test('WorkBuddy sends only local API bearer requests and stable caller-provided write keys',async()=>{
  const calls=[];const client=createWorkbuddyClient({token,fetchImpl:async(url,options)=>{calls.push({url,options});return response({id:'i1'});}});
  const request={body:{rawText:'虚构雨夜 FUV'},requestKey:'same-logical-request'};
  await client.execute('remember.inspiration',request);await client.execute('remember.inspiration',request);
  assert.equal(calls[0].url,'http://127.0.0.1:5173/api/v1/inspirations');
  assert.equal(calls[0].options.headers.Authorization,`Bearer ${token}`);
  assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);
  assert.equal(JSON.parse(calls[0].options.body).sourceType,'workbuddy');assert.equal(calls[0].options.redirect,'error');
  await assert.rejects(client.execute('remember.inspiration',{body:{rawText:'不发'}}),/REQUEST_KEY_REQUIRED/);
  assert.equal(calls.length,2);
});
test('WorkBuddy rejects nonlocal targets credentials and path escapes before fetch',()=>{
  for(const baseUrl of ['https://example.com','http://127.0.0.1.evil.test','http://x:y@127.0.0.1','http://127.0.0.1/else','file:///tmp'])assert.throws(()=>createWorkbuddyClient({token,baseUrl}),/LOCAL_URL_REQUIRED/);
});
test('WorkBuddy modifications need an explicit version and rawText is never editable',async()=>{
  const calls=[];const client=createWorkbuddyClient({token,fetchImpl:async(u,o)=>{calls.push(o);return response({version:2});}});
  await assert.rejects(client.execute('change.inspiration',{id:'i1',body:{rawText:'篡改',version:1},requestKey:'one'}),/RAW_TEXT_IMMUTABLE/);
  await assert.rejects(client.execute('change.content',{id:'c1',body:{status:'ready'},requestKey:'two'}),/VERSION_REQUIRED/);
  await client.execute('change.content',{id:'c1',body:{status:'ready',version:1},requestKey:'three'});
  assert.equal(calls.length,1);assert.equal(calls[0].method,'PATCH');assert.equal(JSON.parse(calls[0].body).version,1);
});
test('WorkBuddy never confirms HTTP errors malformed success or network uncertainty and redacts secrets',async()=>{
  const client=createWorkbuddyClient({token,fetchImpl:async()=>new Response(JSON.stringify({error:{code:'VERSION_CONFLICT',message:`conflict ${token}`},requestId:'r-error'}),{status:409})});
  await assert.rejects(client.execute('view.home'),e=>e.code==='VERSION_CONFLICT'&&e.requestId==='r-error'&&!e.message.includes(token));
  for(const body of ['{}','{"error":{"message":"bad"}}','not json'])await assert.rejects(createWorkbuddyClient({token,fetchImpl:async()=>new Response(body)}).execute('view.home'),/INVALID_RESPONSE/);
  await assert.rejects(createWorkbuddyClient({token,fetchImpl:async()=>new Response('null',{status:500})}).execute('view.home'),e=>e instanceof Error&&e.code==='INVALID_RESPONSE');
  await assert.rejects(createWorkbuddyClient({token,fetchImpl:async()=>{throw Error(token);}}).execute('view.home'),e=>e.code==='NETWORK_UNCERTAIN'&&!e.message.includes(token));
});
test('WorkBuddy cross-entity search aggregates actual API reads and cannot dispatch an unknown intent',async()=>{
  const paths=[];const client=createWorkbuddyClient({token,fetchImpl:async url=>{paths.push(url);return response({items:[{id:'x',markdown:'虚构报告'}]});}});
  const result=await client.execute('find.all',{query:{search:'虚构'}});
  assert.equal(paths.length,4);assert.equal(result.data.reports.length,1);assert.equal(result.requestIds.length,4);
  await assert.rejects(client.execute('delete.everything'),/UNKNOWN_INTENT/);assert.equal(paths.length,4);
});
