import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {componentsService,installerCommand,installerRuntime} from '../src/components-service.mjs';
import {discoverPython,inspectComponent,componentLocation} from '../src/component-discovery.mjs';
import {componentConfig,saveComponentConfig} from '../src/component-config.mjs';
import {pythonFor} from '../src/python-runtime.mjs';
import {accelerationEnv} from '../src/compute-runtime.mjs';
import {orderedComponents} from '../public/component-catalog.mjs';
import {sources} from '../scripts/download-sources.mjs';

async function fixture(work,options={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'notemender-components-'));await mkdir(path.join(root,'scripts'),{recursive:true});
  await writeFile(path.join(root,'scripts','qwen-download-manifest.json'),JSON.stringify({asr:{folder:'Qwen3-ASR-0.6B'},aligner:{folder:'Qwen3-ForcedAligner-0.6B'}}));
  await writeFile(path.join(root,'scripts','component-models.json'),'{}');
  const service=componentsService(root,options),token='test-session';
  const server=http.createServer(async(req,res)=>{const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};await service(req,res,new URL(req.url,'http://local'),send,token);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/components/`;
  const request=async(name,body,auth=true)=>{const response=await fetch(base+name,{headers:{...(auth?{'X-Studio-Token':token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  const finished=async()=>{for(let i=0;i<100;i++){const {body}=await request('job');if(body.job&&!['running','cancelling'].includes(body.job.state))return body.job;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Task did not finish');};
  try{await work({root,service,request,finished});}finally{await service.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
}
test('component viewing never discovers outside environments; scanning requires explicit consent and session',async()=>{
  let calls=0;await fixture(async({request})=>{
    assert.equal((await request('status')).status,200);assert.equal(calls,0);
    assert.equal((await request('scan',{})).status,400);assert.equal(calls,0);
    assert.equal((await request('scan',{consent:true},false)).status,403);assert.equal(calls,0);
  },{inspect:async()=>({ready:false}),discover:async()=>{calls++;return [];}});
  await assert.rejects(discoverPython({consent:false}),/允许扫描/);
});
test('reuse needs a scanned candidate and deep validation, then survives restart without copying',async()=>{
  let checkedDeep=false;await fixture(async({root,request,finished})=>{
    assert.equal((await request('reuse',{candidateId:'arbitrary'})).status,400);
    assert.equal((await request('scan',{consent:true,folder:root})).status,202);
    const scan=await finished();assert.equal(scan.state,'done');const candidate=scan.candidates.find(c=>c.component==='audio');assert.ok(candidate);
    assert.equal((await request('reuse',{candidateId:candidate.candidateId})).status,202);assert.equal((await finished()).state,'done');assert.ok(checkedDeep);
    assert.equal((await componentConfig(root)).bindings.audio.python,path.join(root,'runtime','python','python.exe'));
    assert.equal((await request('status?refresh=1')).body.components.find(c=>c.id==='audio').ready,true);
    assert.equal((await request('unlink',{component:'audio'})).status,200);assert.equal((await componentConfig(root)).bindings.audio,undefined);
  },{discover:async({folder})=>[path.join(folder,'runtime','python','python.exe')],inspect:async(root,id,where,options={})=>{if(options.deep)checkedDeep=true;return {ready:id==='audio'||id==='python'};}});
});
test('failed reuse validation leaves the previous binding intact',async()=>{
  await fixture(async({root,request,finished})=>{
    await saveComponentConfig(root,{bindings:{audio:{python:'previous.exe'}}});await request('scan',{consent:true,folder:root});const candidate=(await finished()).candidates.find(c=>c.component==='audio');
    await request('reuse',{candidateId:candidate.candidateId});assert.equal((await finished()).state,'failed');assert.equal((await componentConfig(root)).bindings.audio.python,'previous.exe');
  },{discover:async({folder})=>[path.join(folder,'python.exe')],inspect:async(root,id,where,options={})=>({ready:(id==='audio'||id==='python')&&!options.deep,reason:'hash mismatch'})});
});
test('installation is mutually exclusive and cancellation terminates only its owned child',async()=>{
  let spawned,killCount=0;await fixture(async({request,finished})=>{
    assert.equal((await request('install',{components:['cpu']})).status,202);
    for(let i=0;i<30&&!spawned;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(spawned);
    assert.equal(spawned.options.env.NOTEMENDER_INSTALL_MANAGED,'1');assert.match(spawned.options.env.PIP_CACHE_DIR,/runtime[\\/]downloads/);assert.equal(spawned.options.windowsHide,true);
    assert.equal((await request('install',{components:['lyrics']})).status,400);
    assert.equal((await request('cancel',{})).status,200);assert.equal((await finished()).state,'cancelled');assert.ok(killCount>0);
  },{inspect:async(root,id)=>({ready:id==='audio'}),spawnImpl:(command,args,options)=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.kill=()=>{killCount++;child.exitCode=1;queueMicrotask(()=>child.emit('close',1));};spawned={command,args,options};return child;}});
});
test('analysis activity blocks installation, and arbitrary component or folder input is rejected',async()=>fixture(async({request})=>{
  assert.equal((await request('install',{components:['gpu']})).status,400);
  assert.equal((await request('install',{components:['shell-command']})).status,400);
  assert.equal((await request('scan',{consent:true,folder:'relative'})).status,400);
},{canStart:()=>false}));
test('component dependency ordering and source fallback preserve pinned versions',()=>{
  assert.deepEqual(orderedComponents(['lyrics','six','gpu']),['audio','lyrics','six','gpu']);assert.throws(()=>orderedComponents(['base']));
  assert.equal(sources('pypi','global')[0],'https://pypi.org/simple');assert.equal(sources('pypi','cn').length,3);assert.equal(sources('cuda','cn').length,2);
  const [command,args]=installerCommand('ROOT','gpu','NODE');assert.equal(command,'NODE');assert.ok(args.includes('--gpu'));assert.throws(()=>installerCommand('ROOT','anything'));
});
test('runtime references use the chosen existing environment; an installer ignores external bindings',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'notemender-bindings-'));const previous=process.env.NOTEMENDER_INSTALL_MANAGED;
  try{
    await saveComponentConfig(root,{bindings:{audio:{python:'existing-python',modelHome:'existing-models'},gpu:{python:'gpu-python',directory:'gpu-site'}}});
    assert.equal(await pythonFor(root),'existing-python');const runtime=await accelerationEnv(root);assert.equal(runtime.python,'gpu-python');assert.equal(runtime.env.TORCH_HOME,'existing-models');
    process.env.NOTEMENDER_INSTALL_MANAGED='1';assert.equal(await pythonFor(root),path.join(root,'.venv','Scripts','python.exe'));
  }finally{if(previous===undefined)delete process.env.NOTEMENDER_INSTALL_MANAGED;else process.env.NOTEMENDER_INSTALL_MANAGED=previous;await rm(root,{recursive:true,force:true});}
});
test('marker alone cannot report readiness: the read-only probe must import packages and inspect files',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'notemender-probe-'));try{await mkdir(path.join(root,'scripts'));await writeFile(path.join(root,'scripts','component-models.json'),'{}');const python=path.join(root,'python.exe');await writeFile(python,'');
    let called=false;const result=await inspectComponent(root,'audio',{python,modelHome:root},{run:async(command,args,options)=>{called=true;assert.match(args[0],/probe-components.py$/);assert.equal(options.env.HF_HUB_OFFLINE,'1');return {code:0,stdout:'{"ready":false,"reason":"missing dependency"}'};}});assert.equal(called,true);assert.equal(result.ready,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('setup edition uses its bundled foundation without an external scan; a completed local venv has priority',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'notemender-foundation-'));
  try{
    const bundled=path.join(root,'runtime','python','python.exe');await mkdir(path.dirname(bundled),{recursive:true});await writeFile(bundled,'');
    assert.equal(await pythonFor(root,{owned:true}),bundled);
    const local=path.join(root,'.venv','Scripts','python.exe');await mkdir(path.dirname(local),{recursive:true});await writeFile(local,'');
    assert.equal(await pythonFor(root,{owned:true}),local);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('installing an overlay reuses the validated external interpreter and bundled pip without global writes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'notemender-installer-reuse-'));
  try{
    await mkdir(path.join(root,'scripts'));await writeFile(path.join(root,'scripts','component-models.json'),'{}');
    const external=path.join(os.tmpdir(),'other-environment','python.exe');
    await saveComponentConfig(root,{bindings:{audio:{python:external,modelHome:'models'},gpu:{python:external,directory:'external-gpu-site'}}});
    const wheels=path.join(root,'runtime','python','Lib','ensurepip','_bundled');await mkdir(wheels,{recursive:true});await writeFile(path.join(wheels,'pip-24.0-py3-none-any.whl'),'fixture');
    const runtime=await installerRuntime(root,'lyrics');
    assert.equal(runtime.python,external);assert.equal(runtime.env.NOTEMENDER_INSTALL_PYTHON,external);assert.equal(runtime.env.NOTEMENDER_READONLY_PYTHON,'1');
    assert.ok(runtime.env.PYTHONPATH.includes('external-gpu-site'));assert.ok(runtime.env.PYTHONPATH.includes('pip-24.0-py3-none-any.whl'));assert.equal(runtime.env.PYTHONDONTWRITEBYTECODE,'1');
    const singing=await componentLocation(root,'singing',{localOnly:true});assert.equal(singing.python,external);assert.equal(singing.overlay,'external-gpu-site');
    const audio=await componentLocation(root,'audio',{localOnly:true});assert.equal(audio.python,external);assert.equal(audio.modelHome,path.join(root,'runtime','models'));assert.equal(audio.external,false);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('repaired local venv takes precedence even when an old portable marker survives',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'notemender-repaired-'));
  try{
    const local=path.join(root,'.venv','Scripts','python.exe');await mkdir(path.dirname(local),{recursive:true});await writeFile(local,'');await mkdir(path.join(root,'runtime'));await writeFile(path.join(root,'runtime','portable-ready.json'),'{}');
    assert.equal(await pythonFor(root,{owned:true}),local);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('component refresh recovers after analysis activity ends',async()=>{
  let analysing=true;await fixture(async({request})=>{
    assert.equal((await request('status?refresh=1')).body.busy,true);analysing=false;
    const ready=(await request('status?refresh=1')).body;assert.equal(ready.busy,undefined);assert.equal(ready.components.find(c=>c.id==='audio').ready,true);
  },{canStart:()=>!analysing,inspect:async(root,id)=>({ready:id==='audio'})});
});
