import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeCompute,resolveCompute,computeQuery} from '../public/compute-settings.mjs';
import {analysisKeys} from '../public/analysis-cache.mjs';
import {computeService} from '../src/compute-service.mjs';
import {NativeAnalysis} from '../src/native-analysis.mjs';
import {createApp} from '../server.mjs';
import {qualification,modelFingerprint,torchQualifications,accelerationEnv} from '../src/compute-runtime.mjs';
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

test('reused GPU environment resolves its model and gates; only its verified CPU provider is enabled',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'notemender-external-gates-')),external=await mkdtemp(path.join(tmpdir(),'notemender-external-runtime-'));
  try{
    for(const folder of ['public/models/basic-pitch','runtime'])await mkdir(path.join(root,folder),{recursive:true});
    for(const folder of ['models/basic-pitch','acceleration/gpu'])await mkdir(path.join(external,folder),{recursive:true});
    await writeFile(path.join(root,'public/models/basic-pitch/model.json'),JSON.stringify({weightsManifest:[]}));
    const modelFile=path.join(external,'models/basic-pitch/nmp.onnx'),directory=path.join(external,'acceleration/gpu');
    await writeFile(modelFile,'fixture');
    await writeFile(path.join(root,'runtime/component-settings.json'),JSON.stringify({version:1,bindings:{audio:{python:'external-python',modelHome:path.join(external,'models')},gpu:{python:'external-python',directory}}}));
    const gate={passed:true,legacyFingerprint:await modelFingerprint(root),onnxFingerprint:createHash('sha256').update('fixture').digest('hex'),runtimeVersion:'1.22.0',torchVersion:'2.7.1+cu128',adapterVersion:1};
    const filename=path.join(external,'acceleration/qualification.json');
    await writeFile(filename,JSON.stringify({cpu:{...gate,passed:false},cuda:{...gate,passed:false},cudaCPU:gate,demucs:{passed:true,torchVersion:gate.torchVersion,adapterVersion:2},crepe:{passed:true,torchVersion:gate.torchVersion,adapterVersion:1}}));
    const runtime=await accelerationEnv(root,'cpu');
    assert.equal(runtime.env.JIANPU_BASIC_MODEL,modelFile);assert.equal(runtime.qualificationFile,filename);
    const probe={ortVersion:gate.runtimeVersion,torchVersion:gate.torchVersion};
    const result=await qualification(root,probe);
    assert.equal(result.cpu,true);assert.equal(result.cuda,false);assert.equal(result.cudaCPU,true);
    assert.deepEqual(await torchQualifications(root,probe),{demucs:true,crepe:true});
    assert.equal((await qualification(root,{...probe,torchVersion:'changed'})).cpu,false);
    await mkdir(path.join(root,'scripts'));
    await writeFile(path.join(root,'scripts/compute-qualification.json'),await readFile(filename));
    await rm(filename);
    assert.equal((await qualification(root,probe)).cpu,true);
    assert.deepEqual(await torchQualifications(root,probe),{demucs:true,crepe:true});
    const cpuDirectory=path.join(root,'runtime/acceleration/cpu');
    await mkdir(path.join(cpuDirectory,'onnxruntime'),{recursive:true});
    await writeFile(path.join(cpuDirectory,'ready.json'),'{}');
    await writeFile(path.join(cpuDirectory,'onnxruntime/__init__.py'),'');
    let used;
    const service=computeService(root,{runner:{
      request:async(_,config)=>config.device==='cpu'?{ortVersion:'1.22.1',providers:['CPUExecutionProvider'],torchVersion:'2.5.1+cpu'}:{...probe,providers:['CPUExecutionProvider','CUDAExecutionProvider']},
      analyse:async(_,kind,config)=>{used=config;return {bytes:Buffer.alloc(8),metadata:{device:'cpu',runtimeVersion:probe.ortVersion}};}
    }});
    const caps=await service.status();assert.equal(caps.backends.cpu.qualified,true);assert.equal(caps.backends.cpu.runtimeDevice,'cuda');assert.match(caps.backends.cpu.fingerprint,/:1.22.0:cpu:/);
    const req=Readable.from([Buffer.alloc(4)]);req.method='POST';req.headers={'x-studio-token':'token'};
    const res=new EventEmitter();res.setHeader=()=>{};
    let status;
    await service(req,res,new URL('http://localhost/api/analysis/basic-pitch?compute=performance&device=cpu'),code=>{status=code;},'token');
    assert.equal(status,200);assert.equal(used.device,'cpu');assert.equal(used.runtimeDevice,'cuda');
    await rm(cpuDirectory,{recursive:true});
    await writeFile(filename,JSON.stringify({cudaCPU:{...gate,passed:false},demucs:{passed:false},crepe:{passed:false}}));
    assert.equal((await qualification(root,probe)).cpu,false);
    assert.deepEqual(await torchQualifications(root,probe),{demucs:false,crepe:false});
    await rm(filename);
    await writeFile(modelFile,'changed model');
    assert.equal((await qualification(root,probe)).cpu,false);
  }finally{await rm(root,{recursive:true,force:true});await rm(external,{recursive:true,force:true});}
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
    assert.equal((await runner.request({kind:'probe'})).ok,true);await runner.request({kind:'probe'});await runner.request({kind:'probe'},{device:'cpu'});await runner.request({kind:'probe'},{device:'cuda'});assert.equal(children.length,1);
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
