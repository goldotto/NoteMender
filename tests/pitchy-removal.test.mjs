import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {estimateTempo} from '../src/transcription.mjs';
import {energyProfile} from '../src/transcription-v2.mjs';
import {legacyResult} from '../src/legacy-evidence.mjs';
import {processEvidence} from '../public/recognition-v2.mjs';
import {EVIDENCE_VERSION} from '../public/recognition-evidence.mjs';
import {chooseAnalysisMode} from '../public/adaptive-strategy.mjs';
import {validateProject,makeDemo} from '../public/music.mjs';
const samples=new Float32Array(22050).fill(.05),note={start:0,end:.5,midi:60,confidence:.8};
const oldFrames=Array.from({length:80},(_,i)=>({second:i*.01,pitch:80,voiced:true,confidence:.99,rms:.05}));
test('improved path ignores retired frames and keeps Basic Pitch short-note alternatives',()=>{
 const result=processEvidence({rawBasic:[note,{start:.6,end:.62,midi:64,confidence:.2}],rawMono:[{...note,midi:80}],pitchFrames:oldFrames},samples,{source:'vocals',analysisMode:'solo'});
 assert.deepEqual(result.notes.map(n=>n.midi),[60]);assert.equal(result.diagnostics.monoCount,0);assert.ok(result.alternates.every(a=>!a.label.includes('Pitchy')));
 assert.deepEqual(result.alternates.find(a=>a.id==='raw-short').notes.map(n=>n.midi),[60,64]);
});
for(const engine of ['pyin','crepe'])test(engine+' external evidence still works',()=>{
 const result=processEvidence({rawBasic:[],externalEngine:engine,externalFrames:oldFrames},samples,{analysisMode:'solo'});
 assert.deepEqual(result.notes.map(n=>n.midi),[80]);assert.equal(result.alternates.find(a=>a.id==='external-pitch').label,engine+' 连续音高分音');
});
test('automatic mode distinguishes monophonic and polyphonic Basic Pitch events',()=>{
 assert.equal(chooseAnalysisMode({basic:[{...note,end:.8}],windowSeconds:1}),'solo');
 assert.equal(chooseAnalysisMode({basic:[{...note,end:.8},{...note,end:.8,midi:72}],windowSeconds:1}),'dense');
});
test('historical Pitchy candidates survive project roundtrip',()=>{
 const old=makeDemo();old.alternates=[{id:'old',source:'vocals',method:'Pitchy',notes:[{id:'n',start:0,duration:1,midi:60}]}];
 const p=validateProject(old),restored=validateProject(JSON.parse(JSON.stringify(p)));
 assert.deepEqual(restored.alternates,p.alternates);assert.deepEqual(restored.notes,p.notes);
});
test('actual worker supports fresh and cached Basic paths and rejects retired engine before loading',async()=>{
 const code=(await readFile(new URL('../src/worker.mjs',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n');
 let loads=0,scopes=0;const messages=[];
 const context=vm.createContext({self:{postMessage:m=>messages.push(m)},estimateTempo,energyProfile,legacyResult,processEvidence,EVIDENCE_VERSION,
  BasicPitch:class{constructor(){loads++;this.model=Promise.resolve();}async evaluateModel(audio,output){output([[0]],[[0]]);}},
  tf:{setBackend:async()=>{},ready:async()=>{},engine:()=>({startScope:()=>scopes++,endScope:()=>scopes--})},
  nativeBasic:async()=>{throw Error('unexpected native call');},outputToNotesPoly:()=>[{startFrame:0}],noteFramesToTime:()=>[{startTimeSeconds:0,durationSeconds:.5,pitchMidi:60,amplitude:.8}]
 });vm.runInContext(code,context);
 for(const pipeline of ['legacy','corrected']){
  messages.length=0;await context.self.onmessage({data:{samples,engine:'basic',options:{pipeline,minMidi:45,maxMidi:88,source:'vocals'}}});
  const result=messages.find(m=>m.type==='result');assert.ok(result,messages.at(-1)?.message);assert.deepEqual(Array.from(result.notes,n=>n.midi),[60]);assert.equal(result.diagnostics.monoCount,0);assert.equal(scopes,0);
  messages.length=0;await context.self.onmessage({data:{samples,engine:'adaptive',options:{pipeline,rawEvidence:{rawBasic:[note],rawMono:[{...note,midi:80}],pitchFrames:oldFrames},analysisMode:'solo'}}});
  const cached=messages.find(m=>m.type==='result');assert.ok(cached.cacheHit);assert.deepEqual(Array.from(cached.notes,n=>n.midi),[60]);assert.equal(cached.diagnostics.monoCount,0);
 }
 const before=loads;messages.length=0;await context.self.onmessage({data:{samples,engine:'pitchy',options:{rawEvidence:{rawBasic:[note]}}}});
 assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).message,/已停用/);assert.equal(loads,before);
 messages.length=0;await context.self.onmessage({data:{samples,engine:'tempo'}});assert.equal(messages[0].type,'tempo');
});
