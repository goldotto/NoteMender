import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {muscriptorService,muWavDuration,validateMuResult} from '../src/muscriptor-service.mjs';
import {muMelody,muScoreNotes,muscriptorCandidates} from '../public/muscriptor-candidates.mjs';
import {validateProject,makeDemo} from '../public/music.mjs';
import {wavBytes} from '../public/audio.mjs';
import {downloadWeights} from '../scripts/install-muscriptor.mjs';
import {MUSCRIPTOR,muPrecisionPlan,normalizeMuPrecision} from '../public/muscriptor-spec.mjs';

const wav=Buffer.from(wavBytes(new Float32Array(16000),16000));
const base={...makeDemo(),notes:[],lyrics:[],bpm:60,timeAnchors:[{beat:0,second:0},{beat:100,second:100}]};
const sample={id:'mu-1',start:0,end:.4,midi:60,instrument:'piano'};
test('MuScriptor keeps explicit large identity and validates WAV instead of trusting headers',()=>{
  assert.equal(MUSCRIPTOR.variant,'large');assert.equal(MUSCRIPTOR.size,5465642136);assert.equal(muWavDuration(wav),1);
  const stereo=Buffer.from(wav);stereo.writeUInt16LE(2,22);assert.throws(()=>muWavDuration(stereo));assert.throws(()=>muWavDuration(wav.subarray(0,48)));
});
test('MuScriptor preserves short retriggered notes and separates instrument families',()=>{
  const raw=[sample,{...sample,id:'mu-2',start:.4,end:.43},{...sample,id:'mu-3',start:.43,end:.8,midi:62}];
  assert.equal(muMelody(raw).length,3);
  const value=muscriptorCandidates({notes:[...raw,{...sample,id:'mu-4',instrument:'guitar'},{...sample,id:'mu-5',instrument:'drums'}],analysisId:'a'.repeat(64),duration:1},base,0,'s');
  assert.equal(value.variants.length,6);assert.ok(value.variants.every(v=>v.instrument!=='drums'));
  assert.equal(muScoreNotes([sample,{...sample,id:'fast',start:.01,end:.03}],base,0).gridCollisions,1,'grid collisions are explicitly reported');
  const checked=validateProject({...base,notes:value.variants[0].notes,alternates:value.variants});assert.equal(checked.alternates[0].analysisId,'a'.repeat(64));assert.equal(checked.alternates[0].instrument,'guitar');
});
test('MuScriptor uses the full nonlinear time map and produces a valid monophonic score',()=>{
  const map={...base,timeAnchors:[{beat:0,second:0},{beat:8,second:4},{beat:12,second:8}]};
  const result=muScoreNotes([{...sample,start:0,end:2}],map,4);assert.equal(result.notes[0].start,8);assert.equal(result.notes[0].duration,2);
  validateProject({...map,notes:result.notes});
  assert.equal(muMelody([sample,{...sample,id:'b',midi:72}],'high')[0].midi,72);assert.equal(muMelody([sample,{...sample,id:'b',midi:72}],'low')[0].midi,60);
});
test('MuScriptor prioritizes actual voice over guitar and groups chord onset jitter without losing retriggers',()=>{
  const notes=[{...sample,instrument:'acoustic_guitar'},{...sample,id:'v',instrument:'voice',midi:72}];
  assert.equal(muscriptorCandidates({notes,analysisId:'a'.repeat(64),duration:1},base,0,'s').variants[0].instrument,'voice');
  const chord=[sample,{...sample,id:'upper',midi:72,start:.012},{...sample,id:'next',midi:74,start:.4,end:.8}];
  const selected=muMelody(chord);assert.equal(selected.length,2);assert.equal(selected[0].midi,72);
  assert.equal(muMelody([sample,{...sample,id:'repeat',start:.01,end:.2}]).length,2);
  assert.equal(muMelody([{...sample,end:.01},{...sample,id:'fast-next',midi:62,start:.015,end:.03}]).length,2,'non-overlapping fast notes are not mistaken for a chord');
  assert.deepEqual(chord[0],sample,'raw data remains unchanged');
});
test('MuScriptor validates precision by device and rejects malformed evidence',()=>{
  const value={notes:[sample],device:'cpu',precision:'fp32'};assert.equal(validateMuResult(value,1),value);
  assert.throws(()=>validateMuResult({...value,notes:[sample,sample]},1));assert.throws(()=>validateMuResult({...value,precision:'fp16'},1));assert.throws(()=>validateMuResult({...value,notes:[{...sample,end:5}]},1));
  for(const precision of ['fp16','bf16','fp32'])assert.equal(validateMuResult({...value,device:'cuda',precision},1).precision,precision);
  assert.throws(()=>validateMuResult({...value,device:'cuda',precision:'int8'},1));
});
test('MuScriptor auto uses FP16 on CUDA and FP32 on CPU',()=>{
  assert.equal(normalizeMuPrecision('bad'),'auto');
  assert.deepEqual(muPrecisionPlan('cpu','bf16',true),[{device:'cpu',precision:'fp32'}]);
  assert.equal(muPrecisionPlan('cuda','auto',true)[0].precision,'fp16');
  assert.equal(muPrecisionPlan('cuda','auto',false)[0].precision,'fp16');
  assert.deepEqual(muPrecisionPlan('cuda','fp32'),[{device:'cuda',precision:'fp32'},{device:'cpu',precision:'fp32'}]);
});
async function call(handler,route,{body=wav,method='POST',auth='token',onResponse=()=>{}}={}){
  const req=Readable.from([body]),res=new EventEmitter();req.method=method;req.headers={'x-studio-token':auth};let response;res.writableEnded=false;
  const pending=handler(req,res,new URL('http://localhost'+route),(status,body)=>{res.writableEnded=true;response={status,body};},'token');onResponse(res);await pending;return response;
}
test('MuScriptor authenticates, caches CPU/CUDA separately and falls back without changing the model',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mu-service-'));let calls=0,failGPU=true;
  const handler=muscriptorService(root,{runtimeFor:async()=>({python:'python',directory:root,env:{}}),inspect:async()=>({ready:true,torchVersion:'test'}),spawnImpl:(cmd,args)=>{
    calls++;const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.exitCode=null;c.kill=()=>{};
    setTimeout(async()=>{const device=args[args.indexOf('--device')+1];if(device==='cuda'&&failGPU){c.exitCode=42;c.emit('close',42);return;}
      const output=args[args.indexOf('--output')+1],precision=args[args.indexOf('--precision')+1];await writeFile(output,JSON.stringify({notes:[sample],duration:1,device,precision}));await writeFile(output.replace('.json','.mid'),'MThd');c.exitCode=0;c.emit('close',0);},5);return c;
  }});
  try{
    assert.equal((await call(handler,'/api/muscriptor/status',{method:'GET',auth:'bad'})).status,403);
    const first=await call(handler,'/api/muscriptor/analyse?compute=performance&device=cuda');assert.equal(first.status,200);assert.equal(first.body.device,'cpu');assert.ok(first.body.fallbackReason.includes('large'));assert.equal(calls,2);
    const cached=await call(handler,'/api/muscriptor/analyse?device=cpu');assert.equal(cached.body.cacheHit,true);assert.equal(calls,2);
    failGPU=false;const gpu=await call(handler,'/api/muscriptor/analyse?compute=performance&device=cuda');assert.equal(gpu.body.device,'cuda');assert.notEqual(gpu.body.analysisId,first.body.analysisId);
    const midi=await call(handler,`/api/muscriptor/result/${gpu.body.analysisId}/midi`,{method:'GET'});assert.equal(midi.status,200);
    assert.equal((await readdir(path.join(root,'runtime/muscriptor/cache'))).some(x=>x.startsWith('task-')),false);
  }finally{await handler.close();await rm(root,{recursive:true,force:true});}
});

