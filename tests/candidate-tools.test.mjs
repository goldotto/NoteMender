import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {draftScoreWindow} from '../public/draft-preview.mjs';
import {activeFragment,conflictText,selectedIssues,preservePrimary,hasTrackContent} from '../public/candidate-tools.mjs';
test('inaudible separation residue is not filled with invented notes, while an isolated quiet instrument remains eligible',()=>{
  assert.equal(hasTrackContent(new Float32Array(100).fill(.000277),.25),false);
  assert.equal(hasTrackContent(new Float32Array(100).fill(.000277),.0004),true);
  assert.equal(hasTrackContent(new Float32Array(100).fill(.002),.25),true);
  assert.equal(hasTrackContent(new Float32Array(100),.25),false);
});
test('preview highlight uses absolute nonlinear time, highlights only the currently sounding row fragment',()=>{
  const p=validateProject({...makeDemo(),timeAnchors:[{beat:0,second:2},{beat:4,second:6},{beat:8,second:8}],notes:[{id:'held',start:2,duration:4,midi:60}]});
  const preview=draftScoreWindow(p,4,7,'test');assert.equal(preview.previewOrigin,2);
  assert.equal(activeFragment(p,5,{id:'held',start:0,duration:2},preview.previewOrigin),true);
  assert.equal(activeFragment(p,6.5,{id:'held',start:0,duration:2},preview.previewOrigin),false);
  assert.equal(activeFragment(p,6.5,{id:'held',start:2,duration:2},preview.previewOrigin),true);
});
test('diagnostics show actual pitch disagreement and are scoped to the selected candidate',()=>{
  assert.match(conflictText({kind:'音高冲突',pitches:[{engine:'Basic Pitch',midi:60},{engine:'Pitchy',midi:72}]}),/C4.*C5.*八度/);
  assert.equal(conflictText({kind:'音高冲突'}),'两个候选音高不一致');
  const windows=[{candidateRole:'primary',source:'vocals',issues:[{second:2,kind:'人声'}]},{candidateRole:'alternate',source:'original',issues:[{second:2,kind:'其他候选'}]}];
  assert.deepEqual(selectedIssues(null,windows,0,4,'vocals').map(x=>x.kind),['人声']);
  assert.deepEqual(selectedIssues({diagnostics:[]},windows,0,4,'vocals'),[]);
});
test('new stems and every primary candidate survive validation without changing the formal melody',()=>{
  const p=validateProject({...makeDemo(),sections:[{id:'intro',kind:'intro',source:'guitar',audioStart:0,audioEnd:4}],audioResources:[{id:'a'.repeat(64),source:'guitar',audioStart:0,audioEnd:4,model:'htdemucs_6s'}]});
  const v={id:'piano',sectionId:'intro',source:'piano',model:'htdemucs_6s',resourceId:'a'.repeat(64),method:'钢琴',notes:[],diagnostics:[{kind:'音高冲突',second:1,pitches:[{engine:'a',midi:60}]}]};
  const copy=validateProject({...p,alternates:preservePrimary(p,p.sections,[v])});
  assert.equal(copy.sections[0].source,'guitar');assert.equal(copy.alternates[0].source,'piano');assert.equal(copy.audioResources.length,1);assert.equal(copy.alternates.filter(v=>v.primary).length,1);assert.deepEqual(copy.notes,p.notes);assert.equal(copy.alternates[0].diagnostics[0].pitches[0].midi,60);
});
