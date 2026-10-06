import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateNoteEvents} from '../src/evaluation.mjs';

test('raw-second audit separates missed, wrong, octave and extra notes',()=>{
  const ref=[{start:0,end:.4,midi:60},{start:.5,end:.9,midi:62},{start:1,end:1.4,midi:64},{start:1.5,end:1.9,midi:67}];
  const predicted=[{start:.02,end:.42,midi:60},{start:.52,end:.92,midi:74},{start:1.02,end:1.42,midi:65},{start:2,end:2.2,midi:70}];
  const report=evaluateNoteEvents(ref,predicted);
  assert.deepEqual([report.correctPitch,report.wrongPitch,report.octaveErrors,report.missed,report.extra],[1,2,1,1,1]);
  assert.ok(Math.abs(report.onsetErrorMs-20)<1e-6);
});
test('a sustained detection cannot steal a repeated attack and create a false missed note',()=>{
  const ref=[{start:0,end:1,midi:60},{start:1,end:2,midi:62}];
  const found=[{start:0,end:2,midi:62},{start:0,end:.4,midi:60}];
  const a=evaluateNoteEvents(ref,found),b=evaluateNoteEvents([...ref].reverse(),[...found].reverse());
  assert.equal(a.missed,0);assert.equal(a.extra,0);assert.equal(a.correctPitch,2);assert.deepEqual(a,b);
});
