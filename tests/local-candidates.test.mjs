import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject,EDIT_STEP} from '../public/music.mjs';
import {replaceSectionCandidate} from '../public/local-candidates.mjs';
import {sectionBeats} from '../public/sections.mjs';
test('second-based candidate replacement snaps score boundaries and preserves outside manual notes',()=>{
  const section={id:'voice',audioStart:2.131,audioEnd:6.827,source:'vocals'};
  const p=validateProject({...makeDemo(),timeAnchors:[{beat:0,second:0},{beat:8,second:9},{beat:16,second:15}],sections:[section],notes:[{id:'held',start:0,duration:8,midi:60,reviewStatus:'reviewed',lyric:'保留'},{id:'outside',start:10,duration:2,midi:62,reviewStatus:'reviewed'}]});
  const q=replaceSectionCandidate(p,sectionBeats(p,section),[{start:1,duration:6,midi:65}]);
  assert.deepEqual(q.sections,p.sections);assert.deepEqual(q.timeAnchors,p.timeAnchors);
  assert.deepEqual(q.notes.find(n=>n.id==='outside'),p.notes.find(n=>n.id==='outside'));
  assert.equal(q.notes.find(n=>n.midi===65).reviewStatus,'pending');
  assert.equal(q.notes[0].id,'held');assert.equal(q.notes[0].lyric,'保留');
  for(const n of q.notes){assert.equal(n.start/EDIT_STEP,Math.round(n.start/EDIT_STEP));assert.equal(n.duration/EDIT_STEP,Math.round(n.duration/EDIT_STEP));}
});
