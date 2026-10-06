import test from 'node:test';
import assert from 'node:assert/strict';
import {wavBytes} from '../public/audio.mjs';
import {readReviewWav,replayRecognition} from '../src/replay-recognition.mjs';
test('saved evidence replays in audio seconds and keeps external track provenance',()=>{
  const samples=new Float32Array(22050).fill(.05),audit={evidenceVersion:'old',windows:[{from:0,to:1,clipStart:0,clipEnd:1,source:'original',evidence:{rawBasic:[],pitchFrames:[],onsets:[]}}]};
  const decoded=readReviewWav(wavBytes(samples));assert.equal(decoded.length,samples.length);assert.ok(Math.abs(decoded[0]-.05)<.0001);
  const frames=Array.from({length:50},(_,i)=>({second:i*.01,hz:440,pitch:69,confidence:.95,rms:.05,voiced:true})),result=replayRecognition(audit,samples,{pipeline:'pyin',externalEvidence:{externalEngine:'pyin',externalFrames:frames}});
  assert.equal(result.performance.modelRuns,0);assert.equal(result.replayOnly,true);assert.equal(result.events[0].midi,69);assert.equal(result.windows[0].evidence.rawMono[0].eventId,'pyin-0');
  assert.throws(()=>replayRecognition({...audit,windows:[{...audit.windows[0],source:'vocals'}]},samples),/分轨/);
});
