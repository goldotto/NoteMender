import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rename,unlink,rmdir,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pythonFor} from './python-runtime.mjs';
import {requestCompute} from './compute-runtime.mjs';
import {EVIDENCE_VERSION} from '../public/recognition-evidence.mjs';

async function readBody(req,limit){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw Error('分析请求过大');chunks.push(c);}return Buffer.concat(chunks);}
export async function runPitchAnalysis(root,bytes,engine,options={},signal){
  const python=await pythonFor(root);
  await mkdir(path.join(root,'runtime'),{recursive:true});
  const dir=await mkdtemp(path.join(root,'runtime','pitch-')),input=path.join(dir,'input.wav'),output=path.join(dir,'output.json');
  try{
    await writeFile(input,bytes);
    await new Promise((resolve,reject)=>{
      const child=spawn(python,[path.join(root,'scripts','pitch_analysis.py'),input,output,engine,String(options.minMidi??45),String(options.maxMidi??88)],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
      let message='',timedOut=false;child.stderr.on('data',c=>message=(message+c.toString()).slice(-1500));
      const abort=()=>child.kill(),timer=setTimeout(()=>{timedOut=true;abort();},180000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      child.once('error',e=>{cleanup();reject(Error('无法启动本机音高分析：'+e.message));});
      child.once('close',code=>{cleanup();code===0&&!signal?.aborted?resolve():reject(Error(signal?.aborted?'分析已取消':timedOut?'本机音高分析超时':message.trim()||'音高分析失败'));});
    });
    return JSON.parse(await readFile(output,'utf8'));
  }finally{await Promise.all([input,output].map(f=>unlink(f).catch(()=>{})));await rmdir(dir).catch(()=>{});}
}
export function analysisService(root,{nativeRunner,canStart=()=>true}={}){
  const cacheDir=path.join(root,'runtime','analysis-cache');let busy=false;
  async function trimCache(){
    const entries=await readdir(cacheDir),files=await Promise.all(entries.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async name=>({name,...await stat(path.join(cacheDir,name))})));
    let bytes=files.reduce((sum,f)=>sum+f.size,0);for(const f of files.sort((a,b)=>a.mtimeMs-b.mtimeMs)){if(bytes<=256*1024*1024)break;await unlink(path.join(cacheDir,f.name));bytes-=f.size;}
  }
  const handler=async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/analysis/'))return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    const match=/^\/api\/analysis\/cache\/([a-f0-9]{64})$/.exec(url.pathname);
    try{
      if(url.pathname==='/api/analysis/audits'&&req.method==='POST'){
        const value=JSON.parse(await readBody(req,32*1024*1024));if(value.version!==2||!Array.isArray(value.windows)||!Array.isArray(value.events))throw Error('无效分析诊断');
        const dir=path.join(root,'runtime','diagnostics'),id=randomUUID();await mkdir(dir,{recursive:true});await writeFile(path.join(dir,id+'.json'),JSON.stringify(value));send(200,{id});return true;
      }
      const audit=/^\/api\/analysis\/audits\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(audit&&req.method==='GET'){try{send(200,JSON.parse(await readFile(path.join(root,'runtime','diagnostics',audit[1]+'.json'),'utf8')));}catch(e){if(e.code==='ENOENT')send(404,{error:'诊断记录不存在'});else throw e;}return true;}
      if(match){
        const filename=path.join(cacheDir,match[1]+'.json');
        if(req.method==='GET'){try{const value=JSON.parse(await readFile(filename,'utf8'));send(200,value.version===EVIDENCE_VERSION?value:null);}catch(e){if(e.code==='ENOENT')send(200,null);else throw e;}return true;}
        if(req.method==='PUT'){
          const value=JSON.parse(await readBody(req,8*1024*1024));
          if(value.version!==EVIDENCE_VERSION||!Array.isArray(value.rawBasic)||!Array.isArray(value.pitchFrames))throw Error('无效分析证据');
          await mkdir(cacheDir,{recursive:true});const temp=path.join(cacheDir,randomUUID()+'.tmp');
          try{await writeFile(temp,JSON.stringify(value));await rename(temp,filename);}finally{await unlink(temp).catch(()=>{});}
          await trimCache();send(200,{ok:true});return true;
        }
        send(405,{error:'方法不支持'});return true;
      }
      if(url.pathname==='/api/analysis/pitch'&&req.method==='POST'){
        const compute=requestCompute(url),engine=url.searchParams.get('engine');if(!['pyin','crepe'].includes(engine))throw Error('不支持的实验音高引擎');
        const minMidi=Number(url.searchParams.get('minMidi')||45),maxMidi=Number(url.searchParams.get('maxMidi')||88);
        if(!Number.isInteger(minMidi)||!Number.isInteger(maxMidi)||minMidi<21||maxMidi>108||minMidi>=maxMidi)throw Error('无效音域');
        if(busy||!canStart()){send(429,{error:'已有音频分析运行中'});return true;}busy=true;
        const controller=new AbortController(),close=()=>{if(!res.writableEnded)controller.abort();};res.on('close',close);
        try{const bytes=await readBody(req,4*1024*1024);await mkdir(path.join(root,'runtime'),{recursive:true});send(200,await (compute.mode==='performance'&&nativeRunner?nativeRunner.analyse(bytes,'pitch',compute,{engine,minMidi,maxMidi},controller.signal):runPitchAnalysis(root,bytes,engine,{minMidi,maxMidi},controller.signal)));}
        finally{busy=false;res.off('close',close);}return true;
      }
      send(404,{error:'分析接口不存在'});
    }catch(e){send(400,{error:e.message});}return true;
  };
  handler.busy=()=>busy;return handler;
}
