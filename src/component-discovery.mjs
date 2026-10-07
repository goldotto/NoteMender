import {access,readFile,readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {pythonFor} from './python-runtime.mjs';
import {componentBinding,audioRuntime} from './component-config.mjs';
import {terminateProcess} from './process-control.mjs';

// Model hashes are read from the pinned package manifest, rather than trusting a ready marker.
export async function modelSpecs(root){return JSON.parse(await readFile(path.join(root,'scripts','component-models.json'),'utf8'));}
async function exists(file){try{await access(file);return true;}catch{return false;}}
export function runProbe(command,args,{cwd,env=process.env,signal,timeout=60000,spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{
    const child=spawnImpl(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',ended=false;
    const abort=()=>terminateProcess(child).catch(()=>{}),timer=setTimeout(abort,timeout);signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>stdout=(stdout+chunk).slice(-65536));child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-2000));
    const cleanup=()=>{ended=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.once('error',error=>{cleanup();reject(error);});child.once('close',code=>{if(ended)return;cleanup();if(signal?.aborted)reject(new DOMException('操作已取消','AbortError'));else resolve({code,stdout,stderr});});
    if(signal?.aborted)abort();
  });
}
export async function componentLocation(root,id,{localOnly=false}={}){
  const binding=localOnly?null:await componentBinding(root,id),audio=localOnly?{modelHome:path.join(root,'runtime','models')}:await audioRuntime(root);
  const python=await pythonFor(root,{owned:localOnly});
  if(id==='audio'||id==='six'){
    const ownHome=path.join(root,'runtime','models'),spec=(await modelSpecs(root))[id],ownModel=spec&&await exists(path.join(ownHome,'hub','checkpoints',spec.file));
    return {python:binding?.python||python,modelHome:binding?.modelHome||(ownModel?ownHome:audio.modelHome),external:Boolean(binding)};
  }
  if(id==='gpu'||id==='cpu')return {python:binding?.python||python,directory:binding?.directory||path.join(root,'runtime','acceleration',id),external:Boolean(binding)};
  if(id==='lyrics'){
    const directory=binding?.directory||path.join(root,'runtime','lyrics-qwen'),models=JSON.parse(await readFile(path.join(root,'scripts','qwen-download-manifest.json'),'utf8'));
    return {python:binding?.python||python,directory,dependencies:binding?binding.dependencies:path.join(directory,'dependencies'),overlay:binding?.overlay,metadata:binding?.metadata,modelPaths:binding?.modelPaths||Object.fromEntries(Object.entries(models).map(([key,spec])=>[key,path.join(directory,'models',spec.folder)])),external:Boolean(binding)};
  }
  return {python:await pythonFor(root),directory:path.join(root,'runtime','singing'),external:false};
}
export async function inspectComponent(root,id,location,{deep=false,signal,run=runProbe}={}){
  const details={...location,component:id,deep};
  if(id==='audio'||id==='six')details.model=(await modelSpecs(root))[id];
  if(id==='lyrics'){details.models=JSON.parse(await readFile(path.join(root,'scripts','qwen-download-manifest.json'),'utf8'));details.lock=JSON.parse(await readFile(path.join(root,'scripts','qwen-lyrics-dependencies.lock.json'),'utf8'));}
  const overlays=[id==='lyrics'?location.dependencies:null,id==='singing'?path.join(location.directory,'dependencies'):null,location.overlay,(['cpu','gpu'].includes(id)?location.directory:null)].filter(Boolean);
  try{
    if(!await exists(location.python))return {ready:false,reason:'Python 运行环境尚未安装'};
    const result=await run(location.python,[path.join(root,'scripts','probe-components.py'),JSON.stringify(details)],{cwd:root,signal,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONPATH:[...overlays,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
    if(result.code!==0)return {ready:false,reason:result.stderr?.trim()||'组件启动失败'};
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  }catch(error){if(signal?.aborted)throw error;return {ready:false,reason:error.message};}
}
export async function discoverPython({consent=false,folder=null,run=runProbe}={}){
  if(consent!==true)throw Error('请先允许扫描本机已有环境');
  const candidates=new Set();
  function add(value){if(typeof value==='string'&&path.isAbsolute(value)&&path.basename(value).toLowerCase()==='python.exe')candidates.add(path.resolve(value));}
  if(folder){const base=path.resolve(folder);for(const relative of ['runtime/python/python.exe','.venv/Scripts/python.exe','python.exe','Scripts/python.exe'])add(path.join(base,relative));}
  else{
    for(const directory of (process.env.PATH||'').split(path.delimiter))if(directory&&path.isAbsolute(directory))add(path.join(directory,'python.exe'));
    for(const variable of ['VIRTUAL_ENV','CONDA_PREFIX'])if(process.env[variable]){add(path.join(process.env[variable],'python.exe'));add(path.join(process.env[variable],'Scripts','python.exe'));}
    if(process.platform==='win32'){
      try{const result=await run('py.exe',['-0p'],{timeout:8000});for(const line of result.stdout.split(/\r?\n/)){const match=line.match(/([A-Z]:\\.*python\.exe)\s*$/i);if(match)add(match[1]);}}catch{}
      for(const key of ['HKCU\\Software\\Python\\PythonCore','HKLM\\Software\\Python\\PythonCore'])try{const result=await run('reg.exe',['query',key,'/s','/v','ExecutablePath'],{timeout:8000});for(const line of result.stdout.split(/\r?\n/)){const match=line.match(/REG_SZ\s+(.+python\.exe)\s*$/i);if(match)add(match[1]);}}catch{}
    }
    const user=os.homedir();for(const base of [path.join(user,'miniconda3'),path.join(user,'anaconda3'),path.join(user,'AppData','Local','Programs','Python','Python311')])add(path.join(base,'python.exe'));
    for(const base of [path.join(user,'miniconda3','envs'),path.join(user,'anaconda3','envs')])try{for(const entry of (await readdir(base,{withFileTypes:true})).slice(0,24))if(entry.isDirectory())add(path.join(base,entry.name,'python.exe'));}catch{}
  }
  const files=[];for(const candidate of [...candidates].slice(0,40))if(await exists(candidate))files.push(candidate);return files;
}
export async function knownModelHomes(root,folder){
  const result=[path.join(root,'runtime','models')];if(folder)result.unshift(path.join(path.resolve(folder),'runtime','models'));
  else{if(process.env.TORCH_HOME)result.push(process.env.TORCH_HOME);result.push(path.join(os.homedir(),'.cache','torch'));}
  return [...new Set(result)];
}
export async function knownQwenPaths(root,folder){
  const manifest=JSON.parse(await readFile(path.join(root,'scripts','qwen-download-manifest.json'),'utf8')),directory=path.join(folder?path.resolve(folder):root,'runtime','lyrics-qwen');
  const paths=Object.fromEntries(Object.entries(manifest).map(([key,spec])=>[key,path.join(directory,'models',spec.folder)]));
  if(!folder){
    const cache=process.env.HF_HUB_CACHE||path.join(process.env.HF_HOME||path.join(os.homedir(),'.cache','huggingface'),'hub');
    for(const [key,spec] of Object.entries(manifest)){const snapshot=path.join(cache,'models--'+spec.repo.replace('/','--'),'snapshots',spec.hfRevision||spec.revision);if(await exists(path.join(snapshot,'model.safetensors')))paths[key]=snapshot;}
  }
  return {directory,modelPaths:paths};
}
