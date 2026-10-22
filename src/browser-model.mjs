import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {componentBinding} from './component-config.mjs';
import {sha256} from './update-security.mjs';

export async function browserModelDirectory(root,{localOnly=false}={}){
  const owned=path.join(root,'runtime/models/browser-basic-pitch');
  if(localOnly)return owned;
  try{await access(path.join(owned,'model.json'));return owned;}catch{}
  const binding=await componentBinding(root,'basic');if(binding?.directory)return binding.directory;
  // Old development snapshots and portable packages keep this URL-compatible layout.
  return path.join(root,'public/models/basic-pitch');
}
export async function inspectBrowserModel(root,location){
  try{
    const specs=JSON.parse(await readFile(path.join(root,'scripts/browser-model-manifest.json'),'utf8'));
    for(const spec of specs.files){const data=await readFile(path.join(location.directory,spec.file));if(data.length!==spec.size||sha256(data)!==spec.sha256)throw Error('扒谱模型缺失或校验失败');}
    return {ready:true};
  }catch(error){return {ready:false,reason:error.code==='ENOENT'?'扒谱模型尚未安装':error.message};}
}
