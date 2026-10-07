import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {lyricsService} from '../src/lyrics-service.mjs';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'qwen-lyrics-test-')),directory=path.join(root,'runtime','lyrics-qwen');
  await mkdir(path.join(root,'scripts'));await writeFile(path.join(root,'scripts/qwen-download-manifest.json'),JSON.stringify({asr:{folder:'Qwen3-ASR-0.6B'},aligner:{folder:'Qwen3-ForcedAligner-0.6B'}}));await mkdir(path.join(root,'.venv/Scripts'),{recursive:true});await writeFile(path.join(root,'.venv/Scripts/python.exe'),'');
  const marker={engine:'qwen3-asr',model:'Qwen3-ASR-0.6B',aligner:'Qwen3-ForcedAligner-0.6B',fingerprint:'f'.repeat(64)};
  await mkdir(path.join(directory,'dependencies','qwen_asr'),{recursive:true});await writeFile(path.join(directory,'dependencies','qwen_asr','__init__.py'),'');
  for(const name of [marker.model,marker.aligner]){await mkdir(path.join(directory,'models',name),{recursive:true});await writeFile(path.join(directory,'models',name,'config.json'),'{}');await writeFile(path.join(directory,'models',name,'model.safetensors'),'fixture');}
  await writeFile(path.join(directory,'ready.json'),JSON.stringify(marker));
  const resourceId='a'.repeat(64),resource=path.join(root,'runtime','audio-resources',resourceId);await mkdir(resource,{recursive:true});await writeFile(path.join(resource,'metadata.json'),JSON.stringify({source:'vocals',audioStart:40,audioEnd:55}));
  return {root,directory,resourceId};
}
function response(){return Object.assign(new EventEmitter(),{destroyed:false});}
function request(body,method='POST'){return {headers:{'x-studio-token':'test'},method,async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};}
async function call(service,route,body){let result;await service(request(body,body?'POST':'GET'),response(),new URL('http://localhost/api/lyrics/'+route),(code,data)=>result={code,data},'test');return result;}
test('a rejected concurrent lyric request cannot release or cancel the active request',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),service=lyricsService('/missing-components');
  const response=()=>Object.assign(new EventEmitter(),{destroyed:false});
  const req={headers:{'x-studio-token':'test'},method:'POST',async *[Symbol.asyncIterator](){await gate;yield Buffer.from(JSON.stringify({resourceId:'a'.repeat(64),from:0,to:1}));}};
  const first=[];const pending=service(req,response(),new URL('http://localhost/api/lyrics/transcribe'),(code,body)=>first.push({code,body}),'test');
  assert.equal(service.busy(),true);
  const other=response(),rejected=[];
  await service(req,other,new URL('http://localhost/api/lyrics/transcribe'),(code,body)=>rejected.push({code,body}),'test');
  other.emit('close');assert.match(rejected[0].body.error,/运行中/);assert.equal(service.busy(),true);
  release();await pending;assert.equal(service.busy(),false);assert.match(first[0].body.error,/尚未安装/);
});
test('lyric capability discovery requires the local session token',async()=>{
  const service=lyricsService('/missing-components'),sent=[];
  await service({headers:{},method:'GET'},new EventEmitter(),new URL('http://localhost/api/lyrics/status'),(code)=>sent.push(code),'test');
  assert.deepEqual(sent,[403]);assert.equal(service.busy(),false);
});

test('Qwen capability cannot mistake the old Whisper install for the new engine',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'old-lyrics-test-'));
  try{await mkdir(path.join(root,'runtime','lyrics'),{recursive:true});await writeFile(path.join(root,'runtime','lyrics','ready.json'),JSON.stringify({model:'medium'}));const result=await call(lyricsService(root),'status');assert.equal(result.data.ready,false);assert.equal(result.data.engine,'qwen3-asr');}finally{await rm(root,{recursive:true,force:true});}
});

test('Qwen requests use its isolated runner, keep original seconds, report progress and cache by engine',async()=>{
  const {root,directory,resourceId}=await fixture();let count=0,captured,current;
  const service=lyricsService(root,{spawnImpl:(python,args,options)=>{
    count++;captured={args,options};const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});
    setImmediate(async()=>{try{const params=JSON.parse(await readFile(args[1],'utf8'));child.stdout.write(JSON.stringify({stage:'逐字对齐',progress:.75})+'\n');current=(await call(service,'status')).data.job;await writeFile(params.output,JSON.stringify({engine:'qwen3-asr',model:'Qwen3-ASR-0.6B',device:params.device,precision:'fp32',language:'zh',segments:[{text:'歌',chars:[{char:'歌',start:params.from+.1,end:params.to-.1,source:'qwen3-forced-aligner'}]}]}));child.exitCode=0;child.emit('close',0);}catch(error){child.emit('error',error);}});return child;
  }});
  try{
    const capability=await call(service,'status');assert.equal(capability.data.ready,true);assert.equal(capability.data.model,'Qwen3-ASR-0.6B');
    const params={resourceId,from:42,to:48,language:'zh',device:'cpu'},first=await call(service,'transcribe',params);assert.equal(first.code,200);assert.equal(first.data.cacheHit,false);assert.equal(first.data.segments[0].chars[0].start,42.1);assert.equal(first.data.identity.engine,'qwen3-asr');assert.equal(first.data.identity.adapter,5);
    assert.equal(path.basename(captured.args[0]),'qwen_lyrics_analysis.py');assert.equal(captured.options.env.HF_HUB_OFFLINE,'1');assert.equal(captured.options.env.PYTHONPATH.split(path.delimiter)[0],path.join(directory,'dependencies'));assert.deepEqual(current,{stage:'逐字对齐',progress:.75});
    const cached=await call(service,'transcribe',params);assert.equal(cached.data.cacheHit,true);assert.equal(count,1);
    const align=await call(service,'align',{...params,text:'歌词'});assert.equal(align.code,200);assert.equal(count,2);assert.equal(service.busy(),false);assert.equal((await readdir(directory)).some(name=>name.startsWith('task-')),false);
    const outside=await call(service,'transcribe',{...params,from:0});assert.equal(outside.code,400);assert.match(outside.data.error,/未覆盖/);assert.equal(count,2);
  }finally{await rm(root,{recursive:true,force:true});}
});
