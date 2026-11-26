import test from 'node:test';
import assert from 'node:assert/strict';
import {freeScoreSVG,makeDemo,validateProject} from '../public/music.mjs';
import {draftScoreWindow,draftNotePosition,candidateNotationKey,draftPage,draftPageAt} from '../public/draft-preview.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('candidate notation key changes all notation without changing sound, variants, lyrics or timing',()=>{
  const p=validateProject({...makeDemo(),key:8,keyChanges:[{beat:2,key:5}]}),before=structuredClone(p);
  const c=candidateNotationKey(p,0);
  assert.equal(c.key,0);assert.deepEqual(c.keyChanges,[]);assert.deepEqual(p,before);
  for(const field of ['notes','lyrics','alternates','timeAnchors','audioResources'])assert.equal(c[field],p[field]);
  assert.equal(draftScoreWindow(c,1,5,'').key,0);
  for(const key of [-1,12,NaN,1.5])assert.throws(()=>candidateNotationKey(p,key));
});

test('real candidate key handler updates baseline and current choice and persists without editing workspace',async()=>{
  const code=await readFile(new URL('../public/app.mjs',import.meta.url),'utf8'),begin=code.indexOf("on('draftKey','change',"),end=code.indexOf("on('draftBeatsInput'",begin);
  const p=validateProject({...makeDemo(),key:8}),workspace=makeDemo();let handler;
  const state={localDraft:p,localDraftBase:p,project:workspace,job:null,lyricsTask:null,candidateNotationKey,KEYS:['C'],
    on:(_id,_event,fn)=>handler=fn,renderDraftScores(){state.rendered=true;},savePendingDraft(){state.saved=state.localDraft;},toast(){}};
  vm.runInContext(code.slice(begin,end),vm.createContext(state));handler({target:{value:'0'}});
  assert.equal(state.localDraft.key,0);assert.equal(state.localDraftBase.key,0);assert.equal(state.saved,state.localDraft);
  assert.equal(state.project,workspace);assert.equal(state.localDraft.notes,p.notes);
  state.job={};assert.throws(()=>handler({target:{value:'2'}}),/等待/);assert.equal(state.localDraft.key,0);
});

test('free score exposes effective row key and within-row modulation with reserved vertical space',()=>{
  const p=validateProject({...makeDemo(),key:8,keyChanges:[{beat:0,key:0},{beat:2,key:2},{beat:4,key:5}]}),svg=freeScoreSVG(p,{beatsPerRow:4,compactHeader:true});
  assert.match(svg,/1 = C/);assert.match(svg,/timeline-key-change[^>]*>转 1=D/);
  assert.match(svg,/timeline-key[^>]*>1=F/);assert.match(svg,/data-row-height="86"/);
  assert.deepEqual(p.keyChanges.map(c=>c.key),[0,2,5]);
});
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

test('read-only candidate score keeps selectable notes but removes note and word stretch handles',()=>{
 const project=validateProject({...makeDemo(),notes:[{id:'a',start:0,duration:2,midi:60}],lyrics:[{id:'w',text:'唱',start:0,end:1,noteIds:['a'],reviewed:true}]});
 const view=draftScoreWindow(project,0,3,'试听'),svg=freeScoreSVG(view,{editable:false,selected:'a'});
 assert.match(svg,/timeline-note selected/);assert.match(svg,/cursor:pointer/);
 assert.doesNotMatch(svg,/data-resize|data-lyric-resize|ew-resize|拖左右边缘|点“\+”插入/);
 assert.match(svg,/点击音符选择试听起点/);
 assert.match(freeScoreSVG(view),/data-resize="start"/);assert.match(freeScoreSVG(view),/data-lyric-resize/);
});

test('candidate note click resolves full IDs to original seconds under nonlinear mapping and clips crossings',()=>{
 const project=validateProject({...makeDemo(),timeAnchors:[{beat:0,second:0},{beat:8,second:4},{beat:16,second:12},{beat:32,second:36}],notes:[{id:'cross',start:8,duration:4,midi:60},{id:'next',start:16,duration:2,midi:65}]});
 const range={from:6,to:20};
 assert.equal(draftNotePosition(project,'cross',range),6);
 assert.equal(draftNotePosition(project,'next',range),12);
 assert.equal(draftNotePosition(project,'missing',range),null);
 assert.equal(draftNotePosition(project,'cross',{from:8,to:20}),null);
 assert.equal(draftNotePosition(project,'next',{from:0,to:12}),null);
});


test('candidate sections page in original seconds, including a short final page and exact boundaries',()=>{
  assert.deepEqual(draftPage({from:30,to:33}),{index:0,count:1,from:30,to:33});
  const range={from:32.25,to:93.5};
  assert.deepEqual(draftPage(range,3),{index:3,count:4,from:92.25,to:93.5});
  assert.equal(draftPageAt(range,52.25),1);
  assert.equal(draftPageAt(range,93.5),3);
  assert.equal(draftPageAt(range,25),0);
  assert.equal(draftPage({from:1.125,to:41.125},9).count,2);
});

test('a held note keeps its source identity on both pages and seeks to the displayed continuation',()=>{
  const p=validateProject({...makeDemo(),offset:0,bpm:60,timeAnchors:[],notes:[
    {id:'before',start:19,duration:1,midi:50},
    {id:'held',start:20,duration:2,midi:60},
    {id:'after',start:22,duration:1,midi:65}
  ]});
  const range={from:.25,to:42},a=draftPage(range),b=draftPage(range,1);
  assert.deepEqual(draftScoreWindow(p,a.from,a.to,'').notes.map(n=>[n.id,n.hasEnd]),[['before',true],['held',false]]);
  assert.deepEqual(draftScoreWindow(p,b.from,b.to,'').notes.map(n=>[n.id,n.hasStart]),[['held',false],['after',true]]);
  assert.equal(draftNotePosition(p,'held',b),20.25);
  assert.equal(draftNotePosition(p,'before',b),null);
  assert.deepEqual(p.notes.map(n=>n.id),['before','held','after']);
});
