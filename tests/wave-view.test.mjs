import test from 'node:test';
import assert from 'node:assert/strict';
import {followedWaveStart} from '../public/wave-view.mjs';

test('zoomed waveform changes page at the edge and places the cursor near the other edge',()=>{
  assert.equal(followedWaveStart(135,10,140,250),135);
  assert.equal(followedWaveStart(135,10,144.3,250),135);
  const next=followedWaveStart(135,10,144.5,250);
  assert.equal(next,143.5);
  assert.equal((144.5-next)/10,.1);
  for(const second of [144.55,145,150,152])assert.equal(followedWaveStart(next,10,second,250),next);
  const back=followedWaveStart(135,10,135.4,250);
  assert.ok(Math.abs(back-126.4)<1e-9);
  assert.ok(Math.abs((135.4-back)/10-.9)<1e-9);
  assert.equal(followedWaveStart(back,10,135.4,250),back);
  assert.equal(followedWaveStart(238,10,250,250),240);
});
