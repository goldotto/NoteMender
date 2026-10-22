import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,createHash} from 'node:crypto';import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,copyFile,unlink,readdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {signedEnvelope,verifyEnvelope,validateManifest,sha256,programPath,allowedDownload,compareBuild,verifyInstalled} from '../src/update-security.mjs';
import {makeZip,readZip} from '../src/update-zip.mjs';import {extractVerified,installTransaction,rollbackTransaction,preflight,pruneUpdates,updatePath} from '../src/update-install.mjs';import {createUpdates} from '../src/updates-service.mjs';import {feedbackMail,FEEDBACK_EMAIL} from '../public/feedback-mail.mjs';import {reportText} from '../public/diagnostics-ui.mjs';import {packageUpdate} from '../scripts/package-update.mjs';import {acquireServerLease} from '../src/server-lease.mjs';
import {verifyPublished} from '../scripts/verify-update-release.mjs';import {reserveBuild} from '../scripts/package-update.mjs';
import {updateIndexes,packageSources} from '../src/update-sources.mjs';
const keys=generateKeyPairSync('ed25519'),trust={keyId:'test',publicKey:keys.publicKey.export({type:'spki',format:'pem'})};
const info=build=>({version:'2.5.0-demo.7',build,releasedAt:'2026-10-18T00:00:00Z',distribution:'portable',channel:'preview'});
function fixture(build=2,extra=[],serverCode='export const build='+build+';'){const files=[{path:'server.mjs',data:Buffer.from(serverCode)},{path:'public/build-info.json',data:Buffer.from(JSON.stringify(info(build)))},...extra],zip=makeZip(files);const m={format:'notemender-update-v1',...info(build),platform:'win32-x64',minNode:22,notes:'修复与新增\n<script>不执行</script>',package:{url:'https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/test.zip',size:zip.length,sha256:sha256(zip)},files:files.map(f=>({path:f.path,size:f.data.length,sha256:sha256(f.data)})),remove:[]};return {files,zip,m,envelope:signedEnvelope(m,keys.privateKey,trust.keyId)};}
async function temporary(fn){const root=await mkdtemp(path.join(os.tmpdir(),'notemender-update-中文 空格-'));let failure;try{return await fn(root);}catch(e){failure=e;throw e;}finally{const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));try{await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(e){if(failure)throw new AggregateError([failure,e],failure.message+'; cleanup: '+e.message);throw e;}}}
async function installed(root,f=fixture(1)){await mkdir(path.join(root,'runtime/updates'),{recursive:true});for(const e of f.files){await mkdir(path.dirname(path.join(root,e.path)),{recursive:true});await writeFile(path.join(root,e.path),e.data);}await writeFile(path.join(root,'runtime/updates/installed.json'),JSON.stringify(f.envelope));return f;}
async function serve(root,fn,options={}){const updates=createUpdates(root,{current:info(1),trust,sources:{domesticIndex:null,githubIndex:"https://raw.githubusercontent.com/goldotto/NoteMender/main/updates/index.json"},...options});const app=http.createServer(async(req,res)=>{const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};if(!await updates(req,res,new URL(req.url,'http://localhost'),send,'test-token'))send(404,{});});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const request=async(action,body)=>{const r=await fetch(base+'/api/updates/'+action,{headers:{'X-Studio-Token':'test-token','Content-Type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return {status:r.status,value:await r.json()};};try{await fn(request,base);}finally{updates.close();await new Promise(r=>app.close(r));}}
const signedResponse=f=>new Response(JSON.stringify(f.envelope),{headers:{etag:'"test"'}});

test('bootstrap permits only absent pending index; missing recovery files and invalid locks block startup',()=>temporary(async root=>{
 await mkdir(path.join(root,'scripts'));await copyFile(new URL('../scripts/update-bootstrap.mjs',import.meta.url),path.join(root,'scripts/update-bootstrap.mjs'));
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'scripts/update-bootstrap.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);child.once('error',reject);child.once('exit',code=>resolve({code,stderr}));});
 assert.equal((await run()).code,0);await mkdir(path.join(root,'runtime/updates'),{recursive:true});await writeFile(path.join(root,'runtime/updates/pending.json'),JSON.stringify({id:randomUUID()}));let result=await run();assert.equal(result.code,1);assert.match(result.stderr,/更新恢复未完成/);await writeFile(path.join(root,'runtime/updates/install.lock'),'0');result=await run();assert.equal(result.code,1);assert.match(result.stderr,/更新锁记录无效/);
}));

test('build reservations cannot reuse a number or race another signing process',()=>temporary(async root=>{
 const ledger=path.join(root,'issued-builds.json');await reserveBuild(ledger,10);await assert.rejects(reserveBuild(ledger,10));await assert.rejects(reserveBuild(ledger,9));await assert.rejects(reserveBuild(ledger,NaN));await writeFile(ledger+'.lock','active');await assert.rejects(reserveBuild(ledger,11),/另一个/);await unlink(ledger+'.lock');const results=await Promise.allSettled([reserveBuild(ledger,11),reserveBuild(ledger,11)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(JSON.parse(await readFile(ledger,'utf8')),[10,11]);
}));
async function waitReady(request){for(let i=0;i<100;i++){const v=(await request('status')).value.download;if(['ready','failed','cancelled'].includes(v?.state))return v;await new Promise(r=>setTimeout(r,10));}throw Error('download timed out');}
test('signed manifests authenticate every field; invalid keys and oversized or conflicting files fail',()=>{
 const f=fixture();assert.equal(verifyEnvelope(f.envelope,trust).build,2);assert.throws(()=>verifyEnvelope({...f.envelope,payload:f.envelope.payload+'a'},trust));assert.throws(()=>verifyEnvelope({...f.envelope,keyId:'other'},trust));assert.throws(()=>validateManifest({...f.m,files:[...f.m.files,...f.m.files]}));assert.throws(()=>validateManifest({...f.m,remove:['runtime/component-settings.json']}));assert.throws(()=>validateManifest({...f.m,package:{...f.m.package,size:300*1024*1024}}));assert.throws(()=>validateManifest({...f.m,files:f.m.files.map(x=>({...x,size:2**31}))}));
});
test('build comparison supports same-tag revisions, preview numbers and stable versions',()=>{
 assert.equal(compareBuild(info(2),info(1)),1);assert.equal(compareBuild(info(1),info(2)),-1);assert.equal(compareBuild({version:'2.5.0-demo.10',build:1},{version:'2.5.0-demo.9',build:99}),1);assert.equal(compareBuild({version:'2.5.0',build:1},info(999)),1);assert.equal(compareBuild(info(1),info(1)),0);
});
test('unsafe Windows filenames, traversal, external URLs and private directories are rejected',()=>{
 for(const p of ['../x','C:/x','public\\x','public/../x','public/con.txt','public/x.','runtime/test','exports/x','plugins/test','public/x:stream','public//x','.env'])assert.throws(()=>programPath(p),p);
 for(const u of ['http://github.com/x','https://github.com.evil/x','https://u:p@github.com/x','file:///x','https://127.0.0.1/x'])assert.throws(()=>allowedDownload(u));assert.ok(allowedDownload(fixture().m.package.url));
});
test('ZIP parsing checks CRC, central/local agreement, symlinks and extra entries',()=>{
 const f=fixture();assert.equal(readZip(f.zip,f.m).length,2);const bad=Buffer.from(f.zip);bad[35]^=1;assert.throws(()=>readZip(bad,f.m));const link=Buffer.from(f.zip);const at=link.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));link.writeUInt32LE((0xa1ff<<16)>>>0,at+38);assert.throws(()=>readZip(link,f.m));assert.throws(()=>readZip(f.zip,{files:f.m.files.slice(1)}));assert.throws(()=>readZip(f.zip.subarray(0,-1),f.m));
});
test('extraction checks whole ZIP hash and exact build before making a usable stage',()=>temporary(async root=>{
 const f=fixture(),file=path.join(root,'test.zip');await writeFile(file,f.zip);await extractVerified(file,f.m,path.join(root,'stage'));assert.equal(await readFile(path.join(root,'stage/server.mjs'),'utf8'),'export const build=2;');await assert.rejects(extractVerified(file,{...f.m,package:{...f.m.package,sha256:'0'.repeat(64)}},path.join(root,'bad')));await assert.rejects(extractVerified(file,{...f.m,build:10},path.join(root,'bad-build')));
}));
test('installation validates current files, protects development directories, unknown files and non-owned removal',()=>temporary(async root=>{
 await installed(root);await verifyInstalled(root,trust,info(1));await assert.rejects(verifyInstalled(root,trust,{...info(1),distribution:'development'}));const f=fixture(2,[{path:'public/unknown.txt',data:Buffer.from('new')}]);await writeFile(path.join(root,'public/unknown.txt'),'private');await assert.rejects(preflight(root,f.m,trust,info(1),{platform:'win32',arch:'x64'}));await writeFile(path.join(root,'server.mjs'),'manually changed');await assert.rejects(verifyInstalled(root,trust,info(1)));
}));
test('install and rollback preserve private runtime, exports, settings and outside program files',()=>temporary(async root=>{
 await installed(root);await writeFile(path.join(root,'runtime/component-settings.json'),'external-env');await mkdir(path.join(root,'exports'));await writeFile(path.join(root,'exports/user.json'),'personal');const f=fixture(2),dir=path.join(root,'runtime/updates',randomUUID()),zip=path.join(root,'zip');await writeFile(zip,f.zip);await extractVerified(zip,f.m,path.join(dir,'stage'));const tx=await installTransaction(root,dir,f.envelope,trust);assert.equal(tx.state,'awaiting-health');assert.match(await readFile(path.join(root,'server.mjs'),'utf8'),/build=2/);await rollbackTransaction(root,dir,tx);assert.match(await readFile(path.join(root,'server.mjs'),'utf8'),/build=1/);assert.equal(await readFile(path.join(root,'runtime/component-settings.json'),'utf8'),'external-env');assert.equal(await readFile(path.join(root,'exports/user.json'),'utf8'),'personal');
}));
test('failure at each replacement restores all original files and removes newly created files',async()=>{
 for(let fail=0;fail<3;fail++)await temporary(async root=>{const old=await installed(root);const f=fixture(2,[{path:'public/new.txt',data:Buffer.from('new')}]),dir=path.join(root,'runtime/updates',randomUUID()),zip=path.join(root,'zip');await writeFile(zip,f.zip);await extractVerified(zip,f.m,path.join(dir,'stage'));await assert.rejects(installTransaction(root,dir,f.envelope,trust,{fault:(_s,i)=>{if(i===fail)throw Error('injected interruption');}}));for(const e of old.files)assert.deepEqual(await readFile(path.join(root,e.path)),e.data);await assert.rejects(readFile(path.join(root,'public/new.txt')));});
});
test('interrupted transaction journal can be rolled back after replacing process exits',()=>temporary(async root=>{
 await installed(root);const f=fixture(2),dir=path.join(root,'runtime/updates',randomUUID()),zip=path.join(root,'zip');await writeFile(zip,f.zip);await extractVerified(zip,f.m,path.join(dir,'stage'));await installTransaction(root,dir,f.envelope,trust);const persisted=JSON.parse(await readFile(path.join(dir,'transaction.json'),'utf8'));await rollbackTransaction(root,dir,persisted);await verifyInstalled(root,trust,info(1));
}));
test('check state distinguishes available, latest, offline failure; coalesces concurrent and automatic checks',()=>temporary(async root=>{
 let calls=0;await serve(root,async request=>{await Promise.all([request('check',{}),request('check',{})]);assert.equal((await request('status')).value.state,'available');assert.equal(calls,1);await request('check',{automatic:true});assert.equal(calls,1);await request('settings',{automatic:false});assert.equal((await request('status')).value.automatic,false);},{fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return signedResponse(fixture());}});
 await serve(root,async request=>{const x=await request('check',{});assert.equal(x.value.state,'latest');},{fetchImpl:async()=>signedResponse(fixture(1))});
 await serve(root,async request=>{const x=await request('check',{});assert.equal(x.value.state,'failed');assert.ok(x.value.latest);},{fetchImpl:async()=>{throw Error('offline');}});
}));
test('rate limiting retains retry deadline and does not hammer API fallback',()=>temporary(async root=>{
 let calls=0;await serve(root,async request=>{assert.equal((await request('check',{})).value.state,'failed');assert.equal((await request('check',{})).status,400);assert.equal(calls,1);},{fetchImpl:async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'120'}});}});
}));
test('fallback includes prereleases and accepts only signed release attachments',()=>temporary(async root=>{
 const f=fixture();await serve(root,async request=>assert.equal((await request('check',{})).value.state,'available'),{fetchImpl:async url=>url.includes('raw.githubusercontent')?new Response('',{status:404}):url.includes('/repos/')?new Response(JSON.stringify([{prerelease:true,assets:[{name:'NoteMender-update.json',browser_download_url:'https://github.com/goldotto/NoteMender/releases/download/test/NoteMender-update.json'}]}])):signedResponse(f)});
}));
test('unpublished signed index differs from network failure and generic 403 is not called rate limiting',()=>temporary(async root=>{
  await serve(root,async request=>{const s=(await request('check',{})).value;assert.equal(s.state,'unavailable');assert.match(s.error,/尚未发布/);assert.equal(s.latest,null);},{fetchImpl:async url=>url.includes('raw.githubusercontent')?new Response('',{status:404}):new Response('[]')});
  await serve(root,async request=>{const s=(await request('check',{})).value;assert.equal(s.state,'failed');assert.match(s.error,/404/);assert.match(s.error,/403/);assert.equal(s.retryAt,null);},{fetchImpl:async url=>new Response('',{status:url.includes('raw.githubusercontent')?404:403})});
}));
test('download authenticates API, verifies package, requires all tabs to save and refuses arbitrary apply requests',()=>temporary(async root=>{
 await installed(root);const f=fixture();await serve(root,async(request,base)=>{
   assert.equal((await fetch(base+'/api/updates/status')).status,403);assert.equal((await request('apply',{id:'arbitrary',url:'https://evil'})).status,400);await request('check',{});await request('download',{});const d=await waitReady(request);assert.equal(d.state,'ready',d.error);
   const a=randomUUID(),b=randomUUID();await request('client',{id:a});await request('client',{id:b});const prep=await request('prepare',{id:d.id});assert.equal(prep.status,200,prep.value.error);const challenge=prep.value.challenge.id;assert.equal((await request('apply',{id:d.id})).status,400);
   await request('session',{id:a,challenge,data:{project:{notes:[]},candidate:{notes:[1]},lyricsPreview:[{text:'字'}]}});assert.equal((await request('status')).value.challenge.ready,false);await request('session',{id:b,challenge,data:{project:{notes:[]}}});assert.equal((await request('status')).value.challenge.ready,true);await request('abort-prepare',{});
 },{fetchImpl:async url=>url.endsWith('test.zip')?new Response(f.zip):signedResponse(f)});
}));
test('partial download resumes only with exact signed length and range; corrupt data fails safely',()=>temporary(async root=>{
 const f=fixture();await mkdir(path.join(root,'runtime/updates'),{recursive:true});await writeFile(path.join(root,'runtime/updates',f.m.package.sha256+'.part'),f.zip.subarray(0,30));let range;
 await serve(root,async request=>{await request('check',{});await request('download',{});assert.equal((await waitReady(request)).state,'ready');assert.equal(range,'bytes=30-');},{fetchImpl:async(url,options)=>{if(!url.endsWith('test.zip'))return signedResponse(f);range=options.headers.Range;return new Response(f.zip.subarray(30),{status:206,headers:{'content-range':`bytes 30-${f.zip.length-1}/${f.zip.length}`}});}});
}));
test('corrupt downloads and bad signatures do not mark an update ready',()=>temporary(async root=>{
 const f=fixture();await serve(root,async request=>{await request('check',{});await request('download',{});const d=await waitReady(request);assert.equal(d.state,'failed');assert.match(d.error,/校验|完整/);},{fetchImpl:async url=>url.endsWith('test.zip')?new Response(Buffer.alloc(f.zip.length)):signedResponse(f)});
 await serve(root,async request=>{assert.equal((await request('check',{})).value.state,'failed');},{fetchImpl:async()=>new Response(JSON.stringify({...f.envelope,signature:'bad'}))});
}));
test('mail feedback supports unicode, encodes fields and keeps full report out of mailto',()=>{
 const r={version:'2.5.0-demo.7',build:7,reportId:'id',feedback:{description:'中文 & # ? = 日本語 한국어'},events:[{message:'diagnostic-marker',time:'now'}]},text=reportText(r),url=feedbackMail(r,text);assert.equal(FEEDBACK_EMAIL,'goldotto@proton.me');assert.ok(url.startsWith('mailto:'+FEEDBACK_EMAIL));assert.match(decodeURIComponent(url),/中文 & # \? = 日本語 한국어/);assert.ok(!url.includes('diagnostic-marker'));assert.ok(!reportText(r,{includeLogs:false}).includes('diagnostic-marker'));assert.ok(feedbackMail(r,'字'.repeat(6000)).length<2000);
});

test('conditional requests reuse only verified cached manifests; missing build is not latest',()=>temporary(async root=>{
 let calls=0;await serve(root,async request=>{await request('check',{});await request('check',{});assert.equal((await request('status')).value.state,'available');},{fetchImpl:async(_url,options)=>{if(calls++){assert.equal(options.headers['If-None-Match'],'"test"');return new Response(null,{status:304});}return signedResponse(fixture());}});
 await serve(root,async request=>{const s=(await request('check',{})).value;assert.equal(s.state,'failed');assert.equal(s.latest.available,false);},{current:{version:info(1).version},fetchImpl:()=>{throw Error('must not request');}});
}));

test('resume restarts when range is ignored and rejects a mismatched range',()=>temporary(async root=>{
 const f=fixture(),part=path.join(root,'runtime/updates',f.m.package.sha256+'.part');await mkdir(path.dirname(part),{recursive:true});await writeFile(part,f.zip.subarray(0,17));
 await serve(root,async request=>{await request('check',{});await request('download',{});assert.equal((await waitReady(request)).state,'ready');},{fetchImpl:async url=>url.endsWith('test.zip')?new Response(f.zip):signedResponse(f)});
 await unlink(part.replace('.part','.zip'));await writeFile(part,f.zip.subarray(0,17));
 await serve(root,async request=>{await request('check',{});await request('download',{});assert.match((await waitReady(request)).error,/续传范围/);},{fetchImpl:async url=>url.endsWith('test.zip')?new Response(f.zip.subarray(17),{status:206,headers:{'content-range':'bytes 0-4/5'}}):signedResponse(f)});
}));

test('download cancellation and repeated clicks cannot create duplicate installations',()=>temporary(async root=>{
 let abortObserved=false,notify;const started=new Promise(r=>notify=r);await serve(root,async request=>{await request('check',{});const a=await request('download',{});assert.equal(a.status,200);await started;assert.equal((await request('download',{})).status,400);await request('cancel',{});assert.equal((await waitReady(request)).state,'cancelled');assert.ok(abortObserved);},{fetchImpl:async(url,{signal})=>{if(!url.endsWith('test.zip'))return signedResponse(fixture());return new Promise((_resolve,reject)=>{notify();if(signal.aborted){abortObserved=true;reject(signal.reason);return;}signal.addEventListener('abort',()=>{abortObserved=true;reject(signal.reason);},{once:true});});}});
}));

test('redirects and unsupported runtime cannot bypass validation',()=>temporary(async root=>{
 await serve(root,async request=>{assert.equal((await request('check',{})).value.state,'failed');},{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})});
 await serve(root,async request=>{await request('check',{});assert.equal((await request('download',{})).status,400);},{platform:'other',fetchImpl:async()=>signedResponse(fixture())});
}));

