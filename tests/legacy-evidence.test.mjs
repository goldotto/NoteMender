import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyResult} from '../src/legacy-evidence.mjs';
import {selectMelody} from '../src/transcription.mjs';
import {chooseAnalysisMode,fuseVocalCandidates,traceDenseMelody,chooseDenseCandidate} from '../public/adaptive-strategy.mjs';
import {acousticReference} from '../public/grounding.mjs';
test('evidence wrapping preserves legacy selection for vocal, solo, dense and manually chosen engines',()=>{
  const samples=new Float32Array(22050).fill(.05),basic=[{start:0,end:.4,midi:60,confidence:.9},{start:0,end:.4,midi:72,confidence:.2},{start:.42,end:.85,midi:62,confidence:.9}],mono=[{start:0,end:.4,midi:60,confidence:.95},{start:.42,end:.85,midi:62,confidence:.95}],raw={rawBasic:basic,rawMono:mono,pitchFrames:[]};
  for(const requested of ['auto','vocal','solo','dense']){
    const options={source:'vocals',analysisMode:requested,strategy:'smooth'},mode=chooseAnalysisMode({requested,source:options.source,basic,mono,windowSeconds:1}),greedy=selectMelody(basic,options),traced=mode==='dense'?traceDenseMelody(basic,options):greedy,dense=mode==='dense'?chooseDenseCandidate(traced,greedy,1).notes:traced;
    const expected=mode==='vocal'?fuseVocalCandidates(greedy,mono,samples):mode==='solo'?mono.map(n=>({...n,confidence:Math.min(.75,n.confidence)})):dense;
    assert.deepEqual(legacyResult(raw,samples,'adaptive',options).notes,expected);
  }
  assert.deepEqual(legacyResult(raw,samples,'pitchy').notes,mono);
  assert.deepEqual(legacyResult(raw,samples,'basic').notes,acousticReference(selectMelody(basic),mono,samples));
});
