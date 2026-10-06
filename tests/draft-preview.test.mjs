import test from 'node:test';
import assert from 'node:assert/strict';
import {freeScoreSVG,makeDemo,validateProject} from '../public/music.mjs';
import {draftScoreWindow} from '../public/draft-preview.mjs';
import {timelineLyrics,lyricRows} from '../public/lyric-score.mjs';
import {timeAtBeat,beatAtTime} from '../public/time-map.mjs';
import {replaceSectionCandidate} from '../public/local-candidates.mjs';

test('candidate preview uses the same graphical score and includes every note in a dense slice',()=>{
  const notes=Array.from({length:80},(_,i)=>({id:`dense-${i}`,start:i*.125,duration:.125,midi:60+i%7}));
  const project=validateProject({...makeDemo(),bpm:120,notes});
  const window=draftScoreWindow(project,0,5,'候选谱');
  assert.equal(window.notes.length,80);
  const svg=freeScoreSVG(window,{zoom:80,beatsPerRow:4});
  assert.match(svg,/class="graphical-score"/);
  assert.equal([...svg.matchAll(/data-note="dense-/g)].length,80);
  assert.match(svg,/data-row-height="68"/);
  assert.doesNotMatch(svg,/第 1 小节/);
});

test('preview clips crossing notes and keeps local key changes',()=>{
  const project=validateProject({...makeDemo(),bpm:120,keyChanges:[{beat:1,key:2}],notes:[
    {id:'left',start:0,duration:1,midi:60},
    {id:'right',start:1,duration:1,midi:62}
  ]});
  const window=draftScoreWindow(project,.25,.75,'片段');
  assert.deepEqual(window.notes.map(note=>[note.start,note.duration]),[[0,.5],[.5,.5]]);
  assert.equal(window.key,0);
  assert.deepEqual(window.keyChanges,[{beat:.5,key:2}]);
  assert.equal(window.notes[0].hasStart,false);
  assert.equal(window.notes[1].hasEnd,false);
});

test('late candidate slices clip lyrics and rebase nonlinear audio timing together with notes',()=>{
  const project=validateProject({...makeDemo(),bpm:60,timeAnchors:[{beat:0,second:0},{beat:8,second:4},{beat:16,second:12},{beat:32,second:36}],notes:[
    {id:'early',start:0,duration:1,midi:60},{id:'here',start:10,duration:2,midi:64},{id:'late',start:28,duration:1,midi:67}
  ],lyrics:[
    {id:'first',text:'前段',start:0,end:.5,noteIds:['early'],reviewed:true},
    {id:'cross',text:'跨界',start:5.5,end:6.5,noteIds:[],reviewed:true},
    {id:'here-word',text:'本段',start:6,end:8,noteIds:['here'],reviewed:true},
    {id:'last',text:'后段',start:30,end:31,noteIds:['late'],reviewed:true},
    {id:'unplaced',text:'未定位',start:null,end:null,noteIds:[],reviewed:true}
  ]});
  const before=structuredClone(project),view=draftScoreWindow(project,6,15,'后半段');
  assert.equal(view.previewOrigin,10);
  assert.deepEqual(view.notes.map(n=>[n.id,n.start,n.duration]),[['here',0,2]]);
  assert.deepEqual(view.lyrics.map(t=>[t.id,t.start,t.end]),[['cross',6,6.5],['here-word',6,8]]);
  assert.equal(view.lyrics[0].hasStart,false);
  for(const beat of [0,1,6,7,8])assert.equal(timeAtBeat(view,beat),timeAtBeat(project,beat+10));
  assert.equal(beatAtTime(view,8),2);
  assert.deepEqual(timelineLyrics(view).map(t=>[t.beatStart,t.beatEnd]),[[0,.5],[0,2]]);
  assert.deepEqual(lyricRows(view,[0,4,8,12]).map(r=>r.segments.length),[2,0,0]);
  const svg=freeScoreSVG(view,{beatsPerRow:4});
  assert.match(svg,/data-row-starts="0,4,8"/);
  assert.doesNotMatch(svg,/前段|后段|未定位/);
  assert.match(svg,/↳ 跨界/);
  assert.deepEqual(project,before);
  const alternate=replaceSectionCandidate(project,{start:10,end:18},[{start:10,duration:2,midi:65}]);
  const alternativeView=draftScoreWindow(alternate,6,15,'换方案');
  assert.deepEqual(timelineLyrics(alternativeView).map(t=>[t.text,t.beatStart,t.beatEnd]),timelineLyrics(view).map(t=>[t.text,t.beatStart,t.beatEnd]));
});

test('legacy lyrics appear once below their sliced notes; other song sections do not extend the preview',()=>{
  const project=validateProject({...makeDemo(),bpm:60,offset:3,notes:[
    {id:'old-before',start:0,duration:1,midi:60,lyric:'前'},
    {id:'old-here',start:12,duration:1,midi:62,lyric:'字'},
    {id:'old-after',start:80,duration:1,midi:64,lyric:'后'}
  ]});
  const view=draftScoreWindow(project,15,19,'旧工程片段');
  assert.equal(view.previewOrigin,12);
  assert.deepEqual(timelineLyrics(view).map(t=>[t.text,t.beatStart,t.beatEnd]),[['字',0,1]]);
  const svg=freeScoreSVG(view,{beatsPerRow:4});
  assert.match(svg,/data-row-starts="0,4"/);
  assert.equal([...svg.matchAll(/class="score-lyric-bar/g)].length,1);
  assert.doesNotMatch(svg,/歌词：前|歌词：后/);
  assert.equal(project.notes[1].lyric,'字');
  const silent=draftScoreWindow(project,20,28,'器乐空段');
  assert.equal(silent.lyrics.length,0);
  assert.equal(silent.notes.length,0);
  assert.match(freeScoreSVG(silent,{beatsPerRow:4}),/data-row-starts="0,4,8"/);
});