test('space shortage, linked data and concurrent server are blocked before replacement',()=>temporary(async root=>{
 await installed(root);await assert.rejects(preflight(root,fixture().m,trust,info(1),{platform:'win32',arch:'x64',diskUsage:async()=>({bavail:0,bsize:4096})}),/空间不足/);
 const release=await acquireServerLease(root,12345);try{await assert.rejects(acquireServerLease(root,12346),/已有程序/);}finally{release();}
 const outside=path.join(root,'outside');await mkdir(outside);await symlink(outside,path.join(root,'runtime/updates/sessions'),'junction');await assert.rejects(updatePath(root,'sessions','test.json'),/不能是链接/);await unlink(path.join(root,'runtime/updates/sessions'));
}));

test('program-only publisher creates a verifiable portable snapshot and preserves private exclusions',()=>temporary(async base=>{
 const root=path.join(base,'source');await mkdir(root);await installed(root);await mkdir(path.join(root,'scripts'));await writeFile(path.join(root,'public/update-trust.json'),JSON.stringify(trust));await writeFile(path.join(root,'RELEASE_NOTES.md'),'测试说明');await writeFile(path.join(root,'scripts/public-files.json'),JSON.stringify(['server.mjs','public/build-info.json','public/update-trust.json','RELEASE_NOTES.md','plugins/README.md']));
 const result=await packageUpdate(root,path.join(base,'out'),{privateKey:keys.privateKey,build:2});const m=verifyEnvelope(result.envelope,trust);assert.equal(m.build,2);assert.ok(!m.files.some(f=>/runtime|plugins/.test(f.path)));const bytes=await readFile(path.join(base,'out',path.basename(m.package.url)));assert.equal(readZip(bytes,m).length,4);assert.equal(JSON.parse(readZip(bytes,m).find(e=>e.path==='public/build-info.json').data).distribution,'portable');
 await assert.rejects(packageUpdate(root,path.join(base,'bad'),{privateKey:keys.privateKey,build:1}));
}));

