import test from 'node:test';
import assert from 'node:assert/strict';
import {SYNTH_TIMBRES,SAMPLE_TIMBRES,sampleURLs} from '../public/timbre-catalog.mjs';
import {prepareTimbre,makeTimbreNote,stopTimbreVoices,samplePlaybackGain} from '../public/timbres.mjs';
import {COMPONENTS} from '../public/component-catalog.mjs';

function context(offline=false){const nodes=[];const node=()=>{const n={connect(){},disconnect(){this.disconnected=true;},start(t){this.started=t;},stop(t){this.stopped=t;this.stops=(this.stops||0)+1;},frequency:{value:0}};nodes.push(n);return n;};return {nodes,currentTime:0,...(offline?{startRendering(){}}:{}),createGain(){return Object.assign(node(),{gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}});},createOscillator(){return Object.assign(node(),{setPeriodicWave(){}});},createBufferSource:node,createPeriodicWave(){return {};},async decodeAudioData(){return {duration:1};}};}
test('all built-in voices schedule and release, and stopping live playback leaves offline export intact',()=>{
  for(const voice of SYNTH_TIMBRES){const ctx=context();makeTimbreNote(ctx,{},69,0,.1,.2,voice);assert.ok(ctx.nodes.some(n=>n.started===0));stopTimbreVoices();assert.ok(ctx.nodes.every(n=>n.disconnected));assert.equal(ctx.nodes.at(-1).stops,2);}
  const ctx=context(true);makeTimbreNote(ctx,{},60,1,1);stopTimbreVoices();assert.equal(ctx.nodes.at(-1).stopped,2+SYNTH_TIMBRES[0].release);
});
test('sample bank is loaded once, only requested pitches decoded, missing data is an error',async()=>{
  let requests=0,decodes=0;const ctx=context();ctx.decodeAudioData=async()=>{decodes++;return {duration:1};};
  const fetchBank=async()=>{requests++;return {60:'data:audio/mp3;base64,AAAA',62:'data:audio/mp3;base64,AAAA'};};
  const first=await prepareTimbre(ctx,'sample-piano',[60,60,null],fetchBank);assert.equal(decodes,1);
  await prepareTimbre(ctx,'sample-piano',[60,62],fetchBank);assert.equal(requests,1);assert.equal(decodes,2);
  assert.equal(first.buffers.size,2);makeTimbreNote(ctx,{},60,0,1,.2,first);stopTimbreVoices();
  await assert.rejects(prepareTimbre(ctx,'sample-piano',[63],fetchBank),/缺少/);
});
test('samples have no model dependency and download URLs pin the same immutable revision',()=>{
  assert.ok(COMPONENTS.every(c=>!c.id.startsWith('sound-')));
  for(const spec of SAMPLE_TIMBRES){assert.match(spec.sha256,/^[a-f0-9]{64}$/);const urls=sampleURLs(spec);assert.equal(urls.length,3);for(const u of urls)assert.ok(u.includes('044fab8e1456bfafc5776e86dfd6bb8697149aef'));}
});
test('sample gain lifts quiet banks, caps peaks and does not amplify silence',()=>{
  const buffer=values=>({numberOfChannels:1,sampleRate:1000,getChannelData:()=>Float32Array.from(values)});
  assert.ok(samplePlaybackGain(buffer(Array(500).fill(.03)))>9);
  assert.equal(samplePlaybackGain(buffer(Array(500).fill(0))),1);
  assert.ok(samplePlaybackGain(buffer([1,...Array(499).fill(.001)]))<=.9);
  assert.ok(samplePlaybackGain(buffer(Array(500).fill(.0001)))<=32);
  const ctx=context();let peakGain=0;ctx.createGain=()=>({connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(g){peakGain=Math.max(peakGain,g);},exponentialRampToValueAtTime(){}}});
  makeTimbreNote(ctx,{},60,0,1,.2,{buffers:new Map([[60,{duration:1}]]),gains:new Map([[60,8]]),spec:{}});assert.equal(peakGain,1.6);stopTimbreVoices();
});
