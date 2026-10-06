import test from 'node:test';
import assert from 'node:assert/strict';
import {stitchEvidence,ownEvents,shiftEvidence,quantizationEvidence} from '../public/recognition-evidence.mjs';
import {detectMonophonicV2,segmentPitchFrames} from '../src/transcription-v2.mjs';
import {melodyPath,processEvidence} from '../public/recognition-v2.mjs';
import {analysisKey,analysisKeys,baseEvidence} from '../public/analysis-cache.mjs';
import {makeDemo,validateProject,KEYS,quantizeNotes} from '../public/music.mjs';
import {timeAtBeat} from '../public/time-map.mjs';

test('repeated same pitch survives touching attacks; cross-window duplicates alone are joined',()=>{
  const notes=[{start:0,end:.05,midi:60,eventId:'a',source:'vocals',windowId:'one'},{start:.05,end:.11,midi:60,eventId:'b',source:'vocals',windowId:'two'}];
  assert.equal(stitchEvidence(notes).length,2);
  assert.equal(melodyPath(notes,{continuity:true}).length,2);
  const decisions=[],joined=stitchEvidence([{...notes[0],end:1,detectedStart:0,detectedEnd:1},{...notes[0],start:.5,end:1.02,windowId:'two',detectedStart:.02,detectedEnd:1.02}],decisions);
  assert.equal(joined.length,1);assert.equal(decisions[0].kind,'跨窗口去重');
});
test('experimental trackers reuse Basic Pitch acquisition without leaking their frames into the base cache',async()=>{
  const audio=new Float32Array([.1,.2]),options={source:'vocals',minMidi:45,maxMidi:88,pipeline:'corrected'};
  const base=await analysisKeys(audio,'adaptive',options),pyin=await analysisKeys(audio,'adaptive',{...options,pipeline:'pyin'}),crepe=await analysisKeys(audio,'adaptive',{...options,pipeline:'crepe'});
  assert.equal(base.base,pyin.base);assert.equal(pyin.base,crepe.base);assert.notEqual(pyin.combined,crepe.combined);
  assert.deepEqual(baseEvidence({rawBasic:[],pitchFrames:[],externalEngine:'pyin',externalFrames:[{hz:440}]}),{rawBasic:[],pitchFrames:[]});
});
test('quantization trace reports the actual retained attack when two same-pitch notes collide',()=>{
  const raw=[{evidenceId:'quiet',start:0,end:.02,midi:60,confidence:.2},{evidenceId:'strong',start:.02,end:.04,midi:60,confidence:.9}],trace=[];
  const notes=quantizeNotes(raw,60,0,.0625,trace),project={bpm:60,offset:0,notes:[]};
  assert.equal(notes.length,1);assert.equal('evidenceId' in notes[0],false);
  const diagnostic=quantizationEvidence(raw,notes,project,timeAtBeat,trace);
  assert.equal(diagnostic.decisions[0].kind,'量化后未保留');assert.equal(diagnostic.decisions[1].kind,'节奏量化');
});
test('tiny detected events stay in the owning window and diagnostic times remain audio seconds',()=>{
  const notes=ownEvents([{start:.4,end:.44,midi:60}],10,10,11,{windowId:'w'});
  assert.equal(notes.length,1);assert.equal(notes[0].start,10.4);
  assert.equal(ownEvents([{start:.4,end:.44,midi:60}],10,10,11,{legacy:true}).length,0);
  const decisions=[];ownEvents([{start:.4,end:.44,midi:60}],10,10,11,{legacy:true,decisions});assert.equal(decisions[0].kind,'现版窗口短音过滤');
  assert.equal(ownEvents([{start:NaN,end:1,midi:60}],0,0,1).length,0);
  const shifted=shiftEvidence({rawBasic:[{start:0,end:.1,midi:60}],pitchFrames:[{second:0,hz:261.6}],decisions:[{second:0,end:.1,kind:'a'}]},10);
  assert.equal(shifted.pitchFrames[0].second,10);assert.equal(shifted.decisions[0].end,10.1);
});
test('pitch stays continuous until segmentation; an acoustic attack splits repeated pitch',()=>{
  const frames=Array.from({length:20},(_,i)=>({second:i*.01,pitch:60+.15*Math.sin(i),voiced:true,confidence:.95}));
  const notes=segmentPitchFrames(frames,[{second:.1,confidence:.9}]);
  assert.equal(notes.length,2);assert.deepEqual(notes.map(n=>n.midi),[60,60]);
  assert.equal(segmentPitchFrames(frames,[{second:.1,confidence:.9}],{repeatedNotes:false}).length,1);
});
test('low-level pitched recordings survive adaptive energy and silence produces no notes',()=>{
  const sr=22050,samples=new Float32Array(sr);for(let i=sr*.2;i<sr*.8;i++)samples[Math.floor(i)]=.0008*Math.sin(2*Math.PI*440*i/sr);
  const result=detectMonophonicV2(samples,sr,{minMidi:45,maxMidi:88});
  assert.ok(result.notes.some(n=>n.midi===69));assert.ok(result.frames.some(f=>f.hz>0&&f.pitch!==Math.round(f.pitch)));
  assert.deepEqual(detectMonophonicV2(new Float32Array(sr),sr).notes,[]);
});
test('short notes and real octave leaps survive; low energy is marked instead of erased',()=>{
  const samples=new Float32Array(22050).fill(.0001),raw={rawBasic:[{start:0,end:.05,midi:60,confidence:.9,eventId:'a'},{start:.1,end:.5,midi:72,confidence:.9,eventId:'b'}],pitchFrames:[],onsets:[]};
  const result=processEvidence(raw,samples,{source:'vocals',pipeline:'corrected'});
  assert.deepEqual(result.notes.map(n=>n.midi),[60,72]);assert.ok(result.notes[0].reviewFlags.includes('短音待核对'));
  const ablated=processEvidence(raw,samples,{source:'vocals',pipeline:'corrected',ablation:'short'});
  assert.deepEqual(ablated.notes.map(n=>n.midi),[72]);assert.ok(ablated.evidence.rawBasic.some(n=>n.midi===60));
});
test('melody output is monophonic and source provenance survives competition',()=>{
  const result=melodyPath([{start:0,end:.5,midi:60,confidence:.9,eventId:'a',source:'vocals'},{start:0,end:.5,midi:72,confidence:.1,eventId:'b',source:'vocals'},{start:.5,end:1,midi:62,confidence:.9,eventId:'c',source:'vocals'}]);
  assert.deepEqual(result.map(n=>n.midi),[60,62]);assert.ok(result.every((n,i)=>!i||n.start>=result[i-1].end));assert.equal(result[0].source,'vocals');
  assert.deepEqual(melodyPath([{start:0,end:.5,midi:60,confidence:.9},{start:.5,end:1,midi:62,confidence:.9}]).map(n=>n.midi),[60,62]);
});
test('cache identity follows waveform and acquisition settings, not downstream rule changes',async()=>{
  const samples=new Float32Array([.1,.2,.3]),options={source:'vocals',minMidi:45,maxMidi:88,pipeline:'corrected',ablation:'none'};
  const key=await analysisKey(samples,'adaptive',options);
  assert.equal(key,await analysisKey(samples,'adaptive',{...options,ablation:'fusion',strategy:'strongest'}));
  assert.notEqual(key,await analysisKey(samples,'adaptive',{...options,minMidi:21}));
  assert.notEqual(key,await analysisKey(new Float32Array([.1,.2,.4]),'adaptive',options));
  assert.notEqual(key,await analysisKey(samples,'adaptive',{...options,pipeline:'pyin'}));
});
test('new stem candidates and old projects roundtrip without altering formal notes',()=>{
  assert.equal(KEYS.length,12);assert.equal(KEYS[11],'B');
  const old=validateProject(makeDemo()),next=validateProject({...old,sections:[{id:'s',name:'器乐',audioStart:0,audioEnd:2,source:'bass',analysisUsed:[{from:0,to:2,mode:'dense',source:'instrumental'}]}],alternates:[{source:'bass',sectionId:'s',method:'低声部',notes:[{start:0,duration:.25,midi:30}]}]});
  assert.deepEqual(next.notes,old.notes);assert.equal(next.sections[0].source,'bass');assert.equal(next.sections[0].analysisUsed[0].source,'instrumental');assert.equal(next.alternates[0].source,'bass');
  const evidence=quantizationEvidence([{start:0,end:.2,midi:60}],[{start:0,duration:.5,midi:60}],{...old,bpm:120,timeAnchors:[]},timeAtBeat);
  assert.equal(evidence.events[0].end,.25);assert.ok(Math.abs(evidence.decisions[0].endErrorMs-50)<1e-8);
});
test('unsupported tiny attacks remain raw alternatives rather than flooding the primary melody',()=>{
  const raw={rawBasic:[{start:0,end:.02,midi:60,confidence:.2},{start:.1,end:.15,midi:62,confidence:.7,onsetConfidence:.8}],pitchFrames:[],onsets:[]};
  const result=processEvidence(raw,new Float32Array(22050),{source:'original',analysisMode:'dense'});
  assert.deepEqual(result.notes.map(n=>n.midi),[62]);assert.equal(result.evidence.rawBasic.length,2);
  assert.ok(result.alternates.find(a=>a.id==='raw-short').notes.some(n=>n.midi===60));
  assert.ok(result.evidence.decisions.some(d=>d.kind==='短音备选待核对'));
});