function runningFixture(build,mode='ready'){
 const code=`import http from 'node:http';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import path from 'node:path';${mode==='exit'?'process.exit(1);':''}const instance=createHash('sha256').update(path.dirname(fileURLToPath(import.meta.url)).toLowerCase()).digest('hex').slice(0,16);const app=http.createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/stop'){res.on('finish',()=>{app.closeAllConnections();app.close(()=>process.exit(0));});res.end('{}');return;}res.end(JSON.stringify(req.url==='/api/status'?{...${JSON.stringify(info(build))},token:'fixture',instance}:{ready:${mode==='ready'}}));});app.listen(Number(process.env.PORT),'127.0.0.1');`;
 return fixture(build,[],code);
}
async function runnerTask(root,newFixture){
 await installed(root,runningFixture(1));const id=randomUUID(),directory=path.join(root,'runtime/updates',id);await mkdir(directory);const zip=path.join(root,'fixture.zip');await writeFile(zip,newFixture.zip);await extractVerified(zip,newFixture.m,path.join(directory,'stage'));
 for(const name of ['update-install.mjs','update-security.mjs','update-zip.mjs'])await copyFile(new URL('../src/'+name,import.meta.url),path.join(directory,name));await copyFile(new URL('../scripts/update-runner.mjs',import.meta.url),path.join(directory,'update-runner.mjs'));
 const dead=spawn(process.execPath,['-e',''],{windowsHide:true,stdio:'ignore'});await new Promise((r,j)=>{dead.once('exit',r);dead.once('error',j);});const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const config={root,port,pid:dead.pid,current:info(1),trust,envelope:newFixture.envelope};await writeFile(path.join(directory,'request.json'),JSON.stringify(config));await writeFile(path.join(root,'runtime/updates/pending.json'),JSON.stringify({id}));const {runUpdate}=await import(pathToFileURL(path.join(directory,'update-runner.mjs')).href);return {id,directory,port,config,run:options=>runUpdate(directory,{healthAttempts:12,healthInterval:60,...options})};
}
async function waitFixture(port){for(let i=0;i<100;i++){try{return await(await fetch('http://127.0.0.1:'+port+'/api/status',{signal:AbortSignal.timeout(100)})).json();}catch{await new Promise(r=>setTimeout(r,20));}}throw Error('fixture did not start');}
async function stopFixture(root,port){try{const s=await waitFixture(port);assert.equal(s.instance,createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,16));await(await fetch('http://127.0.0.1:'+port+'/stop')).json();for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:'+port+'/api/status',{signal:AbortSignal.timeout(100)});}catch{return;}await new Promise(r=>setTimeout(r,40));}}catch{}}

test('independent updater launches the exact new build on the same port without touching private data',()=>temporary(async root=>{
 const task=await runnerTask(root,runningFixture(2));await writeFile(path.join(root,'runtime/private-project.json'),'keep');try{assert.equal((await task.run()).result,'success');assert.equal((await waitFixture(task.port)).build,2);assert.equal(await readFile(path.join(root,'runtime/private-project.json'),'utf8'),'keep');await assert.rejects(readFile(path.join(root,'runtime/updates/pending.json')));assert.equal(JSON.parse(await readFile(path.join(task.directory,'transaction.json'))).state,'complete');}finally{await stopFixture(root,task.port);}
}));

test('startup failure and unsuccessful restore both roll back and restart the old build',async()=>{
 for(const mode of ['exit','not-restored'])await temporary(async root=>{const task=await runnerTask(root,runningFixture(2,mode));try{assert.equal((await task.run()).result,'rolled-back');assert.equal((await waitFixture(task.port)).build,1);await verifyInstalled(root,trust,info(1));const h=JSON.parse(await readFile(path.join(root,'runtime/updates/history.json')));assert.equal(h.at(-1).result,'rolled-back');}finally{await stopFixture(root,task.port);}});
});

test('failed rollback retains pending recovery index and succeeds after the blocked file is repaired',()=>temporary(async root=>{
 const f=runningFixture(2),task=await runnerTask(root,f);await installTransaction(root,task.directory,f.envelope,trust);const backup=path.join(task.directory,'backup/server.mjs'),saved=await readFile(backup);await unlink(backup);task.config.recover=true;await writeFile(path.join(task.directory,'request.json'),JSON.stringify(task.config));
 await assert.rejects(task.run(),/恢复未完成/);assert.equal(JSON.parse(await readFile(path.join(root,'runtime/updates/pending.json'))).id,task.id);await writeFile(backup,saved);
 try{assert.equal((await task.run()).result,'rolled-back');assert.equal((await waitFixture(task.port)).build,1);await assert.rejects(readFile(path.join(root,'runtime/updates/pending.json')));}finally{await stopFixture(root,task.port);}
}));

test('active installer lock is not cleared or logged over by a second installer',()=>temporary(async root=>{
 const task=await runnerTask(root,runningFixture(2));await writeFile(path.join(root,'runtime/updates/install.lock'),String(process.pid));await assert.rejects(task.run(),/另一个更新进程/);assert.equal(await readFile(path.join(root,'runtime/updates/install.lock'),'utf8'),String(process.pid));await assert.rejects(readFile(path.join(root,'runtime/updates/history.json')));
}));

test('obsolete updater program copies are pruned while latest rollback and unknown files stay',()=>temporary(async root=>{
 await installed(root);const f=fixture(2),id=randomUUID(),dir=path.join(root,'runtime/updates',id),zip=path.join(root,'zip');await writeFile(zip,f.zip);await extractVerified(zip,f.m,path.join(dir,'stage'));const tx=await installTransaction(root,dir,f.envelope,trust);tx.state='complete';await writeFile(path.join(dir,'transaction.json'),JSON.stringify(tx));await writeFile(path.join(dir,'keep-personal.txt'),'keep');
 await pruneUpdates(root,randomUUID(),trust);assert.equal(await readFile(path.join(dir,'keep-personal.txt'),'utf8'),'keep');await assert.rejects(readFile(path.join(dir,'backup/server.mjs')));
}));

test('restoration preserves notes, candidates, lyrics and resources and waits for every page acknowledgement',()=>temporary(async root=>{
 const a=randomUUID(),b=randomUUID(),task=randomUUID(),data={format:'notemender-update-session-v1',project:{notes:[{id:'n',midi:60,start:0,duration:1}],lyrics:[{id:'l',text:'字',noteIds:['n']}],audioResources:[{id:'resource'}],timeAlignment:[{beat:0,time:2}]},candidate:{variants:[{id:'v',notes:[{id:'other'}]}]},lyricsPreview:{lines:[{text:'待确认'}]},position:2};await mkdir(path.join(root,'runtime/updates/sessions'),{recursive:true});await writeFile(path.join(root,'runtime/updates/restore.json'),JSON.stringify({target:2,clients:[a,b],task}));for(const id of [a,b])await writeFile(path.join(root,'runtime/updates/sessions',id+'.json'),JSON.stringify(data));
 await serve(root,async request=>{assert.deepEqual((await request('session?id='+a)).value.session,data);assert.equal((await request('session?id='+randomUUID())).value.session,null);assert.equal((await request('restore-status')).value.ready,false);await request('client',{id:a,restored:true});assert.equal((await request('restore-status')).value.ready,false);await request('client',{id:b,restored:true});assert.equal((await request('restore-status')).value.ready,true);},{current:info(2)});
}));

test('component activity, failed page save and expired handshake block apply without touching program',()=>temporary(async root=>{
 await installed(root);const f=fixture();let busy=true,time=Date.now();await serve(root,async request=>{await request('check',{});await request('download',{});const d=await waitReady(request),id=randomUUID();await request('client',{id});assert.equal((await request('prepare',{id:d.id})).status,400);busy=false;const p=(await request('prepare',{id:d.id})).value;await request('client',{id,error:'未提交内容'});assert.equal((await request('apply',{id:d.id})).status,400);await request('session',{id,challenge:p.challenge.id,data:{project:{notes:[]}}});time+=120001;assert.equal((await request('apply',{id:d.id})).status,400);assert.match(await readFile(path.join(root,'server.mjs'),'utf8'),/build=1/);},{canStart:()=>!busy,now:()=>time,fetchImpl:async url=>url.endsWith('test.zip')?new Response(f.zip):signedResponse(f)});
}));

test('public release verification requires complete ZIP and identical signed metadata on trusted hosts',async()=>{
 const f=fixture();assert.equal((await verifyPublished(f.envelope,trust,{fetchImpl:async url=>url.endsWith('test.zip')?new Response(f.zip):signedResponse(f)})).build,2);
 await assert.rejects(verifyPublished(f.envelope,trust,{fetchImpl:async()=>new Response(f.zip.subarray(0,10))}),/哈希/);
 await assert.rejects(verifyPublished(f.envelope,trust,{fetchImpl:async url=>url.endsWith('test.zip')?new Response(f.zip):signedResponse(fixture(3))}),/清单与/);
 await assert.rejects(verifyPublished(f.envelope,trust,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://example.org/zip'}})}),/不受信任/);
});

test('file sharing lock fails preparation safely and can be retried after release',{skip:process.platform!=='win32'},()=>temporary(async root=>{
 await installed(root);const f=fixture(),id=randomUUID(),dir=path.join(root,'runtime/updates',id),zip=path.join(root,'zip');await writeFile(zip,f.zip);await extractVerified(zip,f.m,path.join(dir,'stage'));const file=path.join(root,'server.mjs');
 const script="$h=[IO.File]::Open('"+file.replaceAll("'","''")+"',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);[Console]::WriteLine('LOCKED');[Console]::ReadLine()|Out-Null;$h.Dispose()",child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('lock helper failed'));});});await assert.rejects(installTransaction(root,dir,f.envelope,trust));assert.equal(JSON.parse(await readFile(path.join(dir,'transaction.json'))).state,'preparing');}
 finally{child.stdin.end('\n');await new Promise(r=>child.once('exit',r));}
 await verifyInstalled(root,trust,info(1));await rm(dir,{recursive:true,force:true});await extractVerified(zip,f.m,path.join(dir,'stage'));const tx=await installTransaction(root,dir,f.envelope,trust);await rollbackTransaction(root,dir,tx);await verifyInstalled(root,trust,info(1));
}));


