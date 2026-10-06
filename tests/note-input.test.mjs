import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBar,parseFreeNotes,formatBar,replaceRange,expandToSong} from '../public/note-input.mjs';
import {makeDemo,validateProject} from '../public/music.mjs';
import {beatAtTime} from '../public/time-map.mjs';

test('direct numbered-note entry supports accidentals, octaves, rests and exact bar duration',()=>{
  const notes=parseBar("1:1 #4:0.5 1':0.5 1,:1 0:1",{key:3,beats:4});
  assert.deepEqual(notes.map(n=>[n.start,n.duration,n.midi]),[[0,1,63],[1,.5,69],[1.5,.5,75],[2,1,51],[3,1,null]]);
  assert.throws(()=>parseBar('1:1 2:1',{beats:4}),/恰好 4 拍/);
  assert.throws(()=>parseBar('1:5',{beats:4}),/超过/);
});

test('free writing accepts fast notes and never requires a full measure',()=>{
 const {notes,beats}=parseFreeNotes("1:0.0625 2:0.125 0:0.1875 #4:0.25");
 assert.equal(beats,.625);
 assert.deepEqual(notes.map(n=>[n.start,n.duration,n.midi]),[[0,.0625,60],[.0625,.125,62],[.1875,.1875,null],[.375,.25,66]]);
 const p=validateProject({...makeDemo(),notes:[{id:'before',start:0,duration:1,midi:60},{id:'later',start:2,duration:1,midi:64}]});
 const changed=replaceRange(p,1,1+beats,notes);
 assert.equal(changed.notes.at(-1).start,2);
 assert.equal(formatBar(changed,0,4).includes('1:0.0625'),true);
});

test('bar replacement clips sustained notes and preserves music outside the bar',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'long',start:3.5,duration:2,midi:60,confidence:.4,lyric:'唱'},{id:'later',start:7,duration:1,midi:64,confidence:.4,lyric:''}]});
  assert.equal(formatBar(p,4,8).startsWith('1:1.5'),true);
  const changed=replaceRange(p,4,8,parseBar('0:4',{beats:4}));
  assert.deepEqual(changed.notes.map(n=>[n.start,n.duration,n.midi]),[[3.5,.5,60]]);
});

test('unchanged note positions keep lyrics during direct bar edits',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'one',start:0,duration:1,midi:60,confidence:.5,lyric:'咸'}]});
  const changed=replaceRange(p,0,4,parseBar('1:1 0:3',{beats:4}));
  assert.equal(changed.notes[0].lyric,'咸');
});

test('expanding to the full-song timeline retains precise audio alignment and section metadata',()=>{
  const p=validateProject({...makeDemo(),offset:28.226157941437442,bpm:92,sections:[{id:'section',name:'主歌',kind:'verse',start:0,end:8}]});
  const expanded=expandToSong(p),shift=expanded.notes[0].start-p.notes[0].start;
  assert.ok(Math.abs((expanded.notes[0].start*60/92+expanded.offset)-(p.notes[0].start*60/92+p.offset))<1e-8);
  assert.equal(expanded.sections[0].audioStart,p.sections[0].audioStart);
  assert.equal(expanded.sections[0].audioEnd,p.sections[0].audioEnd);
  assert.ok(Math.abs(beatAtTime(expanded,expanded.sections[0].audioStart)-shift)<.001);
});
