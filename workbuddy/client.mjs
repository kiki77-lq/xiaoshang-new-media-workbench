import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export class WorkbuddyError extends Error {
  constructor(code,message=code,requestId=null,status=0){super(message);this.name='WorkbuddyError';Object.assign(this,{code,requestId,status});}
}
const fail=code=>{throw new WorkbuddyError(code);};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value)?value:fail('ID_REQUIRED');
const platforms=new Set(['douyin','wechat_channels','xiaohongshu','weibo']);
const queryString=query=>{const p=new URLSearchParams();for(const [key,value] of Object.entries(query || {}))if(value!==undefined&&value!==null)p.set(key,String(value));return p.size?`?${p}`:'';};

function routeFor(intent,input){
  const id=()=>identifier(input.id), body=input.body || {}, query=input.query || {};
  const read=(route,queryValues=query)=>({method:'GET',route:route+queryString(queryValues)});
  const write=(method,route,bodyValue=body)=>({method,route,body:bodyValue});
  switch(intent){
    case 'remember.inspiration':return write('POST','/inspirations',{...body,sourceType:'workbuddy'});
    case 'remember.content':return write('POST','/contents');
    case 'remember.shoot':return write('POST','/calendar-events',{...body,eventType:'shoot'});
    case 'remember.publication':case 'change.publication':
      if(!platforms.has(input.platformCode))fail('PLATFORM_REQUIRED');
      return write('PATCH',`/contents/${id()}/publications/${input.platformCode}`);
    case 'remember.metrics':return write('POST','/ingestion',{...body,sourceType:'workbuddy'});
    case 'remember.observation':return write('POST','/observations',{...body,sourceType:'workbuddy'});
    case 'remember.report':return write('POST','/reports',{...body,generationMode:'deterministic'});
    case 'convert.inspiration':return write('POST',`/inspirations/${id()}/convert`);
    case 'convert.observation':return write('POST',`/observations/${id()}/convert`);
    case 'find.inspirations':return read(input.id?`/inspirations/${id()}`:'/inspirations');
    case 'find.contents':return read(input.id?`/contents/${id()}`:'/contents');
    case 'find.calendar':return read('/calendar-events');
    case 'find.reports':return read(input.id?`/reports/${id()}`:'/reports');
    case 'find.observations':return read(input.id?`/observations/${id()}`:'/observations');
    case 'change.inspiration':
      if(Object.hasOwn(body,'rawText'))fail('RAW_TEXT_IMMUTABLE');
      return write('PATCH',`/inspirations/${id()}`);
    case 'change.content':return write('PATCH',`/contents/${id()}`);
    case 'change.calendar':return write('PATCH',`/calendar-events/${id()}`);
    case 'view.home':return read('/dashboard',{});
    case 'view.week':return read('/reports/preview',{...query,periodType:'week'});
    case 'view.performance':return read(`/contents/${id()}/review`,{});
    case 'view.hotspots':return read('/observations',{...query,kind:'hotspot',status:'pending'});
    case 'view.health':return read('/health',{});
    default:return fail('UNKNOWN_INTENT');
  }
}

export function createWorkbuddyClient({baseUrl='http://127.0.0.1:5173',token,fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  let base;try{base=new URL(baseUrl);}catch{fail('LOCAL_URL_REQUIRED');}
  if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)fail('LOCAL_URL_REQUIRED');
  if(typeof token!=='string'||token.length<32||/[\r\n]/.test(token))fail('LOCAL_TOKEN_REQUIRED');
  const redact=value=>String(value).split(token).join('[REDACTED]');
  async function execute(intent,input={}){
    if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_INPUT');
    if(intent==='find.all'){
      const query=input.query || {},search=String(query.search || '');
      const results=await Promise.all(['inspirations','contents','observations','reports'].map(entity=>execute(`find.${entity}`,{query:entity==='reports'?{}:{search}})));
      return {ok:true,data:Object.fromEntries(['inspirations','contents','observations','reports'].map((entity,i)=>[entity,entity==='reports'?results[i].data.items.filter(r=>String(r.markdown).includes(search)):results[i].data.items])),requestIds:results.map(r=>r.requestId)};
    }
    const {method,route,body}=routeFor(intent,input),headers={Accept:'application/json',Authorization:`Bearer ${token}`};
    if(method!=='GET'){
      if(typeof input.requestKey!=='string'||input.requestKey.length<1||input.requestKey.length>200)fail('REQUEST_KEY_REQUIRED');
      headers['Idempotency-Key']=input.requestKey;headers['Content-Type']='application/json';
      if((method==='PATCH'||intent.startsWith('convert.'))&&(!Number.isInteger(body.version)||body.version<1))fail('VERSION_REQUIRED');
    }
    let response,envelope;
    try{response=await fetchImpl(`${base.origin}/api/v1${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
    catch{throw new WorkbuddyError('NETWORK_UNCERTAIN','请求未获得确认；写入结果未知，请保留原请求键和参数核查，勿换键重复新增。');}
    try{envelope=await response.json();}catch{throw new WorkbuddyError('INVALID_RESPONSE','INVALID_RESPONSE：未获得有效成功响应。',null,response.status);}
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))fail('INVALID_RESPONSE');
    if(!response.ok)throw new WorkbuddyError(envelope.error?.code || 'REQUEST_FAILED',redact(envelope.error?.message || '请求失败。'),envelope.requestId || response.headers.get('x-request-id'),response.status);
    if(!envelope||!Object.hasOwn(envelope,'data')||typeof envelope.meta?.requestId!=='string')fail('INVALID_RESPONSE');
    return {ok:true,data:envelope.data,requestId:envelope.meta.requestId,replayed:envelope.meta.idempotencyReplayed===true};
  }
  return {execute};
}

export async function loadLocalToken(file){
  const fs=await import('node:fs');
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)))fail('UNSAFE_TOKEN_FILE');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(typeof value.token!=='string'||value.token.length<32)fail('LOCAL_TOKEN_REQUIRED');
  return value.token;
}

const direct=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(direct){
  if(process.argv.includes('--help'))console.log('通过 stdin 提交 JSON {intent,id?,platformCode?,query?,body?,requestKey?}。配置 WORKBENCH_URL / WORKBENCH_DATA_DIR 或 WORKBENCH_TOKEN_FILE；密钥不会输出。参阅同目录 SKILL.md。');
  else try{
    let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>2*1024*1024)fail('INPUT_TOO_LARGE');}
    const {intent,...input}=JSON.parse(text);
    const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const token=await loadLocalToken(process.env.WORKBENCH_TOKEN_FILE || path.join(process.env.WORKBENCH_DATA_DIR || path.join(projectRoot,'data'),'secrets.json'));
    const client=createWorkbuddyClient({baseUrl:process.env.WORKBENCH_URL || `http://127.0.0.1:${process.env.WORKBENCH_PORT || 5173}`,token});
    console.log(JSON.stringify(await client.execute(intent,input)));
  }catch(error){console.error(JSON.stringify({ok:false,code:error instanceof WorkbuddyError?error.code:'LOCAL_CLIENT_ERROR',message:error instanceof WorkbuddyError?error.message:'本地请求配置或输入无效，请检查服务、权限与 JSON。',requestId:error.requestId || null}));process.exitCode=1;}
}
