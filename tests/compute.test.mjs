import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeCompute,resolveCompute,computeQuery} from '../public/compute-settings.mjs';
import {analysisKeys} from '../public/analysis-cache.mjs';
import {computeService} from '../src/compute-service.mjs';
import {NativeAnalysis} from '../src/native-analysis.mjs';
import {createApp} from '../server.mjs';
import {qualification,modelFingerprint,torchQualifications} from '../src/compute-runtime.mjs';
import {createHash} from 'node:crypto';

test('qualification binds each installed runtime separately, including CUDA CPU fallback',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jianpu-gates-'));
  try{
    for(const folder of ['public/models/basic-pitch','runtime/models/basic-pitch','runtime/acceleration'])await mkdir(path.join(root,folder),{recursive:true});
    await writeFile(path.join(root,'public/models/basic-pitch/model.json'),JSON.stringify({weightsManifest:[]}));
    await writeFile(path.join(root,'runtime/models/basic-pitch/nmp.onnx'),'fixture');
    const gate={passed:true,legacyFingerprint:await modelFingerprint(root),onnxFingerprint:createHash('sha256').update('fixture').digest('hex'),adapterVersion:1};
    await writeFile(path.join(root,'runtime/acceleration/qualification.json'),JSON.stringify({cpu:{...gate,runtimeVersion:'1.22.1'},cuda:{...gate,runtimeVersion:'1.22.0',torchVersion:'2.7.1+cu128'},cudaCPU:{...gate,runtimeVersion:'1.22.0',torchVersion:'2.7.1+cu128'}}));
    const gpu={ortVersion:'1.22.0',torchVersion:'2.7.1+cu128'},cpu={ortVersion:'1.22.1',torchVersion:'2.5.1+cpu'};
    const result=await qualification(root,gpu,cpu);
    assert.equal(result.cpu,true);assert.equal(result.cuda,true);assert.equal(result.cudaCPU,true);
    const changed=await qualification(root,{...gpu,ortVersion:'1.23.0'},cpu);
    assert.equal(changed.cpu,true);assert.equal(changed.cuda,false);assert.equal(changed.cudaCPU,false);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('torch qualification rejects an earlier spectral adapter and a changed runtime',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jianpu-torch-gates-'));
  try{
    await mkdir(path.join(root,'runtime/acceleration'),{recursive:true});
    const filename=path.join(root,'runtime/acceleration/qualification.json'),entry={passed:true,torchVersion:'2.7.1+cu128',adapterVersion:1};
    await writeFile(filename,JSON.stringify({demucs:entry,crepe:entry}));
    assert.deepEqual(await torchQualifications(root,{torchVersion:entry.torchVersion}),{demucs:false,crepe:true});
    await writeFile(filename,JSON.stringify({demucs:{...entry,adapterVersion:2},crepe:entry}));
    assert.deepEqual(await torchQualifications(root,{torchVersion:entry.torchVersion}),{demucs:true,crepe:true});
    assert.deepEqual(await torchQualifications(root,{torchVersion:'different'}),{demucs:false,crepe:false});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('compute defaults preserve current mode; only qualified backends are selected',()=>{
  assert.deepEqual(normalizeCompute(),{mode:'standard',device:'auto',threads:0});
  assert.equal(resolveCompute({}).basicBackend,'tfjs-cpu');
  assert.throws(()=>normalizeCompute({mode:'performance',threads:33},32));
  const status={logicalCores:32,backends:{cpu:{qualified:true,fingerprint:'a'},cuda:{qualified:false}},torchCUDA:true};
  assert.equal(resolveCompute({mode:'performance'},status).basicBackend,'onnx-cpu');
  status.backends.cuda.qualified=true;
  assert.equal(resolveCompute({mode:'performance'},status).basicBackend,'onnx-cuda');
  assert.equal(resolveCompute({mode:'performance',device:'cpu'},status).basicBackend,'onnx-cpu');
  assert.match(computeQuery({mode:'performance',device:'cuda',threads:12}),/threads=12/);
  const mixed=resolveCompute({mode:'performance'},{...status,backends:{...status.backends,cuda:{qualified:false}},demucsCUDA:true,crepeCUDA:true});
  assert.equal(mixed.basicBackend,'onnx-cpu');assert.equal(mixed.separationBackend,'cuda');assert.equal(mixed.pitchBackend,'cuda');
});

test('cache distinguishes native providers and stem provenance, and still shares base evidence',async()=>{
  const samples=new Float32Array(32),base={pipeline:'corrected',source:'vocals',minMidi:45,maxMidi:88,execution:{basicBackend:'onnx-cpu',basicFingerprint:'model'},sourceFingerprint:'cpu-stem'};
  const a=await analysisKeys(samples,'adaptive',base),b=await analysisKeys(samples,'adaptive',{...base,pipeline:'crepe'});
  assert.equal(a.base,b.base);assert.notEqual(a.combined,b.combined);
  assert.notEqual(a.base,(await analysisKeys(samples,'adaptive',{...base,execution:{...base.execution,basicBackend:'onnx-cuda'}})).base);
  assert.notEqual(a.base,(await analysisKeys(samples,'adaptive',{...base,sourceFingerprint:'gpu-stem'})).base);
});

test('native process reuses a configuration, cancels active work, and restarts cleanly',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jianpu-compute-')),children=[];
  function spawnImpl(){
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.killed=false;child.kill=()=>{child.killed=true;};
    child.stdin={write(line,callback){const message=JSON.parse(line);if(message.kind!=='hold')queueMicrotask(()=>child.stdout.emit('data',JSON.stringify({id:message.id,result:{ok:true}})+'\n'));callback?.();}};
    children.push(child);return child;
  }
  const runner=new NativeAnalysis(root,{spawnImpl});
  try{
    assert.equal((await runner.request({kind:'probe'})).ok,true);await runner.request({kind:'probe'});assert.equal(children.length,1);
    const controller=new AbortController(),pending=runner.request({kind:'hold'},{},controller.signal);await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(children[0].killed,true);
    await runner.request({kind:'probe'});assert.equal(children.length,2);
    children[1].emit('close',1);await runner.request({kind:'probe'});assert.equal(children.length,3);
    await runner.request({kind:'probe'},{device:'cpu',threads:8});assert.equal(children.length,4);
  }finally{runner.stop();await rm(root,{recursive:true,force:true});}
});

test('compute API authenticates, rejects malformed input, and reports unavailable components',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jianpu-compute-api-'));
  const app=createApp({analysisRoot:root});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.address().port}`;
  try{
    const {token}=await(await fetch(base+'/api/status')).json(),headers={'X-Studio-Token':token};
    assert.equal((await fetch(base+'/api/compute/status')).status,403);
    const status=await(await fetch(base+'/api/compute/status',{headers})).json();assert.equal(status.backends.cpu.qualified,false);
    assert.equal((await fetch(base+'/api/analysis/basic-pitch?compute=performance',{method:'POST',headers,body:Buffer.alloc(3)})).status,400);
    assert.equal((await fetch(base+'/api/analysis/basic-pitch?compute=performance&threads=-1',{method:'POST',headers,body:Buffer.alloc(4)})).status,400);
    assert.equal((await fetch(base+'/api/analysis/basic-pitch?compute=performance',{method:'POST',headers,body:Buffer.alloc(4)})).status,400);
  }finally{await new Promise(resolve=>app.close(resolve));await rm(root,{recursive:true,force:true});}
});
