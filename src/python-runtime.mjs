import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {componentBinding} from './component-config.mjs';

export async function pythonFor(root,{owned=process.env.NOTEMENDER_INSTALL_MANAGED==='1'}={}){
  // The installer may read from a validated interpreter while writing overlays
  // exclusively into this project. This override is supplied only to its child.
  if(owned&&process.env.NOTEMENDER_INSTALL_PYTHON)return process.env.NOTEMENDER_INSTALL_PYTHON;
  const binding=owned?null:await componentBinding(root,'audio');
  if(binding?.python)return binding.python;
  if(!owned&&process.env.JIANPU_PYTHON)return process.env.JIANPU_PYTHON;
  const local=path.join(root,'.venv','Scripts','python.exe');
  try{await access(local);return local;}catch{}
  try{
    const saved=(await readFile(path.join(root,'runtime','python-path.txt'),'utf8')).trim();
    if(saved&&(!owned||path.resolve(saved).startsWith(path.resolve(root)+path.sep)))return saved;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const bundled=path.join(root,'runtime','python','python.exe');
  try{await access(bundled);return bundled;}catch{}
  return (!owned&&(await componentBinding(root,'python'))?.python)||local;
}
