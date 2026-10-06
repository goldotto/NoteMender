import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateF0,evaluateF0Frames,scoreReviewedSample,acceptance} from '../src/quality-report.mjs';
test('continuous pitch scoring distinguishes missed frames, octave errors and false voiced silence',()=>{
  const report=evaluateF0([[0,261.6256],[.1,261.6256],[.2,261.6256],[.3,0]],[{start:0,end:.08,midi:60},{start:.1,end:.15,midi:72},{start:.3,end:.35,midi:60}]);
  assert.equal(report.voicedFrames,3);assert.equal(report.correctFrames,1);assert.equal(report.octaveFrames,1);assert.equal(report.falseVoicedFrames,1);
});
test('continuous-frame evaluation uses frequency evidence and excludes uncertain intervals',()=>{
  const frames=[{second:0,hz:270,voiced:true},{second:.1,hz:540,voiced:true},{second:.2,hz:270,voiced:true}];
  const result=evaluateF0Frames([[0,270],[.1,270],[.2,270],[.4,270]],frames,{uncertain:[{start:.2,end:.3}]});
  assert.equal(result.correctFrames,1);assert.equal(result.octaveFrames,1);assert.equal(result.detectedFrames,2);assert.equal(result.excludedFrames,1);assert.equal(result.voicedFrames,3);
});
test('missing baseline and unchanged target omissions cannot satisfy the acceptance gate',()=>{
  const metrics={missed:1,wrongPitch:0,octaveErrors:0,extra:0,onsetErrorMs:5,offsetErrorMs:10};
  const candidate={sampleId:'s',group:'local-2',profile:'corrected',ablation:'none',notes:{metrics}};
  assert.equal(acceptance([candidate]).status,'pending');
  const baseline={...candidate,profile:'legacy'};
  assert.equal(acceptance([baseline,candidate]).status,'fail');
  assert.equal(acceptance([baseline,{...candidate,notes:{metrics:{...metrics,missed:0}}}]).status,'objective-pass');
  assert.equal(acceptance([baseline,{...candidate,notes:{metrics:{...metrics,missed:0,offsetErrorMs:30}}}]).status,'fail');
});
test('pending annotation cannot pass, uncertain intervals are excluded and per-sample regression fails',()=>{
  assert.equal(scoreReviewedSample({status:'pending',notes:[]},[]).metrics,null);
  const events=[{start:0,end:.5,midi:60},{start:1,end:1.5,midi:72}],scored=scoreReviewedSample({status:'confirmed',notes:events,uncertain:[{start:1,end:2}]},events);
  assert.equal(scored.metrics.referenceNotes,1);assert.equal(scored.excludedCandidate,1);
  const a={missed:1,wrongPitch:0,octaveErrors:0,extra:0},b={...a,missed:0,wrongPitch:1};
  const rows=[{sampleId:'s',group:'voice',profile:'legacy',ablation:'none',notes:{metrics:a}},{sampleId:'s',group:'voice',profile:'corrected',ablation:'none',notes:{metrics:b}}];
  assert.equal(acceptance(rows).status,'fail');rows[1].notes.metrics=null;assert.equal(acceptance(rows).status,'pending');
});
