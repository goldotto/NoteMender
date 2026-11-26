import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,getEventListeners} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {decodeLocal} from '../src/decode.mjs';

class FakeChild extends EventEmitter{
  constructor(){super();this.killed=false;}
  kill(){this.killed=true;queueMicrotask(()=>this.emit('close',0));}
}
const tempRoot=()=>mkdtemp(path.join(os.tmpdir(),'notemender-decode-'));
const removeRoot=root=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
const timeouts=()=>process.getActiveResourcesInfo().filter(name=>name==='Timeout').length;
function budget(promise,ms,message){
  let id;const guard=new Promise((_,reject)=>{id=setTimeout(()=>reject(Error(message)),ms);});
  return Promise.race([promise,guard]).finally(()=>clearTimeout(id));
}

test('spawn error rejects with the install message, cancels the 90s timer and removes the abort listener',async()=>{
  const root=await tempRoot();
  try{
    const controller=new AbortController(),child=new FakeChild(),before=timeouts(),startedAt=Date.now();
    const pending=decodeLocal(root,Buffer.from('audio'),controller.signal,'decode',{spawnImpl:()=>{queueMicrotask(()=>child.emit('error',Error('spawn ENOENT')));return child;}});
    await assert.rejects(budget(pending,1000,'解码 Promise 未在 1 秒内结算，90 秒定时器疑似泄漏'),/本地解码环境未安装/);
    assert.ok(Date.now()-startedAt<1000,'解码错误分支必须在 1 秒内结算');
    assert.equal(getEventListeners(controller.signal,'abort').length,0,'abort 监听必须随错误分支移除');
    assert.equal(timeouts(),before,'结算后不应残留定时器');
    assert.equal(child.killed,false,'spawn 失败没有进程可杀');
  }finally{await removeRoot(root);}
});

test('cancellation kills the child and rejects with AbortError instead of a decode failure',async()=>{
  const root=await tempRoot();
  try{
    const controller=new AbortController();let child,spawned;const started=new Promise(resolve=>spawned=resolve);
    const pending=decodeLocal(root,Buffer.from('audio'),controller.signal,'decode',{spawnImpl:()=>{child=new FakeChild();spawned();return child;}});
    await started;
    assert.equal(child.listenerCount('close'),1,'解码子进程未挂载 close 监听');
    controller.abort();
    await assert.rejects(budget(pending,1000,'取消后解码 Promise 未在 1 秒内结算'),error=>error instanceof DOMException&&error.name==='AbortError'&&error.message==='已取消');
    assert.equal(child.killed,true,'取消必须杀掉解码子进程');
    assert.equal(getEventListeners(controller.signal,'abort').length,0);
  }finally{await removeRoot(root);}
});

test('successful decode returns the produced bytes and tempo returns parsed JSON',async()=>{
  const root=await tempRoot();
  try{
    const calls=[];
    const runner=payload=>(command,args,options)=>{calls.push({command,args,options});const child=new FakeChild();queueMicrotask(async()=>{await writeFile(args[2],payload);child.emit('close',0);});return child;};
    const wav=Buffer.from('RIFF....WAVEfmt ');
    const decoded=await budget(decodeLocal(root,Buffer.from('source'),undefined,'decode',{spawnImpl:runner(wav)}),1000,'正常解码未在 1 秒内结算');
    assert.ok(Buffer.isBuffer(decoded));assert.equal(decoded.toString('latin1'),wav.toString('latin1'));
    const tempo=await budget(decodeLocal(root,Buffer.from('source'),undefined,'tempo',{spawnImpl:runner(JSON.stringify({bpm:128,beats:[0,.5]}))}),1000,'tempo 解析未在 1 秒内结算');
    assert.deepEqual(tempo,{bpm:128,beats:[0,.5]});
    assert.equal(calls.length,2);
    assert.equal(calls[0].args[0],path.join(root,'scripts','decode_audio.py'));
    assert.equal(calls[1].args[0],path.join(root,'scripts','measure_tempo.py'));
    assert.equal(calls[0].args[2],path.join(path.dirname(calls[0].args[1]),'decoded.wav'));
    assert.equal(calls[1].args[2],path.join(path.dirname(calls[1].args[1]),'tempo.json'));
    assert.equal(calls[0].options.stdio,'ignore');
  }finally{await removeRoot(root);}
});
