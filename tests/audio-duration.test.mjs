import test from 'node:test';
import assert from 'node:assert/strict';
import {synthNote} from '../public/audio.mjs';

test('very short note finishes its envelope at the requested time',()=>{
  const events=[];
  const gain={setValueAtTime:(v,t)=>events.push(['set',t]),linearRampToValueAtTime:(v,t)=>events.push(['linear',t]),exponentialRampToValueAtTime:(v,t)=>events.push(['exp',t])};
  const node={gain,connect(){},disconnect(){}};
  const osc={frequency:{value:0},connect(){},start(t){events.push(['start',t]);},stop(t){events.push(['stop',t]);},disconnect(){}};
  synthNote({createOscillator:()=>osc,createGain:()=>node},{},60,1,.012);
  assert.deepEqual(events.slice(0,4).map(x=>x[1]),[1,1.003,1.0078,1.012]);
});
