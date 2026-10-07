import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

// These machine-local references are never part of an exported score or release.
export async function componentConfig(root){
  try{const value=JSON.parse(await readFile(path.join(root,'runtime','component-settings.json'),'utf8'));return value.version===1?value:{version:1,bindings:{}};}
  catch(error){if(error.code==='ENOENT')return {version:1,bindings:{}};throw Error('组件配置损坏，请在组件管理中重新关联。');}
}
export async function saveComponentConfig(root,value){
  const directory=path.join(root,'runtime');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'component-settings.json');await writeFile(file+'.tmp',JSON.stringify({...value,version:1},null,2));await rename(file+'.tmp',file);
}
export async function componentBinding(root,id){
  if(process.env.NOTEMENDER_INSTALL_MANAGED==='1')return null;
  return (await componentConfig(root)).bindings?.[id]||null;
}
export async function audioRuntime(root){
  const binding=await componentBinding(root,'audio');
  return {python:binding?.python,modelHome:binding?.modelHome||path.join(root,'runtime','models')};
}