test('signed domestic mirrors reject foreign hosts, duplicates and unsigned mutations',()=>{
 const f=fixture(),mirrors=[{id:'domestic',url:'https://gitee.com/owner/app/releases/download/demo/test.zip'},{id:'github',url:f.m.package.url}];
 const e=signedEnvelope({...f.m,package:{...f.m.package,mirrors}},keys.privateKey,trust.keyId);
 assert.equal(verifyEnvelope(e,trust).package.mirrors.length,2);
 for(const bad of [[mirrors[0],mirrors[0]],[{id:'domestic',url:f.m.package.url}],[{id:'github',url:'https://example.org/x'}]])assert.throws(()=>validateManifest({...f.m,package:{...f.m.package,mirrors:bad}}));
});
test('domestic index falls back on throttling and keeps source-specific ETags',()=>temporary(async root=>{
 let calls=[];const f=fixture();
 await serve(root,async request=>{
  let s=(await request('check',{})).value;assert.equal(s.state,'available');assert.equal(s.checkedSource,'github');
  await request('settings',{source:'domestic'});s=(await request('check',{})).value;assert.equal(s.state,'failed');assert.ok(!s.error.includes('已是最新'));
 },{sources:{domesticIndex:'https://gitee.com/a/b/raw/main/updates/index.json',githubIndex:'https://raw.githubusercontent.com/a/b/main/updates/index.json'},fetchImpl:async(url,options)=>{calls.push(url);if(url.includes('gitee.com'))return new Response('',{status:429,headers:{'retry-after':'120'}});assert.equal(options.headers['If-None-Match'],undefined);return signedResponse(f);}});
 assert.equal(calls.filter(x=>x.includes('gitee.com')).length,1);
}));
test('unconfigured manual domestic source fails clearly without network calls',()=>temporary(async root=>{
 let calls=0;await serve(root,async request=>{await request('settings',{source:'domestic'});const s=(await request('check',{})).value;assert.equal(s.state,'failed');assert.match(s.error,/尚未配置/);},{sources:{domesticIndex:null,githubIndex:'https://raw.githubusercontent.com/a/b/main/updates/index.json'},fetchImpl:async()=>{calls++;throw Error('must not fetch');}});assert.equal(calls,0);
}));
test('signed source switching resumes only the declared identical file and verifies final hash',()=>temporary(async root=>{
 const f=fixture();f.m.package.mirrors=[{id:'domestic',url:'https://gitee.com/a/b/releases/download/x/test.zip'},{id:'github',url:f.m.package.url}];f.envelope=signedEnvelope(f.m,keys.privateKey,trust.keyId);
 let resumed=false;await serve(root,async request=>{await request('check',{});await request('download',{});assert.equal((await waitReady(request)).state,'ready');assert.equal(resumed,true);},{fetchImpl:async(url,options)=>{
  if(url.includes('raw.githubusercontent.com'))return signedResponse(f);
  if(url.includes('gitee.com'))return new Response(f.zip.subarray(0,37));
  assert.equal(options.headers.Range,'bytes=37-');resumed=true;return new Response(f.zip.subarray(37),{status:206,headers:{'content-range':`bytes 37-${f.zip.length-1}/${f.zip.length}`}});
 }});
}));
test('login HTML and hostile redirects cannot become update packages',()=>temporary(async root=>{
 await serve(root,async request=>{await request('check',{});await request('download',{});const d=await waitReady(request);assert.equal(d.state,'failed');assert.match(d.error,/登录页/);},{fetchImpl:async url=>url.includes('raw.githubusercontent')?signedResponse(fixture()):new Response('<html>login</html>',{headers:{'content-type':'text/html'}})});
}));
test('publication gate verifies every announced mirror and its signed sibling manifest',async()=>{
 const f=fixture();f.m.package.mirrors=[{id:'domestic',url:'https://gitee.com/a/b/releases/download/x/test.zip'}];f.envelope=signedEnvelope(f.m,keys.privateKey,trust.keyId);
 await assert.rejects(verifyPublished(f.envelope,trust,{fetchImpl:async url=>url.includes('gitee.com')?new Response('login',{status:403}):url.endsWith('test.zip')?new Response(f.zip):signedResponse(f)}),/禁止公布/);
 let hosts=new Set();await verifyPublished(f.envelope,trust,{fetchImpl:async url=>{hosts.add(new URL(url).hostname);return url.endsWith('test.zip')?new Response(f.zip):signedResponse(f);}});assert.deepEqual([...hosts].sort(),['gitee.com','github.com']);
});

