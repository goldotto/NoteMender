import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyResult} from '../src/legacy-evidence.mjs';
const samples=new Float32Array(22050).fill(.05),basic=[{start:0,end:.4,midi:60,confidence:.5},{start:.42,end:.85,midi:62,confidence:.9}],obsolete=[{start:0,end:.85,midi:80,confidence:.99}];
test('legacy paths ignore retired mono evidence and keep audible Basic Pitch notes',()=>{
 for(const engine of ['adaptive','basic','instrumental'])for(const analysisMode of ['auto','vocal','solo','dense']){
  const options={source:'vocals',analysisMode,strategy:'smooth'},result=legacyResult({rawBasic:basic,rawMono:obsolete,pitchFrames:[{pitch:80}]},samples,engine,options);
  assert.deepEqual(result.notes.map(n=>n.midi),[60,62]);assert.deepEqual(result.notes,legacyResult({rawBasic:basic},samples,engine,options).notes);
  assert.equal(result.diagnostics.monoCount,0);assert.deepEqual(result.rawEvidence.rawMono,[]);assert.deepEqual(result.rawEvidence.pitchFrames,[]);assert.ok(result.alternates.every(a=>!a.label.includes('Pitchy')));
 }
});
test('silent vocal events are filtered without a second pitch detector',()=>{
 for(const engine of ['basic','adaptive'])assert.equal(legacyResult({rawBasic:basic},new Float32Array(22050),engine,{source:'vocals'}).notes.length,0);
});
test('retired manual engine is rejected even with cached evidence',()=>{assert.throws(()=>legacyResult({rawBasic:basic,rawMono:obsolete},samples,'pitchy'),/已停用/);});
