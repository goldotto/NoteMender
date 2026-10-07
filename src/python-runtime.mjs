import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {componentBinding} from './component-config.mjs';

export async function pythonFor(root,{owned=process.env.NOTEMENDER_INSTALL_MANAGED==='1'}={}){
  const binding=owned?null:await componentBinding(root,'audio');
  if(binding?.python)return binding.python;
  if(!owned&&process.env.JIANPU_PYTHON)return process.env.JIANPU_PYTHON;
  try{
    await access(path.join(root,'runtime','portable-ready.json'));
    return path.join(root,'runtime','python','python.exe');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  try{
    const saved=(await readFile(path.join(root,'runtime','python-path.txt'),'utf8')).trim();
    if(saved&&(!owned||path.resolve(saved).startsWith(path.resolve(root)+path.sep)))return saved;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const local=path.join(root,'.venv','Scripts','python.exe');
  try{await access(local);return local;}catch{}
  const bundled=path.join(root,'runtime','python','python.exe');
  try{await access(bundled);return bundled;}catch{}
  return (!owned&&(await componentBinding(root,'python'))?.python)||local;
}