test('MuScriptor isolates precision caches, retries numeric failure in FP32 and rejects mislabeled output',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mu-precision-'));const calls=[];let failHalf=false,mismatch=false;
  const handler=muscriptorService(root,{runtimeFor:async()=>({python:'python',directory:root,env:{}}),inspect:async()=>({ready:true,torchVersion:'test',bf16:true}),spawnImpl:(cmd,args)=>{
    const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.exitCode=null;c.kill=()=>{};
    const precision=args[args.indexOf('--precision')+1],device=args[args.indexOf('--device')+1];calls.push({precision,device});
    setImmediate(async()=>{if(failHalf&&precision!=='fp32'){c.exitCode=43;c.emit('close',43);return;}
      const output=args[args.indexOf('--output')+1];await writeFile(output,JSON.stringify({notes:[sample],device,precision:mismatch?'bf16':precision}));await writeFile(output.replace('.json','.mid'),'MThd');c.exitCode=0;c.emit('close',0);
    });return c;
  }});
  const route='/api/muscriptor/analyse?compute=performance&device=cuda&precision=';
  try{
    const results=[];for(const p of ['fp32','fp16','bf16']){const r=await call(handler,route+p);assert.equal(r.status,200);assert.equal(r.body.precision,p);results.push(r.body.analysisId);}
    assert.equal(new Set(results).size,3);assert.equal(calls.length,3);
    const auto=await call(handler,route+'auto');assert.equal(auto.body.precision,'fp16');assert.equal(auto.body.cacheHit,true);assert.equal(calls.length,3);
    assert.equal((await call(handler,route+'int8')).status,400);assert.equal(calls.length,3);
    const other=Buffer.from(wav);other[100]=1;failHalf=true;
    const fallback=await call(handler,route+'fp16',{body:other});assert.equal(fallback.status,200);assert.equal(fallback.body.precision,'fp32');assert.match(fallback.body.fallbackReason,/FP16.*FP32/);assert.deepEqual(calls.slice(-2).map(x=>x.precision),['fp16','fp32']);
    failHalf=false;mismatch=true;other[100]=2;
    const bad=await call(handler,route+'fp16',{body:other});assert.equal(bad.status,400);assert.match(bad.body.error,/精度/);
  }finally{await handler.close();await rm(root,{recursive:true,force:true});}
});
test('MuScriptor request cancellation kills the analysis and removes only its task directory',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mu-cancel-'));let res,killed=false;
  const handler=muscriptorService(root,{runtimeFor:async()=>({python:'python',directory:root,env:{}}),inspect:async()=>({ready:true}),spawnImpl:()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.exitCode=null;c.kill=()=>{killed=true;c.exitCode=143;c.emit('close',143);};setTimeout(()=>res.emit('close'),0);return c;}});
  try{const result=await call(handler,'/api/muscriptor/analyse',{onResponse:r=>res=r});assert.equal(result.status,499);assert.ok(killed);assert.equal(handler.busy(),false);assert.equal((await readdir(path.join(root,'runtime/muscriptor/cache'))).length,0);}
  finally{await handler.close();await rm(root,{recursive:true,force:true});}
});
test('missing large weights give an actionable error without starting inference',async()=>{
  let spawned=false;
  const handler=muscriptorService('unused',{runtimeFor:async()=>({}),inspect:async()=>({ready:false,reason:'MuScriptor large 尚未安装'}),spawnImpl:()=>{spawned=true;throw Error('must not run');}});
  const result=await call(handler,'/api/muscriptor/analyse');
  assert.equal(result.status,400);assert.match(result.body.error,/large 尚未安装/);assert.equal(spawned,false);assert.equal(handler.busy(),false);
});
test('gated download fails with helpful text and never exposes the token',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mu-download-'));const secret='hf_TestOnlyNotReal';let requested;
  try{await assert.rejects(downloadWeights(path.join(root,'weights'),{token:secret,fetchImpl:async(url,options)=>{requested={url,options};return new Response('',{status:403});}}),error=>error.message.includes('large')&&!error.message.includes(secret));assert.ok(requested.url.startsWith('https://huggingface.co/MuScriptor/muscriptor-large/resolve/'));assert.equal(requested.options.headers.Authorization,'Bearer '+secret);}
  finally{await rm(root,{recursive:true,force:true});}
});
