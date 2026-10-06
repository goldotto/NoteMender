import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptionTempo} from '../public/tempo-fallback.mjs';

test('missing optional Python tempo analysis still produces explicitly provisional timing', async () => {
  const result = await transcriptionTempo({manual:false,bpm:120,analyze:async()=>{throw Error('Python missing');}});
  assert.equal(result.bpm,120); assert.deepEqual(result.beats,[]); assert.match(result.warning,/120 BPM/);
});
test('manual tempo bypasses the analyzer; successful automatic beats are preserved', async () => {
  assert.deepEqual(await transcriptionTempo({manual:true,bpm:90,analyze:()=>assert.fail()}),{bpm:90,beats:[]});
  const result={bpm:115,beats:[1,2]};
  assert.equal(await transcriptionTempo({manual:false,bpm:120,analyze:async()=>result}),result);
});
test('cancellation never falls back and invalid tempo never starts analysis', async () => {
  await assert.rejects(transcriptionTempo({manual:false,bpm:120,analyze:async()=>{throw new DOMException('cancelled','AbortError');}}),{name:'AbortError'});
  await assert.rejects(transcriptionTempo({manual:true,bpm:0}),/BPM/);
});
