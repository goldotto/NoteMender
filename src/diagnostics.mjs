import {BUILD} from './build-info.mjs';
import {mkdir,readFile,rename,stat,unlink,appendFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';

// Reports deliberately exclude request bodies, settings files and project data.
import {redact} from '../public/diagnostics-data.mjs';
export {redact};
const code=value=>/^[a-zA-Z0-9_.:-]{1,80}$/.test(value||'')?value:'unknown';
const numeric=value=>Number.isFinite(value)?Math.max(0,Math.round(value)):undefined;
export function safeEvent(input={}){
  const event={time:new Date().toISOString(),level:['info','warn','error'].includes(input.level)?input.level:'info',source:['browser','server','components'].includes(input.source)?input.source:'server',event:code(input.event)};
  for(const key of ['operation','component','state','method','backend'])if(input[key])event[key]=code(input[key]);
  for(const key of ['elapsedMs','status','line','column'])if(numeric(input[key])!==undefined)event[key]=numeric(input[key]);
  if(input.message)event.message=redact(input.message).slice(0,3000);
  if(input.stack)event.stack=redact(input.stack).slice(0,5000);
  return event;
}
export function diagnosticRoute(raw){
  const known=new Set(['api','muscriptor','result','midi','json','status','decode','tempo','plugins','invoke','export-file','components','lyrics','resources','singing','separation','compute','analysis','audio','other','bass','drums','instrumental','vocals','job','start','cancel','finish','scan','reuse','install','unlink','pitch','audits','analyse','transcribe','align','basic-pitch','diagnostics','event','report','clear','updates','client','session','check','settings','notes','history','download','prepare','abort-prepare','apply','restore-status']);
  try{const p=new URL(raw,'http://localhost').pathname;return p.startsWith('/api/')?p.split('/').map(x=>!x||known.has(x)?x:':id').join('/').slice(0,160):'/static';}catch{return '/invalid';}
}

export function createDiagnostics(root,{version=BUILD.version,build=BUILD.build,maxBytes=1024*1024,files=3,maxEvents=300}={}){
  const directory=path.join(root,'runtime','logs'),file=path.join(directory,'runtime.jsonl'),session=randomUUID();
  let events=[],queue=Promise.resolve(),storageError=false,counts=new Map();
  const ready=(async()=>{
    for(let i=files-1;i>=0;i--){try{for(const line of (await readFile(i?file+'.'+i:file,'utf8')).split('\n'))try{const value=JSON.parse(line);const clean=safeEvent(value);clean.time=/^\d{4}-\d{2}-\d{2}T/.test(value.time)?value.time:clean.time;events.push(clean);}catch{}}catch{}}
    events=events.slice(-maxEvents);
  })();
  async function persist(event){
    await mkdir(directory,{recursive:true});let size=0;try{size=(await stat(file)).size;}catch{}
    if(size+Buffer.byteLength(JSON.stringify(event))+1>maxBytes){
      await unlink(file+'.'+(files-1)).catch(()=>{});
      for(let i=files-2;i>=0;i--){const from=i?file+'.'+i:file;try{await rename(from,file+'.'+(i+1));}catch(error){if(error.code!=='ENOENT')throw error;}}
    }
    await appendFile(file,JSON.stringify(event)+'\n','utf8');
  }
  function record(input){
    const event=safeEvent(input),key=JSON.stringify({...event,time:undefined}),now=Date.now(),old=counts.get(key);
    if(old&&now-old<1000)return;
    counts.set(key,now);if(counts.size>500)counts=new Map([[key,now]]);
    queue=queue.then(()=>ready).then(async()=>{events.push(event);events=events.slice(-maxEvents);await persist(event);}).catch(()=>{storageError=true;});
  }
  async function snapshot(){await queue;await ready;return {version,build,session,storageError,environment:{platform:process.platform,architecture:process.arch,node:process.version,osRelease:os.release(),logicalCores:os.availableParallelism(),memoryGiB:Math.round(os.totalmem()/1024**3)},events:events.map(e=>({...e}))};}
  async function clear(){
    const operation=queue.then(async()=>{await ready;await mkdir(directory,{recursive:true});
      for(let i=0;i<files;i++)await unlink(i?file+'.'+i:file).catch(error=>{if(error.code!=='ENOENT')throw error;});
      events=[];counts.clear();storageError=false;
    });queue=operation.catch(()=>{storageError=true;});return operation;
  }
  async function report({description='',steps='',expected='',browser='',view=''}={}){
    const snapshotValue=await snapshot();let updates=[];try{const rows=JSON.parse(await readFile(path.join(root,'runtime/updates/history.json'),'utf8'));if(Array.isArray(rows))updates=rows.slice(-5).map(h=>({at:h.at,from:numeric(h.from?.build),to:numeric(h.to?.build),result:code(h.result),phase:redact(h.phase||'').slice(0,120),reason:redact(h.reason||'').slice(0,600)}));}catch{}return {format:'NoteMender-error-report-v1',reportId:randomUUID(),createdAt:new Date().toISOString(),...snapshotValue,updates,feedback:{description:redact(description),steps:redact(steps),expected:redact(expected)},browser:redact(browser).slice(0,300),view:redact(view).slice(0,120)};
  }
  function close(){return queue;}
  record({event:'service.start',message:'本机日志启用；无自动上传'});
  return {record,snapshot,clear,report,close};
}

export function diagnosticsService(logger){
  let budget=0,windowStart=0;
  return async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/diagnostics/'))return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    try{
      if(url.pathname==='/api/diagnostics/status'&&req.method==='GET'){send(200,await logger.snapshot());return true;}
      if(req.method!=='POST'){send(405,{error:'方法不支持'});return true;}
      let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24*1024){send(413,{error:'报告内容过长'});return true;}chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{send(400,{error:'无效 JSON'});return true;}
      if(!body||typeof body!=='object'||Array.isArray(body)){send(400,{error:'无效报告'});return true;}
      if(url.pathname==='/api/diagnostics/event'){
        const now=Date.now();if(now-windowStart>60000){budget=0;windowStart=now;}if(++budget>120){send(429,{error:'重复日志过多'});return true;}
        if(body.source!=='browser'){send(400,{error:'无效日志来源'});return true;}
        logger.record({...body,source:'browser'});send(200,{ok:true});return true;
      }
      if(url.pathname==='/api/diagnostics/report'){
        for(const key of ['description','steps','expected','browser','view'])if(body[key]!==undefined&&(typeof body[key]!=='string'||body[key].length>6000)){send(400,{error:'反馈文字过长或格式不正确'});return true;}
        send(200,await logger.report(body));return true;
      }
      if(url.pathname==='/api/diagnostics/clear'){await logger.clear();send(200,{ok:true});return true;}
      send(404,{error:'接口不存在'});
    }catch{send(500,{error:'日志暂时无法读取或清理；程序仍可继续使用'});}return true;
  };
}
