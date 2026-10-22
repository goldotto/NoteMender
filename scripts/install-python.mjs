import {readFile,mkdir,writeFile,rename,lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensurePinnedFile} from './download-model.mjs';
import {readZip} from '../src/update-zip.mjs';
import {sha256} from '../src/update-security.mjs';
import {pythonFor} from '../src/python-runtime.mjs';
import {inspectComponent} from '../src/component-discovery.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const existing=await pythonFor(root);
if((await inspectComponent(root,'python',{python:existing},{deep:true})).ready){console.log('复用已验证的 Python 解释器，不修改外部环境');process.exit(0);}
const spec=JSON.parse(await readFile(path.join(root,'scripts/python-component.json'),'utf8'));
const zip=path.join(root,'runtime/downloads',spec.file);
await ensurePinnedFile({target:zip,spec,urls:spec.urls,cwd:root});
const entries=readZip(await readFile(zip),spec),stage=path.join(root,'runtime/python.new'),target=path.join(root,'runtime/python');
try{await lstat(target);throw Error('已有解释器不完整；请先将 runtime/python 改名备份后重试，程序不会覆盖未知文件');}catch(e){if(e.code!=='ENOENT')throw e;}
try{await lstat(stage);throw Error('上次安装留有 python.new；请检查并移走后重试');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(stage,{recursive:true});
try{
  for(const entry of entries){if(!entry.path.startsWith('public/python/'))throw Error('解释器文件路径无效');const expected=spec.files.find(f=>f.path===entry.path);if(sha256(entry.data)!==expected.sha256)throw Error('解释器文件校验失败');const file=path.join(stage,entry.path.slice('public/python/'.length));await mkdir(path.dirname(file),{recursive:true});await writeFile(file,entry.data,{flag:'wx'});}
  if(!(await inspectComponent(root,'python',{python:path.join(stage,'python.exe')},{deep:true})).ready)throw Error('新解释器无法启动');
  await rename(stage,target);
}catch(error){await rm(stage,{recursive:true,force:true});throw error;}
console.log('Python 已安装到当前程序目录');
