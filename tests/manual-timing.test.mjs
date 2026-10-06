import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {durationReviewNotes,mergeSelectedNotes} from '../public/manual-timing.mjs';
import {splitNoteAt} from '../public/note-clipboard.mjs';

const sample=()=>validateProject({...makeDemo(),bpm:60,offset:0,timeAnchors:[],notes:[
  {id:'a',start:0,duration:.0625,midi:60,lyric:'甲'},
  {id:'b',start:.0625,duration:.125,midi:60,lyric:'乙'},
  {id:'c',start:.25,duration:.125,midi:60,lyric:'丙'},
  {id:'d',start:1,duration:2,midi:62,lyric:'丁'}
]});
test('duration review uses the non-linear original-audio mapping and skips rests',()=>{
  const p={...sample(),timeAnchors:[{beat:0,second:0},{beat:1,second:2},{beat:3,second:3}],notes:[...sample().notes,{id:'rest',start:4,duration:2,midi:null}]};
  assert.deepEqual(durationReviewNotes(p,{shortSeconds:.2,longSeconds:.9}).map(n=>[n.id,n.type]),[['a','short'],['d','long']]);
  assert.equal(durationReviewNotes(p,{shortSeconds:.2,longSeconds:.9,kind:'long'})[0].seconds,1);
  assert.throws(()=>durationReviewNotes(p,{shortSeconds:1,longSeconds:.1}),/长音/);
});
test('batch merge preserves surrounding notes, alternatives and mapping; undo snapshot stays intact',()=>{
  const p=sample(),before=structuredClone(p),result=mergeSelectedNotes(p,['b','a']);
  assert.deepEqual(result.project.notes[0],{...p.notes[0],duration:.1875,lyric:'甲乙',confidence:1,reviewStatus:'reviewed',reviewFlags:[]});
  assert.deepEqual(result.project.notes.slice(1),p.notes.slice(2));
  assert.deepEqual(result.project.alternates,p.alternates);assert.deepEqual(result.project.timeAnchors,p.timeAnchors);
  assert.deepEqual(p,before);assert.equal(result.id,'a');
});
test('gaps need explicit user choice; different pitches and skipped notes cannot be merged',()=>{
  const p=sample();assert.throws(()=>mergeSelectedNotes(p,['a','b','c']),/空拍/);
  const result=mergeSelectedNotes(p,['a','b','c'],{fillGaps:true});assert.equal(result.project.notes[0].duration,.375);assert.equal(result.gapCount,1);
  assert.throws(()=>mergeSelectedNotes(p,['a','c'],{fillGaps:true}),/未选中/);
  assert.throws(()=>mergeSelectedNotes(p,['c','d'],{fillGaps:true}),/音高/);
  assert.throws(()=>mergeSelectedNotes(p,['a','missing']),/两个/);
});
test('manual splitting a long note changes its chosen boundary only and can merge back',()=>{
  const p=sample(),result=splitNoteAt(p,'d',1.75);
  assert.deepEqual(result.project.notes.slice(0,3),p.notes.slice(0,3));
  assert.deepEqual(result.project.notes.slice(-2).map(n=>[n.start,n.duration]),[[1,.75],[1.75,1.25]]);
  const merged=mergeSelectedNotes(result.project,['d',result.id]);assert.equal(merged.project.notes.at(-1).duration,2);
});
