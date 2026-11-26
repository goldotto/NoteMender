import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {pythonFor} from './python-runtime.mjs';


const MAX_WAV=54*1024*1024; // Up to 20 minutes of 22.05 kHz mono PCM.
export const BEAT_THIS_SHA256='6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function scan(root,bytes,signal){
  const home=path.join(root,'runtime','beat-this'),model=path.join(home,'small0.ckpt');
  let weights;
  try{weights=await readFile(model);}catch(error){if(error.code==='ENOENT')return {error:'component-missing',status:503};throw error;}
  if(sha(weights)!==BEAT_THIS_SHA256)return {error:'component-invalid',status:503};
  const python=await pythonFor(root);
  signal.throwIfAborted();
  const dir=await mkdtemp(path.join(home,'scan-')),audio=path.join(dir,'original.wav');
  try{
    await writeFile(audio,bytes,{signal});
    signal.throwIfAborted();
    const stdout=await new Promise((resolve,reject)=>{
      const child=execFile(python,[path.join(root,'scripts','measure-downbeats.py'),audio,model,path.join(home,'python')],{
        timeout:180000,maxBuffer:512*1024,windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4'}
      },(error,output)=>{
        signal.removeEventListener('abort',stop);
        if(error)reject(error);else resolve(output);
      });
      const stop=()=>child.kill();
      signal.addEventListener('abort',stop,{once:true});
    });
    return {...JSON.parse(stdout),model:'beat-this/small0'};
  }catch(error){
    if(signal.aborted)throw error;
    if(error.code==='ENOENT'||/ModuleNotFoundError/.test(error.stderr||''))return {error:'component-missing',status:503};
    if(error.killed)return {error:'analysis-timeout',status:504};
    return {error:'analysis-failed',status:422};
  }finally{await unlink(audio).catch(()=>{});await rmdir(dir).catch(()=>{});}
}

export function createDownbeatService(root,{canStart=()=>true,analyse=scan}={}){
  let pending=null,cached=null;
  async function handle(req,res,send,token){
    if(req.method!=='POST')return send(405,{error:'method'});
    if(req.headers['x-studio-token']!==token)return send(403,{error:'session'});
    if(!canStart()||pending)return send(429,{error:'busy'});
    const controller=new AbortController();
    pending=controller;
    const abort=()=>{if(!res.writableEnded)controller.abort();};
    res.once('close',abort);
    try{
      let size=0;
      const chunks=[];
      for await(const chunk of req){
        size+=chunk.length;
        if(size>MAX_WAV)return send(413,{error:'audio-too-long'});
        chunks.push(chunk);
      }
      const bytes=Buffer.concat(chunks);
      if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')return send(400,{error:'invalid-audio'});
      const key=sha(bytes);
      if(cached?.key===key)return send(200,cached.data);
      const data=await analyse(root,bytes,controller.signal);
      if(controller.signal.aborted)return;
      if(data.error)return send(data.status,{error:data.error});
      cached={key,data};
      return send(200,data);
    }catch{
      if(!controller.signal.aborted)return send(422,{error:'analysis-failed'});
    }finally{
      pending=null;
      res.off('close',abort);
    }
  }
  return {handle,busy:()=>Boolean(pending),close:()=>pending?.abort()};
}
