// Optional local component. Reuses the configured Python/Torch environment.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,rename,unlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {BEAT_THIS_SHA256} from '../src/downbeat-service.mjs';
import {pythonFor} from '../src/python-runtime.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),home=path.join(root,'runtime','beat-this');
const python=await pythonFor(root),exec=promisify(execFile);
const env={...process.env,TEMP:path.join(home,'temp'),TMP:path.join(home,'temp'),PYTHONDONTWRITEBYTECODE:'1'};
await mkdir(env.TEMP,{recursive:true});
await exec(python,['-c','import torch, torchaudio, numpy'],{env,windowsHide:true});
const filename=path.join(home,'small0.ckpt'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let bytes=await readFile(filename).catch(error=>{if(error.code!=='ENOENT')throw error;});
if(!bytes||hash(bytes)!==BEAT_THIS_SHA256){
  const urls=['https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt','https://f0k.de/pubs/2024_ismir/beat_this-small0.ckpt'];
  bytes=null;
  for(const url of urls){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw Error('HTTP '+response.status);
      const chunks=[];let size=0;
      for await(const chunk of response.body){
        size+=chunk.length;
        if(size>8451101)throw Error('unexpected size');
        chunks.push(chunk);
      }
      const data=Buffer.concat(chunks);
      if(hash(data)!==BEAT_THIS_SHA256)throw Error('SHA-256 mismatch');
      bytes=data;
      break;
    }catch(error){console.error(new URL(url).host+': '+error.message);}
  }
  if(!bytes)throw Error('Beat This! 模型下载失败或校验不一致。');
}
const overlay=path.join(home,'python');
await exec(python,['-m','pip','install','--no-cache-dir','--target',overlay,'--no-deps','--only-binary=:all:','beat-this==1.1.0','rotary-embedding-torch==0.9.2','einops==0.8.2','soxr==1.1.0'],{env,windowsHide:true,timeout:180000});
await exec(python,['-c','import sys; sys.path.insert(0, sys.argv[1]); from beat_this.inference import File2Beats',overlay],{env,windowsHide:true});
const temporary=filename+'.part-'+process.pid;
try{
  await writeFile(temporary,bytes,{flag:'wx'});
  await rename(temporary,filename);
}finally{await unlink(temporary).catch(()=>{});}
console.log('Beat This! small0 已就绪。');
