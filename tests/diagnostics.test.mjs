import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createDiagnostics,redact,safeEvent,diagnosticRoute} from '../src/diagnostics.mjs';
import {reportText,offlineReport} from '../public/diagnostics-ui.mjs';
import {createApp} from '../server.mjs';
async function temporary(fn){const root=await mkdtemp(path.join(os.tmpdir(),'notemender-diagnostics-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
test('feedback redaction removes credentials, URLs, local paths and resource names',()=>{
  const text=redact('token=secret-value password="hunter2" X-Studio-Token:abcdef Bearer abcdef ghp_abcdefg https://user:pass@example.org/x?token=123\nD:\\private folder\\song.wav\nfile:///C:/Users/Alice/token.txt\n\\\\NAS\\secret\\file\n私人歌曲.mp3\nme@example.org');
  for(const value of ['secret-value','hunter2','abcdef','Alice','private folder','NAS','私人歌曲','me@example','?token','user:pass'])assert.ok(!text.includes(value),value);
  assert.ok(text.includes('example.org'));
  assert.equal(redact('Basic Pitch 推理失败'),'Basic Pitch 推理失败');
  assert.deepEqual(Object.keys(safeEvent({event:'error',notes:[{lyric:'不要记录'}],lyrics:'私人',token:'secret',path:'D:/private'})).sort(),['event','level','source','time']);
  assert.equal(diagnosticRoute('/api/resources/audio/private-name?token=secret'),'/api/resources/audio/:id');
});
test('server disconnection still produces a private, downloadable browser report',()=>{
  const value=offlineReport({description:'安装失败 token=secret',steps:'D:/private folder/music.wav',browser:'test browser'},[{event:'script.error',message:'已过滤的错误'}]);
  const text=reportText(value);assert.match(text,/无法读取服务器日志/);assert.match(text,/已过滤的错误/);assert.ok(!text.includes('secret'));assert.ok(!text.includes('private folder'));assert.match(text,/版本未核实/);
});
test('logs rotate, survive restart, discard malformed entries and clear cleanly',()=>temporary(async root=>{
  let logger=createDiagnostics(root,{maxBytes:850,maxEvents:20});
  for(let i=0;i<30;i++)logger.record({event:'test.'+i,message:'x'.repeat(200)});
  const first=await logger.snapshot();assert.equal(first.events.length,20);assert.equal(first.storageError,false);
  const dir=path.join(root,'runtime/logs');assert.ok((await readdir(dir)).length<=3);
  for(const f of await readdir(dir))assert.ok(Buffer.byteLength(await readFile(path.join(dir,f)))<=850);
  await logger.close();logger=createDiagnostics(root,{maxBytes:850});assert.ok((await logger.snapshot()).events.some(e=>e.event==='test.29'));
  const report=await logger.report({description:'复现问题 token=secret',steps:'打开按钮'});const text=reportText(report);assert.match(text,/复现问题/);assert.match(text,/打开按钮/);assert.ok(!text.includes('secret'));
  await logger.clear();assert.equal((await logger.snapshot()).events.length,0);assert.deepEqual(await readdir(dir),[]);
  logger.record({event:'after.clear'});await logger.close();assert.equal((await logger.snapshot()).events.length,1);
}));
test('disk failure retains in-memory errors and does not reject operations',()=>temporary(async root=>{
  await mkdir(path.join(root,'runtime'));await writeFile(path.join(root,'runtime/logs'),'blocked');const logger=createDiagnostics(root);
  logger.record({level:'error',event:'operation.error',message:'失败'});const result=await logger.snapshot();assert.equal(result.storageError,true);assert.ok(result.events.some(e=>e.message==='失败'));
}));
test('deduplication preserves different component checks and states',()=>temporary(async root=>{
  const logger=createDiagnostics(root);for(const component of ['cpu','gpu'])logger.record({event:'check.complete',component,state:'ready'});
  logger.record({event:'check.complete',component:'cpu',state:'missing'});const value=await logger.snapshot();assert.equal(value.events.filter(e=>e.event==='check.complete').length,3);await logger.close();
}));

test('feedback includes build and redacted updater failure but never private recovery contents',()=>temporary(async root=>{
 await mkdir(path.join(root,'runtime/updates'),{recursive:true});await writeFile(path.join(root,'runtime/updates/history.json'),JSON.stringify([{at:'2026-10-19',from:{build:1},to:{build:2},result:'rolled-back',phase:'启动',reason:'D:/private folder/song.wav token=secret-value'}]));await writeFile(path.join(root,'runtime/updates/sessions-private.json'),'私人歌曲和歌词');
 const logger=createDiagnostics(root,{build:123});try{const report=await logger.report(),text=reportText(report);assert.equal(report.build,123);assert.match(text,/rolled-back/);for(const privateValue of ['private folder','secret-value','私人歌曲和歌词'])assert.ok(!text.includes(privateValue));assert.ok(!reportText(report,{includeLogs:false}).includes('rolled-back'));}finally{await logger.close();}
}));
test('feedback API is authenticated, records errors without request contents and exports a sanitized report',()=>temporary(async root=>{
  const app=createApp({analysisRoot:root,exportDirectory:path.join(root,'exports')});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
  try{
    assert.equal((await fetch(base+'/api/diagnostics/status')).status,403);
    const {token}=await (await fetch(base+'/api/status')).json();const headers={'X-Studio-Token':token,'Content-Type':'application/json'};
    assert.equal((await fetch(base+'/api/diagnostics/event',{method:'POST',headers,body:JSON.stringify({source:'browser',event:'script.error',level:'error',message:'D:/private/file.wav',lyrics:'不要记录',token:'do-not-store'})})).status,200);
    assert.equal((await fetch(base+'/api/settings?name=private-song',{method:'POST',headers,body:JSON.stringify({lyric:'do-not-store-content'})})).status,404);
    const report=await (await fetch(base+'/api/diagnostics/report',{method:'POST',headers,body:JSON.stringify({steps:'点生成',description:'token=do-not-store',project:{notes:['不要记录']}})})).json();
    const text=JSON.stringify(report);for(const secret of ['do-not-store','不要记录','private-song','D:/private'])assert.ok(!text.includes(secret),secret);
    assert.ok(report.events.some(e=>e.event==='request.complete'&&e.status===404));assert.match(reportText(report),/点生成/);
    assert.equal((await fetch(base+'/api/diagnostics/report',{method:'POST',headers,body:JSON.stringify({description:123})})).status,400);
    assert.equal((await fetch(base+'/api/diagnostics/event',{method:'POST',headers,body:JSON.stringify({source:'browser',message:'x'.repeat(25000)})})).status,413);
    assert.equal((await fetch(base+'/api/diagnostics/clear',{method:'POST',headers,body:'{}'})).status,200);assert.equal((await (await fetch(base+'/api/diagnostics/status',{headers})).json()).events.length,0);
  }finally{await new Promise(resolve=>app.close(resolve));await app.diagnostics.close();}
}));

test('update heartbeat and repeated status reads do not flood reports or repeat an already recorded check error',()=>temporary(async root=>{
 const app=createApp({analysisRoot:root,updatesOptions:{fetchImpl:async()=>{throw Error('offline');}}});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 try{const {token}=await (await fetch(base+'/api/status')).json(),headers={'X-Studio-Token':token,'Content-Type':'application/json'};await fetch(base+'/api/updates/check',{method:'POST',headers,body:'{}'});for(let i=0;i<4;i++){await fetch(base+'/api/updates/status',{headers});await fetch(base+'/api/updates/client',{method:'POST',headers,body:JSON.stringify({id:'00000000-0000-0000-0000-000000000000'})});}const snapshot=await app.diagnostics.snapshot();assert.equal(snapshot.events.filter(e=>e.event==='task.failed').length,0);assert.equal(snapshot.events.filter(e=>e.event==='update.check-failed').length,1);assert.ok(!snapshot.events.some(e=>e.event==='request.complete'&&e.status===200&&e.message==='/api/updates/client'));}finally{await new Promise(r=>app.close(r));await app.diagnostics.close();}
}));
