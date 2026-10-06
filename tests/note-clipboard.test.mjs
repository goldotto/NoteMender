import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {copyNotes,pasteNotes,splitNoteAt} from '../public/note-clipboard.mjs';

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
