import {spawn} from 'node:child_process';
import {mkdtemp,readFile,mkdir,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {pythonFor} from './python-runtime.mjs';
import {writeAudioInput} from './audio-io.mjs';

export async function decodeLocal(root,input,signal,mode='decode',{spawnImpl=spawn}={}){
  const runtime=path.join(root,'runtime');await mkdir(runtime,{recursive:true});
  const python=await pythonFor(root);
  const dir=await mkdtemp(path.join(runtime,'decode-'));
  const source=path.join(dir,'input.media'),output=path.join(dir,mode==='tempo'?'tempo.json':'decoded.wav');
  try{
    const {size}=await writeAudioInput(input,source,{signal,hashInput:false,limit:120*1024*1024,tooLarge:'音频不能超过 120 MB'});
    if(!size)throw Error('音频为空');
    signal?.throwIfAborted();
    await new Promise((resolve,reject)=>{
      const child=spawnImpl(python,[path.join(root,'scripts',mode==='tempo'?'measure_tempo.py':'decode_audio.py'),source,output],{windowsHide:true,stdio:'ignore'});
      const abort=()=>child.kill(),timer=setTimeout(abort,90000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      child.once('error',()=>{cleanup();reject(Error('本地解码环境未安装，请运行Download-Components.cmd后重试。'));});
      child.once('close',code=>{cleanup();if(signal?.aborted)return reject(new DOMException('已取消','AbortError'));code===0?resolve():reject(Error('本地解码失败：文件可能损坏、无音轨、超出 10 分钟，或缺少 PyAV 解码库。'));});
    });
    const data=await readFile(output);return mode==='tempo'?JSON.parse(data):data;
  }finally{await Promise.all([source,output].map(f=>unlink(f).catch(()=>{})));await rmdir(dir).catch(()=>{});}
}
