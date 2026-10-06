import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';

const ID=/^[a-z][a-z0-9-]{0,47}$/;

export async function pluginManifest(directory,id){
  if(!ID.test(id))throw Error('无效插件 ID');
  const data=JSON.parse(await readFile(path.join(directory,`${id}.json`),'utf8'));
  if(data.id!==id||typeof data.name!=='string'||data.name.length>80||!Number.isInteger(data.port)||data.port<1024||data.port>65535)throw Error('插件清单无效');
  return {id:data.id,name:data.name,port:data.port};
}

export async function listPlugins(directory){
  let files;try{files=await readdir(directory);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const found=await Promise.all(files.filter(name=>name.endsWith('.json')&&ID.test(name.slice(0,-5))).map(async name=>{
    try{return await pluginManifest(directory,name.slice(0,-5));}catch{return null;}
  }));
  return found.filter(Boolean).map(({id,name})=>({id,name}));
}

export async function invokePlugin(directory,id,body,{fetchImpl=fetch,signal}={}){
  const plugin=await pluginManifest(directory,id);
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('插件请求需要 JSON 对象');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),60000);
  const onAbort=()=>controller.abort();signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted)onAbort();
  try{
    const response=await fetchImpl(`http://127.0.0.1:${plugin.port}/invoke`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const raw=await response.text();if(raw.length>6*1024*1024)throw Error('插件响应过大');
    let value;try{value=JSON.parse(raw);}catch{throw Error('插件没有返回有效 JSON');}
    if(!response.ok)throw Error(typeof value.error==='string'?value.error:'插件调用失败');
    return value;
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);}
}
