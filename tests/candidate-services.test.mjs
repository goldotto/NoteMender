import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {singingService} from '../src/singing-service.mjs';
import {separationService} from '../src/separation.mjs';
import {computeService} from '../src/compute-service.mjs';
const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
async function call(handler,route,body=wav,method='POST',auth='token',onResponse=()=>{}){
  const req=Readable.from([body]),res=new EventEmitter();req.method=method;req.headers={'x-studio-token':auth};res.writableEnded=false;
  let response;const pending=handler(req,res,new URL('http://localhost'+route),(status,body)=>{response={status,body};res.writableEnded=true;},'token');onResponse(res);await pending;return response;
}
async function environment(){const root=await mkdtemp(path.join(tmpdir(),'candidate-services-'));for(const dir of ['.venv/Scripts','runtime/acceleration/gpu','runtime/singing'])await mkdir(path.join(root,dir),{recursive:true});for(const name of ['.venv/Scripts/python.exe','runtime/acceleration/gpu/ready.json','runtime/singing/ready.json','runtime/demucs-ready.json','runtime/demucs6-ready.json'])await writeFile(path.join(root,name),'{}');return root;}
test('singing authenticates, rejects CPU, caches by model fingerprint, cancels and restarts cleanly',async()=>{
  const root=await environment();let calls=0,cancel=false,killed=false,cancelResponse=null;
  const handler=singingService(root,{spawnImpl:(command,args)=>{calls++;const c=new EventEmitter();c.stderr=new EventEmitter();c.exitCode=null;c.kill=()=>{killed=true;c.exitCode=143;c.emit('close',143);};setTimeout(async()=>{if(cancel){cancel=false;setTimeout(()=>cancelResponse.emit('close'),0);return;}await writeFile(args[2],JSON.stringify({events:[{start:0,end:1,midi:60}],wordBoundaries:[.5],pitchFrames:[]}));c.exitCode=0;c.emit('close',0);},5);return c;}});
  try{
    assert.equal((await call(handler,'/api/singing/status',wav,'GET','bad')).status,403);
    assert.equal((await call(handler,'/api/singing/analyse?device=cpu')).status,400);
    const route='/api/singing/analyse?device=cuda&compute=performance';
    assert.equal((await call(handler,route)).body.events.length,1);assert.equal((await call(handler,route)).body.cacheHit,true);assert.equal(calls,1);
    await writeFile(path.join(root,'runtime/singing/ready.json'),JSON.stringify({fingerprints:{model:'new'}}));
    cancel=true;assert.equal((await call(handler,route,wav,'POST','token',res=>{cancelResponse=res;})).status,400);assert.equal(killed,true);
    assert.equal((await readdir(path.join(root,'runtime/singing'))).some(n=>n.startsWith('task-')),false);
    assert.equal((await call(handler,route)).status,200);assert.equal(calls,3);
    await writeFile(path.join(root,'runtime/singing/ready.json'),JSON.stringify({fingerprints:{model:'new'},compute:{torchVersion:'new-runtime'}}));
    assert.equal((await call(handler,route)).status,200);assert.equal(calls,4);
  }finally{await handler.close();await rm(root,{recursive:true,force:true});}
});
test('six-stem routes retain resources after restart, distinguish source ranges and reject invalid boundaries',async()=>{
  const root=await environment();let calls=0,children=[];
  const handler=separationService(root,{spawnImpl:(cmd,args,options)=>{calls++;const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{};children.push(c);return c;}});
  try{
    const route='/api/separation/start?model=htdemucs_6s&start=10&end=14&compute=performance&device=cuda';
    assert.equal((await call(handler,route.replace('end=14','end=9'))).status,400);assert.equal(calls,0);
    const started=await call(handler,route),job=started.body.id,dir=path.join(root,'runtime/job-'+job);
    for(const source of ['vocals','other','bass','drums','guitar','piano','instrumental'])await writeFile(path.join(dir,source+'.wav'),wav);
    await writeFile(path.join(dir,'stems.json'),JSON.stringify({sources:['vocals','other','bass','drums','guitar','piano','instrumental']}));children.at(-1).emit('close',0);
    const done=await call(handler,'/api/separation/job/'+job,wav,'GET');assert.equal(done.body.resources.length,7);
    assert.equal((await call(handler,route)).body.cached,true);assert.equal(calls,1);
    const restarted=separationService(root);assert.deepEqual((await call(restarted,'/api/separation/track/'+job+'/guitar',wav,'GET')).body,wav);restarted.close();
    assert.equal((await call(handler,route.replace('start=10&end=14','start=20&end=24'))).status,202);assert.equal(calls,2);children.at(-1).emit('close',1);
  }finally{handler.close();await rm(root,{recursive:true,force:true});}
});
test('device status refresh does not start another model during stem or singing analysis',async()=>{
  let calls=0;const handler=computeService('unused',{canStart:()=>false,runner:{request:()=>{calls++;throw Error('must not run');},close:()=>{}}});
  const status=await call(handler,'/api/compute/status',wav,'GET');assert.equal(status.body.busy,true);assert.equal(calls,0);
  assert.equal((await call(handler,'/api/analysis/basic-pitch')).status,409);assert.equal(calls,0);
});
test('simultaneous initial device queries await one probe instead of freezing a task with empty capabilities',async()=>{
  let calls=0;const runner={request:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return {providers:[]};},close:()=>{}};
  const handler=computeService('unused',{runner});const [a,b]=await Promise.all([call(handler,'/api/compute/status',wav,'GET'),call(handler,'/api/compute/status',wav,'GET')]);
  assert.equal(calls,1);assert.equal(a.body.busy,undefined);assert.deepEqual(a.body,b.body);assert.equal(typeof a.body.backends.cpu.qualified,'boolean');
});
