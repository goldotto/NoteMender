import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {accelerationReady,accelerationRepairPlan,ensurePip,fileWithDigest,missingPythonPackages} from '../scripts/install-runtime.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('local CPU acceleration reuses compatible ORT 1.22.1 only when imports and the full model match',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'notemender-accel-ready-'));
  try{
    const directory=path.join(root,'runtime','acceleration','cpu'),modelPath=path.join(root,'runtime','models','basic-pitch','nmp.onnx');
    await mkdir(directory,{recursive:true});await mkdir(path.dirname(modelPath),{recursive:true});
    const model=Buffer.alloc(160_000,0x62);
    await writeFile(modelPath,model);
    await writeFile(path.join(directory,'ready.json'),JSON.stringify({version:1,component:'cpu',ortVersion:'1.22.1',torchVersion:null,modelSHA256:sha256(model)}));
    let probes=0;
    const run=async()=>{probes++;return {code:0,stdout:'',stderr:''};};
    assert.equal(await accelerationReady({directory,modelPath,component:'cpu',python:'fixture-python',run}),true);
    assert.equal(probes,1);
    assert.equal(await accelerationReady({directory,modelPath,component:'cpu',python:'fixture-python',run:async()=>({code:1})}),false);
    await writeFile(modelPath,Buffer.concat([model,Buffer.from([1])]));
    assert.equal(await accelerationReady({directory,modelPath,component:'cpu',python:'fixture-python',run}),false);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('GPU acceleration reuse requires its pinned ORT and Torch versions',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'notemender-gpu-ready-'));
  try{
    const directory=path.join(root,'gpu'),modelPath=path.join(root,'nmp.onnx'),model=Buffer.alloc(120_000,0x21);
    await mkdir(directory,{recursive:true});await writeFile(modelPath,model);
    const markerPath=path.join(directory,'ready.json');
    const marker={version:1,component:'gpu',ortVersion:'1.22.0',torchVersion:'2.7.1+cu128',modelSHA256:sha256(model)};
    await writeFile(markerPath,JSON.stringify(marker));
    assert.equal(await accelerationReady({directory,modelPath,component:'gpu',python:'fixture-python',run:async()=>({code:0})}),true);
    await writeFile(markerPath,JSON.stringify({...marker,ortVersion:'1.22.1'}));
    assert.equal(await accelerationReady({directory,modelPath,component:'gpu',python:'fixture-python',run:async()=>({code:0})}),false);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('offline pip bootstrap runs only after pip is missing',async()=>{
  const existing=[];
  await ensurePip('fixture-python',{run:async(_python,args)=>{existing.push(args);return {code:0,stdout:'pip 24',stderr:''};}});
  assert.deepEqual(existing,[['-m','pip','--version']]);

  const missing=[];
  await ensurePip('fixture-python',{run:async(_python,args)=>{
    missing.push(args);
    if(args[0]==='-m'&&args[1]==='ensurepip')return {code:0,stdout:'bootstrapped',stderr:''};
    return {code:missing.length===1?1:0,stdout:'pip 24',stderr:''};
  }});
  assert.deepEqual(missing,[['-m','pip','--version'],['-m','ensurepip','--upgrade','--default-pip'],['-m','pip','--version']]);
});

test('acceleration repair separates a missing model from missing packages and GPU wheels',async()=>{
  const modelOnly=accelerationRepairPlan({modelReady:false,missingDependencies:[],missingTorch:[]});
  assert.equal(modelOnly.checkOrDownloadModel,true);
  assert.equal(modelOnly.bootstrapPip,false);
  assert.equal(modelOnly.installDependencies,false);
  assert.equal(modelOnly.installTorch,false);

  const staleMarker=accelerationRepairPlan({ready:false,modelReady:true,missingDependencies:[],missingTorch:[]});
  assert.equal(staleMarker.reuse,false);
  assert.equal(staleMarker.bootstrapPip,false);

  const oneDependency=accelerationRepairPlan({ready:false,modelReady:true,missingDependencies:['protobuf'],missingTorch:[]});
  assert.equal(oneDependency.bootstrapPip,true);
  assert.deepEqual(oneDependency.missingDependencies,['protobuf']);
  assert.equal(oneDependency.checkOrDownloadModel,false);

  const installedGpu=accelerationRepairPlan({ready:true,modelReady:true,missingDependencies:[],missingTorch:[]});
  assert.equal(installedGpu.reuse,true);
  assert.equal(installedGpu.installTorch,false);

  const partialGpu=accelerationRepairPlan({ready:false,modelReady:true,missingDependencies:[],missingTorch:['torchaudio']});
  assert.deepEqual(partialGpu.missingTorch,['torchaudio']);
  assert.equal(partialGpu.installTorch,true);
});

test('package repair helper returns only the distributions with mismatches',async()=>{
  const result=await missingPythonPackages({
    python:'fixture-python',
    expected:{onnxruntime:'1.22.1',protobuf:'5.29.5',numpy:'1.26.4'},
    modules:{onnxruntime:'onnxruntime',protobuf:'google.protobuf',numpy:'numpy'},
    run:async()=>({code:0,stdout:'["protobuf"]\n',stderr:''}),
  });
  assert.deepEqual(result,['protobuf']);
});

test('file digest helper refuses traversal and changed local files',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'notemender-file-digest-'));
  try{
    await writeFile(path.join(root,'model.pt'),'weights');
    const hash=sha256(Buffer.from('weights'));
    assert.equal(await fileWithDigest(root,'model.pt',hash),true);
    assert.equal(await fileWithDigest(root,'model.pt','0'.repeat(64)),false);
    assert.equal(await fileWithDigest(root,'../outside',hash),false);
  }finally{await rm(root,{recursive:true,force:true});}
});
