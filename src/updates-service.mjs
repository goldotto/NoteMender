import path from 'node:path';
import {readFile,writeFile,mkdir,stat,rename,copyFile,open,unlink,lstat,realpath,readdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {BUILD} from './build-info.mjs';
import {verifyEnvelope,allowedDownload,downloadSource,compareBuild,sha256,MAX_PACKAGE} from './update-security.mjs';
import {atomicJSON,preflight,extractVerified,updatePath} from './update-install.mjs';
import {updateIndexes,packageSources} from './update-sources.mjs';
const DEFAULT_SOURCES=JSON.parse(await readFile(new URL('../public/distribution.json',import.meta.url),'utf8'));
const RELEASES='https://api.github.com/repos/goldotto/NoteMender/releases?per_page=10';
const HOURS=6*3600000;
export function createUpdates(root,{current=BUILD,fetchImpl=fetch,canStart=()=>true,onApply=()=>{},record=()=>{},trust:providedTrust,sources=DEFAULT_SOURCES,now=()=>Date.now(),platform=process.platform,arch=process.arch}={}){
  const dir=path.join(root,'runtime/updates');let trust,settings={automatic:true,source:'auto'},cache={},history=[],checkPromise=null,download=null,controller=null,challenge=null,applying=false,downloadStarting=false,preparing=false,lastError='',checkState='unchecked',retryAt=0,restored=new Set();const clients=new Map();
  const ready=(async()=>{trust=providedTrust||JSON.parse(await readFile(new URL('../public/update-trust.json',import.meta.url),'utf8'));for(const [file,put] of [['settings.json',x=>settings={automatic:x.automatic!==false,source:['auto','domestic','github'].includes(x.source)?x.source:'auto'}],['cache.json',x=>cache=x],['history.json',x=>history=Array.isArray(x)?x:[]]])try{put(JSON.parse(await readFile(path.join(dir,file),'utf8')));}catch{}if(cache.envelope)try{verifyEnvelope(cache.envelope,trust);}catch{cache={};}retryAt=Number(cache.retryAt)||0;})();
  async function managed(){await updatePath(root);await mkdir(dir,{recursive:true});}
  const candidate=()=>cache.envelope?verifyEnvelope(cache.envelope,trust):null;
  const currentValid=Boolean(typeof current.version==='string'&&/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(current.version)&&Number.isSafeInteger(current.build)&&current.build>0);
  async function request(url,{headers={},signal,max=2*1024*1024}={}){
    for(let i=0;i<6;i++){
      signal?.throwIfAborted();
      allowedDownload(url);const host=new URL(url).hostname;if((cache.hostRetry?.[host]||0)>now())throw Error('此更新源仍在限流等待期');const response=await fetchImpl(url,{headers:{'User-Agent':'NoteMender-Updater',...headers},redirect:'manual',signal:signal||AbortSignal.timeout(12000)});
      if([301,302,303,307,308].includes(response.status)){url=allowedDownload(new URL(response.headers.get('location'),url).href);continue;}
      if(response.status===429||response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||response.headers.has('retry-after'))){const after=response.headers.get('retry-after'),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;const deadline=Math.max(now()+60000,Number(after)>0?now()+Number(after)*1000:Number.isFinite(Date.parse(after))?Date.parse(after):reset||now()+15*60000);cache.hostRetry={...cache.hostRetry,[host]:deadline};if(downloadSource(url)==='github'){retryAt=deadline;cache.retryAt=retryAt;}throw Error('更新服务暂时限流，请稍后重试');}
      if(response.status===304)return {response};if(!response.ok)throw Object.assign(Error('更新源返回 HTTP '+response.status),{statusCode:response.status});
      if(Number(response.headers.get('content-length'))>max)throw Error('更新内容超过大小限制');return {response};
    }throw Error('更新下载重定向次数过多');
  }
  async function readJSONResponse(response){if(/text\/html|application\/xhtml/i.test(response.headers.get('content-type')||''))throw Error('更新清单地址返回登录页或错误网页');let size=0,chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw Error('更新清单过大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  async function check(automatic=false){
    if(!currentValid){checkState='failed';lastError='当前构建信息未核实，请手动更新基础程序';return status();}
    await ready;if(checkPromise){await checkPromise;return status();}if(now()<retryAt)throw Error('更新源限流中，请在 '+new Date(retryAt).toLocaleString('zh-CN')+' 后重试');if(automatic&&(!settings.automatic||now()-(cache.attemptedAt||0)<HOURS))return status();
    checkPromise=(async()=>{checkState='checking';lastError='';cache.attemptedAt=now();try{
      let envelope;try{let failure;for(const source of updateIndexes(sources,settings.source)){try{const {response}=await request(source.url,{headers:cache.index===source.url&&cache.etag?{'If-None-Match':cache.etag}:{}});if(response.status===304&&cache.index!==source.url)throw Error('更新源返回了不匹配的缓存结果');const received=response.status===304?cache.envelope:await readJSONResponse(response);verifyEnvelope(received,trust);envelope=received;cache.etag=response.headers.get('etag')||(response.status===304?cache.etag:null);cache.index=source.url;cache.source=source.id;break;}catch(error){failure=error;if(now()<retryAt)break;}}if(!envelope)throw failure;}
      catch(primary){if(settings.source==='domestic'||now()<retryAt)throw primary;try{const {response}=await request(RELEASES);const releases=await readJSONResponse(response);if(!Array.isArray(releases))throw Error('备用更新索引无效');let matched,invalid;
        for(const release of releases.filter(r=>!r.draft)){const asset=release.assets?.find(a=>a.name==='NoteMender-update.json');if(!asset)continue;try{const r=await request(allowedDownload(asset.browser_download_url));const e=await readJSONResponse(r.response),m=verifyEnvelope(e,trust);if(!matched||compareBuild(m,verifyEnvelope(matched,trust))>0)matched=e;}catch(e){if(now()<retryAt)throw e;invalid=e;}}
        if(!matched){if(invalid)throw invalid;if(primary.statusCode===404)throw Object.assign(Error('仓库尚未发布签名自动更新清单；当前可在 GitHub Releases 手动下载。此状态不代表已是最新。'),{unavailable:true});throw Error('发布页未提供签名自动更新附件');}envelope=matched;cache.etag=null;cache.source='github';cache.index=null;
      }catch(backup){if(backup.unavailable)throw backup;throw Error((primary.statusCode===404?'主更新索引尚未发布（HTTP 404）':('主更新索引：'+primary.message))+'；备用发布查询：'+backup.message);}
      }
      const m=verifyEnvelope(envelope,trust);cache={...cache,envelope,checkedAt:now(),attemptedAt:now(),retryAt:0};checkState=compareBuild(m,current)>0?'available':'latest';record({event:'update.checked',state:checkState});
    }catch(e){checkState=e.unavailable?'unavailable':'failed';lastError=e.message;record({event:'update.check-failed',level:'warn',message:e.message});}finally{await managed();await atomicJSON(path.join(dir,'cache.json'),cache);}})().finally(()=>checkPromise=null);await checkPromise;return status();
  }
  async function status(){await ready;try{history=JSON.parse(await readFile(path.join(dir,'history.json'),'utf8'));}catch{}const m=candidate();return {current,state:checkState,error:lastError,automatic:settings.automatic,source:settings.source,checkedSource:cache.source||null,sources,checkedAt:cache.checkedAt||null,retryAt:retryAt||null,latest:m?{version:m.version,build:m.build,releasedAt:m.releasedAt,notes:m.notes,size:m.package.size,minNode:m.minNode,available:currentValid&&compareBuild(m,current)>0}:null,download:download?{...download,envelope:undefined}:null,challenge:challenge?{id:challenge.id,expiresAt:challenge.expiresAt,ready:clients.size>0&&[...clients.values()].every(c=>c.ack===challenge.id),clients:[...clients.values()].map(c=>({id:c.id,saved:c.ack===challenge.id,error:c.error||'',lastSeen:c.at}))}:null,applying,history};}
  async function startDownload(){
    await ready;if(downloadStarting||download&&['downloading','verifying'].includes(download.state))throw Error('更新正在下载');if(applying||preparing||challenge)throw Error('更新正在准备或安装');const m=candidate();if(!m||compareBuild(m,current)<=0)throw Error('请先检查可用更新');if(m.platform!==platform+'-'+arch||m.minNode>Number(process.versions.node.split('.')[0]))throw Error('更新需要其他基础运行环境，请查看发布页');
    downloadStarting=true;try{await managed();controller=new AbortController();download={id:randomUUID(),state:'downloading',bytes:0,total:m.package.size,speed:0,stage:'准备下载',envelope:cache.envelope};}finally{downloadStarting=false;}const task=download,signal=controller.signal;
    (async()=>{try{const part=await updatePath(root,m.package.sha256+'.part'),complete=await updatePath(root,m.package.sha256+'.zip');
      let offset=0;try{offset=(await stat(part)).size;}catch{}try{if((await stat(complete)).size===m.package.size&&sha256(await readFile(complete))===m.package.sha256){task.state='verifying';task.stage='复用已校验下载';await prepare();return;}}catch{}
      if(offset>=m.package.size){await unlink(part).catch(()=>{});offset=0;}task.bytes=offset;
      let completed=false,lastFailure;
      for(const source of packageSources(m,settings.source)){
        signal.throwIfAborted();task.source=source.id;task.stage='连接 '+(source.id==='domestic'?'国内源':'GitHub 备用源');
        try{
          try{offset=(await stat(part)).size;}catch{offset=0;}
          if(offset>=m.package.size){await unlink(part).catch(()=>{});offset=0;}
          task.bytes=offset;
          const r=(await request(source.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(600000)]),headers:offset?{Range:`bytes=${offset}-`}:{},max:MAX_PACKAGE})).response;
          if(/text\/html|application\/(?:json|xhtml)/i.test(r.headers.get('content-type')||''))throw Error('下载地址返回登录页或错误网页');
          if(offset&&r.status!==206){offset=0;task.bytes=0;}
          if(r.status===206&&r.headers.get('content-range')!==`bytes ${offset}-${m.package.size-1}/${m.package.size}`)throw Error('下载续传范围不匹配');
          const file=await open(part,offset?'a':'w'),started=now(),base=offset;try{for await(const c of r.body){signal.throwIfAborted();task.bytes+=c.length;if(task.bytes>m.package.size)throw Error('下载超过声明大小');await file.write(c);task.speed=Math.round((task.bytes-base)/Math.max(.001,(now()-started)/1000));task.stage='下载程序更新包';}await file.sync();}finally{await file.close();}
          signal.throwIfAborted();if(task.bytes!==m.package.size)throw Error('下载中断，保留进度并尝试备用源');
          if(sha256(await readFile(part))!==m.package.sha256){await unlink(part).catch(()=>{});throw Error('更新包 SHA-256 校验失败');}
          await rename(part,complete);completed=true;break;
        }catch(e){if(signal.aborted)throw e;lastFailure=e;task.stage=e.message+'；尝试其他已签名来源';}
      }
      if(!completed)throw lastFailure;await prepare();
      async function prepare(){signal.throwIfAborted();task.bytes=m.package.size;task.state='verifying';task.stage='检查文件与构建';const stage=await updatePath(root,task.id,'stage');await extractVerified(complete,m,stage);signal.throwIfAborted();task.state='ready';task.stage='下载已验证，等待安装';}
    }catch(e){task.state=signal.aborted?'cancelled':'failed';task.error=signal.aborted?'已取消下载':e.message;record({event:'update.download',state:task.state,message:task.error});}})();return status();
  }
  async function beginPrepare(id){await ready;if(download?.id!==id||download.state!=='ready'||applying||preparing)throw Error('请先完成更新包下载');if(!canStart())throw Error('请先结束识别或组件安装任务');preparing=true;try{const m=verifyEnvelope(download.envelope,trust);await preflight(root,m,trust,current,{platform,arch});challenge={id:randomUUID(),expiresAt:now()+120000};for(const c of clients.values()){c.ack=null;c.error='';}return await status();}finally{preparing=false;}}
  async function apply(id){
    if(applying||preparing||download?.id!==id||download.state!=='ready'||!challenge||now()>challenge.expiresAt||!clients.size||![...clients.values()].every(c=>c.ack===challenge.id))throw Error('仍有页面未完成保存或准备已过期，未安装更新');if(!canStart())throw Error('请结束运行中的任务后重试');
    applying=true;
    try{await preflight(root,verifyEnvelope(download.envelope,trust),trust,current,{platform,arch});const directory=await updatePath(root,download.id);for(const name of ['update-install.mjs','update-security.mjs','update-zip.mjs'])await copyFile(new URL('./'+name,import.meta.url),path.join(directory,name));await copyFile(new URL('../scripts/update-runner.mjs',import.meta.url),path.join(directory,'update-runner.mjs'));await atomicJSON(path.join(directory,'request.json'),{root,port:onApply.port(),pid:process.pid,current,trust,envelope:download.envelope,clientIds:[...clients.keys()]});await atomicJSON(path.join(dir,'restore.json'),{task:download.id,challenge:challenge.id,target:verifyEnvelope(download.envelope,trust).build,clients:[...clients.keys()]});
      await atomicJSON(path.join(dir,'pending.json'),{id:download.id});
      const child=spawn(process.execPath,[path.join(directory,'update-runner.mjs')],{cwd:directory,env:process.env,windowsHide:true,detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();setTimeout(()=>onApply(),350);return {ok:true};
    }catch(e){applying=false;throw e;}
  }
  async function session(id,data){await managed();if(!/^[a-f0-9-]{36}$/.test(id))throw Error('无效页面编号');await atomicJSON(await updatePath(root,'sessions',id+'.json'),data);}
  async function route(req,res,url,send,token){
    if(!url.pathname.startsWith('/api/updates/'))return false;if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}await ready;const action=url.pathname.slice('/api/updates/'.length);
    try{
      if(req.method==='GET'){
        if(action==='status'){send(200,await status());return true;}
        if(action==='notes'){send(200,{notes:await readFile(new URL('../RELEASE_NOTES.md',import.meta.url),'utf8')});return true;}
        if(action==='restore-status'){let r;try{r=JSON.parse(await readFile(path.join(dir,'restore.json'),'utf8'));}catch{}send(200,{ready:Boolean(r?.target===current.build&&r.clients?.length&&r.clients.every(id=>restored.has(id)))});return true;}
        if(action==='session'){const id=url.searchParams.get('id');if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('无效页面编号');let r=null;try{r=JSON.parse(await readFile(path.join(dir,'restore.json'),'utf8'));}catch{}if(!r?.clients.includes(id)){send(200,{session:null});return true;}send(200,{session:JSON.parse(await readFile(path.join(dir,'sessions',id+'.json'),'utf8')),target:r.target,task:r.task});return true;}
      }
      if(req.method!=='POST'){send(405,{error:'方法不支持'});return true;}let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>(action==='session'?96*1024*1024:24000)){send(413,{error:'更新请求过大，请先手动保存'});return true;}chunks.push(c);}const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');let result;
      if(action==='check')result=await check(Boolean(b.automatic));
      else if(action==='settings'){if(b.source!==undefined&&!['auto','domestic','github'].includes(b.source))throw Error('更新来源无效');settings={automatic:b.automatic===undefined?settings.automatic:b.automatic!==false,source:b.source||settings.source};await managed();await atomicJSON(path.join(dir,'settings.json'),settings);result=await status();}
      else if(action==='download')result=await startDownload();
      else if(action==='cancel'){controller?.abort();result={ok:true};}
      else if(action==='prepare')result=await beginPrepare(b.id);
      else if(action==='abort-prepare'){if(applying)throw Error('安装已开始');challenge=null;result={ok:true};}
      else if(action==='apply')result=await apply(b.id);
      else if(action==='session'){if(!clients.has(b.id)||b.challenge!==challenge?.id)throw Error('保存请求已过期');await session(b.id,b.data);const c=clients.get(b.id);c.ack=b.challenge;c.error='';result={ok:true};}
      else if(action==='client'){
        if(!/^[a-f0-9-]{36}$/.test(b.id||''))throw Error('无效页面编号');if(b.close){if(!applying)clients.delete(b.id);}else if(!applying||clients.has(b.id)){if(!clients.has(b.id)&&clients.size>=30)throw Error('打开页面过多，请关闭其他页面');const c=clients.get(b.id)||{id:b.id};c.at=now();if(b.error)c.error=String(b.error).slice(0,200);clients.set(b.id,c);if(b.restored)restored.add(b.id);}result={challenge,applying,current};
      }else{send(404,{error:'更新接口不存在'});return true;}send(200,result);
    }catch(e){send(400,{error:e.message});}return true;
  }
  route.busy=()=>applying||preparing||Boolean(challenge&&now()<challenge.expiresAt);route.close=()=>controller?.abort();return route;
}
