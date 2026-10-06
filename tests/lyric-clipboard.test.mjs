import test from 'node:test';
import assert from 'node:assert/strict';
import {copyLyrics,pasteLyrics,shiftLyrics} from '../public/lyric-clipboard.mjs';
import {chooseNotes} from '../public/selection.mjs';
import {validateProject,makeDemo,freeScoreSVG} from '../public/music.mjs';
const fixture=()=>validateProject({...makeDemo(),bpm:60,offset:0,notes:[{id:'a',midi:60,start:0,duration:1},{id:'b',midi:62,start:3,duration:1},{id:'c',midi:64,start:10,duration:1}],lyrics:[{id:'x',text:'你',start:0,end:1,noteIds:['a'],source:'manual',reviewed:true},{id:'y',text:'好',start:3,end:4,noteIds:['b'],source:'manual',reviewed:true}]});
test('disjoint lyric selection copies gaps and pastes new identities at audio seconds',()=>{
  const p=fixture(),ids=chooseNotes(p.lyrics,new Set(['x']),'y',{toggle:true}),clip=copyLyrics(p.lyrics,ids);let next=0;
  const r=pasteLyrics(p,p.lyrics,clip,10,{idFactory:()=>`p${next++}`});assert.equal(clip.span,4);assert.deepEqual(r.tokens.slice(2).map(t=>[t.start,t.end,t.noteIds]),[[10,11,['c']],[13,14,[]]]);assert.ok(r.tokens.slice(2).every(t=>!t.evidenceIds));assert.deepEqual(p.lyrics.map(t=>t.start),[0,3]);
  const restored=validateProject(JSON.parse(JSON.stringify({...p,lyrics:r.tokens})));assert.deepEqual(restored.lyrics.map(t=>t.text),['你','好','你','好']);assert.equal(restored.notes[0].start,0);
});
test('lyric overwrite only removes word records, and shift respects audio bounds and independent timing',()=>{
  const p=fixture(),clip=copyLyrics(p.lyrics,new Set(['x']));assert.throws(()=>pasteLyrics(p,p.lyrics,clip,.2),/已有歌词/);
  const r=pasteLyrics(p,p.lyrics,clip,.2,{overwrite:true,idFactory:()=> 'fresh'});assert.deepEqual(r.tokens.map(t=>t.id),['fresh','y']);assert.equal(p.notes.length,3);
  p.timeAnchors=[{beat:0,second:0},{beat:5,second:10},{beat:20,second:25}];const shifted=shiftLyrics(p,p.lyrics,new Set(['x','y']),2);assert.deepEqual(shifted.map(t=>t.start),[2,5]);assert.deepEqual(p.notes.map(t=>t.start),[0,3,10]);assert.throws(()=>shiftLyrics(p,p.lyrics,new Set(['x']),-1),/原音范围/);assert.throws(()=>pasteLyrics(p,p.lyrics,clip,3599.5),/原音时间/);
});
test('unlocated words cannot silently acquire invented time through copy or shift',()=>{
  const p=fixture();p.lyrics[0].start=null;p.lyrics[0].end=null;assert.throws(()=>copyLyrics(p.lyrics,new Set(['x'])),/未定位/);assert.throws(()=>shiftLyrics(p,p.lyrics,new Set(['x']),1),/未定位/);
});
test('lyric caption follows its own audio interval even when a note association is wrong',()=>{
  const p=fixture();p.lyrics=[{id:'word',text:'唱',start:1,end:3,noteIds:['a'],source:'manual',reviewed:true}];const svg=freeScoreSVG(p,{beatsPerRow:8,zoom:100});assert.match(svg,/class="score-lyric" x="242"/);
});
