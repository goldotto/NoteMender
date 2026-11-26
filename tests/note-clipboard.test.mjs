import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {copyNotes,pasteNotes,splitNoteAt} from '../public/note-clipboard.mjs';
import {captureFragment,fragmentSpan,fragmentThumbnail,pasteFragmentPitches} from '../public/fragment-clipboard.mjs';
import {pasteScoreSelection} from '../public/score-edit.mjs';

const sample=()=>validateProject({...makeDemo(),notes:[
  {id:'a',start:0,duration:.5,midi:60,lyric:'甲'},
  {id:'b',start:1,duration:.25,midi:62,lyric:'乙'},
  {id:'c',start:3,duration:1,midi:64,lyric:'丙'}
]});

test('copy and paste retain relative timing, pitch and lyrics with new IDs',()=>{
  const project=sample(),clip=copyNotes(project,['a','b']);
  assert.equal(clip.span,1.25);
  const result=pasteNotes(project,clip,4);
  assert.deepEqual(result.project.notes.slice(-2).map(({start,duration,midi,lyric})=>({start,duration,midi,lyric})),[
    {start:4,duration:.5,midi:60,lyric:'甲'},
    {start:5,duration:.25,midi:62,lyric:'乙'}
  ]);
  assert.equal(new Set(result.project.notes.map(note=>note.id)).size,result.project.notes.length);
  assert.ok(result.project.notes.slice(-2).every(note=>note.reviewStatus==='reviewed'));
  assert.equal(project.notes.length,3);
});

test('paste rejects overlap unless chosen, and overwrite keeps outside fragments',()=>{
  const project=sample(),clip=copyNotes(project,['a','b']);
  assert.throws(()=>pasteNotes(project,clip,3),/已有音符/);
  const result=pasteNotes(project,clip,3.25,{overwrite:true}).project;
  assert.deepEqual(result.notes.map(note=>[note.start,note.duration,note.midi]),[
    [0,.5,60],[1,.25,62],[3,.25,64],[3.25,.5,60],[4.25,.25,62]
  ]);
  assert.throws(()=>pasteNotes(project,clip,14399),/超出/);
});

test('cut at a chosen grid point creates two adjacent notes and rejects tiny halves',()=>{
  const project=sample(),result=splitNoteAt(project,'a',.1875);
  assert.deepEqual(result.project.notes.slice(0,2).map(note=>[note.start,note.duration,note.lyric]),[[0,.1875,'甲'],[.1875,.3125,'']]);
  assert.notEqual(result.id,'a');
  assert.throws(()=>splitNoteAt(project,'a',0),/至少/);
  assert.throws(()=>splitNoteAt(project,'a',.03125),/至少/);
});

test('clip pitches preserve IDs, rhythm, rests, lyrics and markings',()=>{
  const source=validateProject({...sample(),notes:[
    {id:'a',start:0,duration:.5,midi:60},
    {id:'r',start:.5,duration:.25,midi:null},
    {id:'b',start:1,duration:.25,midi:67}
  ]});
  const fragment=captureFragment(source,new Set(['b','a','r']),new Set());
  const target=validateProject({...makeDemo(),key:8,vocalSlurs:[{start:'c',end:'d'}],notes:[
    {id:'c',start:0,duration:.75,midi:74,vocal:{breath:true,dynamic:'p'},lyric:'一',reviewFlags:['manual']},
    {id:'rest',start:1,duration:.25,midi:null},
    {id:'d',start:1.5,duration:.5,midi:75},
    {id:'other',start:3,duration:1,midi:78}
  ],lyrics:[{id:'word',start:0,end:.4,text:'一',noteIds:['c']}]});
  const result=validateProject(pasteFragmentPitches(target,new Set(['d','rest','c']),fragment));
  assert.deepEqual(result,{...target,notes:[{...target.notes[0],midi:60},target.notes[1],{...target.notes[2],midi:67},target.notes[3]]});
  assert.deepEqual(target.notes.map(n=>n.midi),[74,null,75,78]);
  assert.throws(()=>pasteFragmentPitches(target,new Set(['c','rest']),fragment),/片段 2 音.*选中 1 音/);
  assert.equal(pasteFragmentPitches(result,new Set(['c','d']),fragment),result);
});

test('note-only clips can be reused at another beat without importing lyrics',()=>{
  const project=sample(),fragment=captureFragment(project,new Set(['a','b']),new Set());
  const target=validateProject({...project,notes:[]});
  const [first,second]=pasteNotes(target,fragment,8).project.notes;
  assert.deepEqual([first.start,first.duration,second.start,second.duration],[8,.5,9,.25]);
  assert.equal(first.lyric,'');
  assert.equal(fragmentSpan(fragment),1.25);
  const one=captureFragment(project,new Set(['a']),new Set());
  assert.equal(pasteFragmentPitches(project,new Set(['b']),one).notes[1].midi,60);
});

test('clip thumbnail distinguishes rests and gaps and uses the source key at each note',()=>{
  const data={notes:[
    {start:.25,duration:.5,midi:72,reviewStatus:'reviewed'},
    {start:.75,duration:.25,midi:null},
    {start:1.5,duration:.25,midi:64},
    {start:1.75,duration:.0625,midi:66}
  ]};
  const svg=fragmentThumbnail({data,span:2,notation:{keys:[0,0,3,3],flats:true}});
  assert.match(svg,/class="fragment-reviewed" x="25"[^>]*width="39"/);
  assert.match(svg,/class="fragment-rest"[^>]*\/><text[^>]+>0<\/text>/);
  assert.match(svg,/>♭2<\/text>/);
  assert.match(svg,/<circle[^>]+cy="13"/);
  assert.match(svg,/<path d="M147.5 17v9"/);
  assert.deepEqual([...svg.matchAll(/class="fragment-gap" x="([^"]+)"/g)].map(m=>Number(m[1])),[5,85,150]);
  assert.equal(fragmentThumbnail({data:{notes:[]},span:0}),'');
});

test('mixed clips keep off-grid lyrics and rebuild links on the target tempo map',()=>{
  const source=validateProject({...sample(),bpm:120,notes:sample().notes.slice(1),lyrics:[
    {id:'word',start:.456,end:.665,text:'春',noteIds:['b']}
  ]});
  const fragment=captureFragment(source,new Set(['b','c']),new Set(['word']));
  assert.notEqual(fragment.lyrics[0].noteIds,source.lyrics[0].noteIds);
  const target=validateProject({...makeDemo(),bpm:60,notes:[]});
  const result=pasteScoreSelection(target,fragment,4);
  assert.deepEqual(result.project.notes.map(n=>n.start),[4.125,6.125]);
  const lyric=result.project.lyrics[0];
  assert.ok(Math.abs(lyric.start-4.037)<1e-9);
  assert.ok(Math.abs(lyric.end-4.455)<1e-9);
  assert.deepEqual(lyric.noteIds,[result.noteIds[0]]);
  assert.notEqual(lyric.id,'word');
  assert.equal(fragmentSpan(fragment),3.125);
});

