import {access,readFile} from 'node:fs/promises';
import path from 'node:path';

export async function pythonFor(root){
  if(process.env.JIANPU_PYTHON)return process.env.JIANPU_PYTHON;
  try{
    await access(path.join(root,'runtime','portable-ready.json'));
    return path.join(root,'runtime','python','python.exe');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  try{
    const saved=(await readFile(path.join(root,'runtime','python-path.txt'),'utf8')).trim();
    if(saved)return saved;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return path.join(root,'.venv','Scripts','python.exe');
}
