import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {verifyEnvelope,sha256,allowedDownload} from '../src/update-security.mjs';
export async function verifyPublished(envelope,trust,{fetchImpl=fetch}={}){
  const manifest=verifyEnvelope(envelope,trust);
  async function download(url,limit){
    for(let i=0;i<6;i++){
      allowedDownload(url);const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(120000)});
      if([301,302,303,307,308].includes(response.status)){url=allowedDownload(new URL(response.headers.get('location'),url).href);continue;}
      if(!response.ok||response.status!==200)throw Error('公开附件尚不能完整下载，禁止公布索引');let size=0;const chunks=[];
      for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('公开附件大小不符');chunks.push(chunk);}return Buffer.concat(chunks);
    }throw Error('公开附件重定向次数过多');
  }
  for(const url of new Set([manifest.package.url,...(manifest.package.mirrors||[]).map(s=>s.url)])){
  const bytes=await download(url,manifest.package.size);if(bytes.length!==manifest.package.size||sha256(bytes)!==manifest.package.sha256)throw Error('公开附件哈希不符');
  const remote=JSON.parse((await download(url.replace(/[^/]+$/,'NoteMender-update.json'),3*1024*1024)).toString('utf8'));verifyEnvelope(remote,trust);
  if(remote.payload!==envelope.payload||remote.signature!==envelope.signature)throw Error('公开清单与待发布构建不一致');}return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const input=process.argv[2];if(!input)throw Error('用法：node scripts/verify-update-release.mjs D:\\更新输出\\NoteMender-update.json');
  const envelope=JSON.parse(await readFile(input,'utf8')),trust=JSON.parse(await readFile(new URL('../public/update-trust.json',import.meta.url),'utf8'));await verifyPublished(envelope,trust);
  await writeFile(path.join(path.dirname(input),'index.json'),JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});console.log('公开附件验证通过；index.json 可最后提交到仓库 updates/index.json。');
}
