import {readFile,writeFile,mkdir,lstat,realpath,open,unlink} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {makeZip} from '../src/update-zip.mjs';import {signedEnvelope,sha256,programPath,validateManifest,verifyEnvelope} from '../src/update-security.mjs';
export async function packageUpdate(root,output,{privateKey,version,build,releasedAt=new Date().toISOString(),previous=null,mirrors=[]}={}){
  const source=await realpath(root),dest=path.resolve(output);if(dest===source||dest.startsWith(source+path.sep))throw Error('更新输出必须位于源码目录之外');
  const current=JSON.parse(await readFile(path.join(root,'public/build-info.json'),'utf8')),trust=JSON.parse(await readFile(path.join(root,'public/update-trust.json'),'utf8'));
  version||=current.version;if(!Number.isSafeInteger(build)||build<=current.build)throw Error('必须明确指定高于当前源码的全新构建编号');
  const list=JSON.parse(await readFile(path.join(root,'scripts/public-files.json'),'utf8')),files=[];
  for(const name of list){if(name.startsWith('plugins/'))continue;programPath(name);const file=path.join(root,name);if((await lstat(file)).isSymbolicLink()||!(await realpath(file)).startsWith(source+path.sep))throw Error('公开清单包含目录链接');let data=await readFile(file);if(name==='public/build-info.json')data=Buffer.from(JSON.stringify({version,build,releasedAt,distribution:'portable',channel:version.includes('-')?'preview':'stable'},null,2)+'\n');files.push({path:name,data});}
  const zip=makeZip(files),name=`NoteMender-${version}-build-${build}-windows-update.zip`,manifest={format:'notemender-update-v1',version,build,releasedAt,channel:version.includes('-')?'preview':'stable',platform:'win32-x64',minNode:22,notes:await readFile(path.join(root,'RELEASE_NOTES.md'),'utf8'),package:{...(mirrors.length?{mirrors}:{}),url:mirrors[0]?.url||`https://github.com/goldotto/NoteMender/releases/download/v${version}/${name}`,size:zip.length,sha256:sha256(zip)},files:files.map(f=>({path:f.path,size:f.data.length,sha256:sha256(f.data)})),remove:[]};
  if(previous){const old=verifyEnvelope(previous,trust);if(old.build>=build)throw Error('构建编号没有递增');const next=new Set(files.map(f=>f.path));manifest.remove=old.files.filter(f=>!f.path.startsWith('public/models/')&&!next.has(f.path)).map(f=>f.path);}
  validateManifest(manifest);const envelope=signedEnvelope(manifest,privateKey,trust.keyId);verifyEnvelope(envelope,trust);
  await mkdir(dest);await writeFile(path.join(dest,name),zip,{flag:'wx'});await writeFile(path.join(dest,'NoteMender-update.json'),JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(dest,'installation-receipt.json'),JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});
  return {manifest,envelope};
}
export async function reserveBuild(ledger,build){
  if(!Number.isSafeInteger(build)||build<=0)throw Error('构建编号必须为正整数');
  const lock=ledger+'.lock';let handle;try{handle=await open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw Error('另一个签发进程正在运行；若上次中断，请先核对签发记录和锁文件');throw e;}
  try{let issued=[];try{issued=JSON.parse(await readFile(ledger,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}if(!Array.isArray(issued)||issued.some(n=>!Number.isSafeInteger(n)||n<=0))throw Error('构建签发记录损坏');if(issued.some(n=>n>=build))throw Error('构建编号已签发或低于已签发记录，不能复用');await writeFile(ledger,JSON.stringify([...issued,build]));}finally{await handle.close();await unlink(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [out,keyPath,buildText,previousPath,mirrorsPath]=process.argv.slice(2);if(!out||!keyPath||!buildText)throw Error('用法：node scripts/package-update.mjs D:\\输出新目录 D:\\私钥.pem 新构建编号 [上一构建清单.json 或 -] [镜像配置.json]');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),privateKey=await readFile(keyPath,'utf8'),ledger=path.join(path.dirname(keyPath),'issued-builds.json');const build=Number(buildText);
  // Reserve the number before producing files. Interrupted packaging must use a new number.
  await reserveBuild(ledger,build);const result=await packageUpdate(root,out,{privateKey,build,previous:previousPath&&previousPath!=='-'?JSON.parse(await readFile(previousPath,'utf8')):null,mirrors:mirrorsPath?JSON.parse(await readFile(mirrorsPath,'utf8')):[]});console.log(`程序更新包已生成：${result.manifest.files.length} 文件，${(result.manifest.package.size/1024/1024).toFixed(1)} MB；尚未发布更新索引。`);
}
