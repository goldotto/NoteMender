import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseSoundfont,installSoundfont,soundfontService} from '../src/soundfonts.mjs';
import {SAMPLE_TIMBRES} from '../public/timbre-catalog.mjs';
import {soundfontLocation,inspectSoundfont} from '../src/soundfonts.mjs';
import {fileURLToPath} from 'node:url';
test('all four bundled banks are complete and work without runtime installation',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  for(const spec of SAMPLE_TIMBRES){const where=await soundfontLocation(root,spec.id);assert.equal(where.builtin,true);assert.equal((await inspectSoundfont(root,spec.id,where)).ready,true);}
});

test('soundfont parsing accepts data only, checks hash, and requires all piano-range notes',()=>{
  const names=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'],samples={};for(let m=21;m<=108;m++)samples[names[m%12]+(Math.floor(m/12)-1)]='data:audio/mp3;base64,AAAA';
  const bytes=Buffer.from('/* wrapper is not executed */ MIDI.Soundfont.fixture = '+JSON.stringify(samples)+';'),spec={instrument:'fixture',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.equal(Object.keys(parseSoundfont(bytes,spec)).length,88);
  assert.throws(()=>parseSoundfont(Buffer.concat([bytes,Buffer.from('x')]),spec),/校验失败/);
  const script=Buffer.from('MIDI.Soundfont.fixture = (()=>{throw 1})()');assert.throws(()=>parseSoundfont(script,{...spec,size:script.length,sha256:createHash('sha256').update(script).digest('hex')}),SyntaxError);
});
test('bad source falls back, never installs corrupt data; cancel removes partial files',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'soundfont-test-'));try{
    let calls=0;await assert.rejects(installSoundfont(root,'piano',{fetchImpl:async()=>{calls++;return new Response('corrupt');}}),/采样下载未完成/);assert.equal(calls,3);
    assert.deepEqual(await readdir(path.join(root,'runtime','soundfonts')),[]);
    const controller=new AbortController();await assert.rejects(installSoundfont(root,'piano',{signal:controller.signal,fetchImpl:async()=>{controller.abort();return new Response('partial');}}),/abort/i);
    assert.deepEqual(await readdir(path.join(root,'runtime','soundfonts')),[]);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('sample reads require the local session and reject arbitrary file paths',async()=>{
  const service=soundfontService('unused-root');let response;const send=(status,body)=>response={status,body};
  await service({headers:{},method:'GET'},null,new URL('http://local/api/timbres/piano'),send,'token');assert.equal(response.status,403);
  await service({headers:{'x-studio-token':'token'},method:'GET'},null,new URL('http://local/api/timbres/arbitrary-file'),send,'token');assert.equal(response.status,404);
});
