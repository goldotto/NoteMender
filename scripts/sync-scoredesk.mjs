
import {cp,lstat,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const [directory]=process.argv.slice(2);
if(!directory)throw Error('用法：先构建改谱台，再运行 node scripts/sync-scoredesk.mjs "<ScoreDesk 源码目录>"');
const source=await realpath(directory);
const dist=path.join(source,'out','dist'),target=path.join(root,'public','scoredesk');
const api='src/scoredesk-ai.mjs', script='scripts/sync-scoredesk.mjs', prefix='public/scoredesk/';
const fixed=[
  'index.html','LICENSE-Bravura.txt','LICENSE-Dolce.txt','LICENSE-ScoreDesk-resources.txt','THIRD-PARTY-NOTICES.txt',
  'redist/Bravura.otf','redist/Bravura.woff2','redist/BravuraText.otf','redist/bravura_metadata.json',
  'redist/soundfont/LICENSE.txt','redist/soundfont/acoustic_grand_piano-mp3.js',
];
const assetName=/^[A-Za-z0-9_.-]+\.(?:js|css)$/;
const assets=(await readdir(path.join(dist,'assets'),{withFileTypes:true}))
  .filter(entry=>entry.isFile()&&assetName.test(entry.name)).map(entry=>'assets/'+entry.name);
const html=await readFile(path.join(dist,'index.html'),'utf8');
const entrypoints=[...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map(match=>match[1]);
if(!html.includes('id="back-to-notemender"')||!entrypoints.some(name=>name.endsWith('.js'))||
   !entrypoints.some(name=>name.endsWith('.css'))||entrypoints.some(name=>!assets.includes(name))){
  throw Error('请先用支持内置页面的新版改谱台进行构建');
}
const files=[...fixed,...assets].sort();
for(const file of files){
  const filename=path.join(dist,file);
  if(!(await lstat(filename)).isFile()||await realpath(filename)!==filename)throw Error('构建文件无效 '+file);
}
const ai=path.join(source,'scripts','scoredesk-ai.mjs');
if(!(await lstat(ai)).isFile()||await realpath(ai)!==ai)throw Error('AI 服务源码无效');
const publicFiles=path.join(root,'scripts','public-files.json');
const previous=JSON.parse(await readFile(publicFiles,'utf8'));
async function copy(source,dest){
  const parent=path.dirname(dest);
  await mkdir(parent,{recursive:true});
  if(await realpath(parent)!==parent)throw Error('内置资源目录不能是目录链接');
  const existing=await lstat(dest).catch(error=>{if(error.code!=='ENOENT')throw error;});
  if(existing&&!existing.isFile())throw Error('内置资源路径必须是普通文件');
  await cp(source,dest);
}
for(const file of files)await copy(path.join(dist,file),path.join(target,file));
await copy(ai,path.join(root,api));
const next=new Set(files.map(file=>prefix+file));
for(const key of previous.filter(key=>key.startsWith(prefix+'assets/')&&!next.has(key))){
  const name=key.slice((prefix+'assets/').length);
  if(assetName.test(name))await rm(path.join(target,'assets',name),{force:true});
}
const list=new Set([...previous.filter(key=>!key.startsWith(prefix)&&key!=='src/scoredesk-launch.mjs'),api,script,...next]);
await writeFile(publicFiles,JSON.stringify([...list],null,2)+'\n');
console.log('已导入改谱台离线页面及许可：'+files.length+' 个文件。');

