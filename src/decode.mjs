import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,mkdir,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {pythonFor} from './python-runtime.mjs';

export async function decodeLocal(root,bytes,signal,mode='decode'){
  const runtime=path.join(root,'runtime');await mkdir(runtime,{recursive:true});
  const python=await pythonFor(root);
  const dir=await mkdtemp(path.join(runtime,'decode-'));
  const source=path.join(dir,'input.media'),output=path.join(dir,mode==='tempo'?'tempo.json':'decoded.wav');
  try{
    await writeFile(source,bytes);
    await new Promise((resolve,reject)=>{
      const child=spawn(python,[path.join(root,'scripts',mode==='tempo'?'measure_tempo.py':'decode_audio.py'),source,output],{windowsHide:true,stdio:'ignore'});
      const abort=()=>child.kill(),timer=setTimeout(abort,90000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      child.once('error',()=>reject(Error('本地解码环境未安装，请运行下载运行环境.cmd后重试。')));
      child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);code===0?resolve():reject(Error('本地解码失败：文件可能损坏、无音轨、超出 10 分钟，或缺少 PyAV 解码库。'));});
    });
    const data=await readFile(output);return mode==='tempo'?JSON.parse(data):data;
  }finally{await Promise.all([source,output].map(f=>unlink(f).catch(()=>{})));await rmdir(dir).catch(()=>{});}
}