const cnbSources={domesticIndex:'https://cnb.cool/goldotto/NoteMender/-/git/raw/main/updates/index.json',githubIndex:'https://raw.githubusercontent.com/goldotto/NoteMender/main/updates/index.json'};
function cnbFixture(){const f=fixture();f.m.package.url='https://cnb.cool/goldotto/NoteMender/-/releases/download/v2.5.0-demo.7/test.zip';f.m.package.mirrors=[{id:'domestic',url:f.m.package.url}];f.envelope=signedEnvelope(f.m,keys.privateKey,trust.keyId);return f;}
test('CNB raw index and official attachment host are trusted, spoofed domains and mismatched source labels are rejected',()=>{
 assert.equal(updateIndexes(cnbSources)[0].url,cnbSources.domesticIndex);
 assert.ok(allowedDownload('https://asset.cnb.cool/release/test.zip?download=1'));
 for(const host of ['cnb.cool.evil.test','evil.cnb.cool','asset.cnb.cool.evil.test'])assert.throws(()=>allowedDownload('https://'+host+'/x'));
 const f=cnbFixture();assert.equal(verifyEnvelope(f.envelope,trust).build,2);
 assert.equal(packageSources({package:{url:f.m.package.url}},'domestic')[0].id,'domestic');
 assert.throws(()=>validateManifest({...f.m,package:{...f.m.package,mirrors:[{id:'github',url:f.m.package.url}]}}),/域名/);
 assert.throws(()=>validateManifest({...f.m,package:{...f.m.package,mirrors:[]}}),/镜像/);
});
test('CNB public signed check follows official asset redirect, validates payload and passes install preparation',()=>temporary(async root=>{
 await installed(root);const f=cnbFixture(),seen=[];
 await serve(root,async request=>{
  const s=(await request('check',{})).value;assert.equal(s.state,'available');assert.equal(s.checkedSource,'domestic');
  await request('download',{});const d=await waitReady(request);assert.equal(d.state,'ready',d.error);assert.equal(d.source,'domestic');
  await request('client',{id:randomUUID()});assert.equal((await request('prepare',{id:d.id})).status,200);await request('abort-prepare',{});
 },{sources:cnbSources,fetchImpl:async url=>{seen.push(new URL(url).hostname);if(url===cnbSources.domesticIndex)return signedResponse(f);if(new URL(url).hostname==='cnb.cool')return new Response(null,{status:302,headers:{location:'https://asset.cnb.cool/test.zip'}});return new Response(f.zip);}});
 assert.deepEqual(seen,['cnb.cool','cnb.cool','asset.cnb.cool']);
}));
test('CNB throttling or invalid signature can use GitHub without accepting unverified data',async()=>{
 for(const failure of ['throttle','signature'])await temporary(async root=>{
  let domestic=0,github=0;const f=fixture();
  await serve(root,async request=>{const s=(await request('check',{})).value;assert.equal(s.state,'available');assert.equal(s.checkedSource,'github');assert.equal(s.retryAt,null);if(failure==='throttle'){await request('check',{});assert.equal(domestic,1);assert.equal(github,2);}},
   {sources:cnbSources,fetchImpl:async url=>{if(url===cnbSources.domesticIndex){domestic++;return failure==='throttle'?new Response('',{status:429,headers:{'retry-after':'120'}}):new Response(JSON.stringify({...f.envelope,signature:'invalid'}));}github++;return signedResponse(f);}});
 });
});
test('CNB-only source rejects login pages and unrelated 304 cache responses without reporting latest',()=>temporary(async root=>{
 await serve(root,async request=>{await request('settings',{source:'domestic'});let s=(await request('check',{})).value;assert.equal(s.state,'failed');assert.match(s.error,/登录页/);},
  {sources:cnbSources,fetchImpl:async()=>new Response('<html>sign in</html>',{headers:{'content-type':'text/html'}})});
 await serve(root,async request=>{await request('settings',{source:'domestic'});const s=(await request('check',{})).value;assert.equal(s.state,'failed');assert.match(s.error,/缓存/);},
  {sources:cnbSources,fetchImpl:async()=>new Response(null,{status:304})});
}));
test('CNB publisher uses the announced domestic URL and requires its identical public signed metadata',()=>temporary(async base=>{
 const root=path.join(base,'source');await mkdir(root);await installed(root);await mkdir(path.join(root,'scripts'));await writeFile(path.join(root,'public/update-trust.json'),JSON.stringify(trust));await writeFile(path.join(root,'RELEASE_NOTES.md'),'CNB update');await writeFile(path.join(root,'scripts/public-files.json'),JSON.stringify(['server.mjs','public/build-info.json','public/update-trust.json','RELEASE_NOTES.md']));
 const url='https://cnb.cool/goldotto/NoteMender/-/releases/download/v2.5.0-demo.7/NoteMender-2.5.0-demo.7-build-2-windows-update.zip';
 const result=await packageUpdate(root,path.join(base,'out'),{privateKey:keys.privateKey,build:2,mirrors:[{id:'domestic',url}]});assert.equal(result.manifest.package.url,url);
 const zip=await readFile(path.join(base,'out',path.basename(url)));assert.equal((await verifyPublished(result.envelope,trust,{fetchImpl:async u=>u.endsWith('.zip')?new Response(zip):new Response(JSON.stringify(result.envelope))})).build,2);
}));
