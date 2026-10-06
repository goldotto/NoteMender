import test from 'node:test';import assert from 'node:assert/strict';
import {guardMelody,referenceClip,acousticReference} from '../public/grounding.mjs';
import {validateProject,keyAt,transpose,scoreSVG,numberPitch} from '../public/music.mjs';
const ref=[{start:0,end:1,midi:60,confidence:.9},{start:1,end:2,midi:62,confidence:.9}];
test('filters silent model activations and merges corroborated sustained fragments',()=>{
 assert.equal(acousticReference(ref,ref,new Float32Array(44100)).length,0);
 const x=new Float32Array(44100).fill(.1),fragmented=[{start:0,end:.5,midi:60,confidence:.8},{start:.5,end:1,midi:60,confidence:.8}];
 const result=acousticReference(fragmented,[ref[0]],x);assert.equal(result.length,1);assert.equal(result[0].end,1);
});
test('section keys survive save and transposition, keeping numbered degrees consistent',()=>{
 const p=validateProject({version:1,bpm:92,key:3,meter:'4/4',keyChanges:[{beat:4,key:4}],notes:[{start:0,duration:1,midi:63},{start:4,duration:1,midi:64}]});
 assert.equal(keyAt(p,3),3);assert.equal(keyAt(p,4),4);const t=transpose(p,0);
 assert.equal(t.keyChanges[0].key,1);assert.equal(numberPitch(t.notes[1].midi,keyAt(t,4)).digit,'1');assert.match(scoreSVG(p),/转 1=E/);
 assert.throws(()=>validateProject({...p,keyChanges:[{beat:.1,key:4}]}));
});
test('rejects confident wholesale pitch shifts and retains acoustic reference as unreviewed',()=>{
 const out=guardMelody(ref,ref.map(n=>({...n,midi:n.midi-1,confidence:.9})));assert.equal(out.status,'reference-retained');assert.deepEqual(out.notes.map(n=>n.midi),[60,62]);assert.ok(out.notes.every(n=>n.confidence<.5));
});
test('accepts supported timing changes but rejects hallucinated or dropped melody',()=>{
 assert.equal(guardMelody(ref,[{...ref[0],end:.95},{...ref[1],start:1.05}]).status,'consistent');
 assert.equal(guardMelody(ref,[]).status,'reference-retained');
 assert.equal(guardMelody(ref,[...ref,{start:2,end:2.25,midi:90}]).status,'reference-retained');
 assert.equal(guardMelody([],ref).status,'no-reference');
});
test('reference clipping preserves a note that starts before the clip',()=>{
 assert.deepEqual(referenceClip(ref,{from:.5,to:1.5}).map(n=>[n.start,n.end]),[[0,.5],[.5,1]]);
});
