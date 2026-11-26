import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProject,freeScoreSVG,scoreSVG} from '../public/music.mjs';
import {captureMarker,markerLoopRange,markerPoint} from '../public/project-markers.mjs';
import {markerEntryBeat} from '../public/workspace-markers.mjs';
import {parseProjectText,projectText} from '../public/project-file.mjs';
import {adoptCandidate} from '../public/candidate-adoption.mjs';
import {shortcutAction} from '../public/shortcuts.mjs';

const base={version:1,title:'Marker test',bpm:120,key:0,meter:'4/4',offset:0,
  notes:[{id:'note',start:0,duration:4,midi:60}]};
const audio={id:'audio-mark',anchor:'audio',position:2.125,name:'verse & <line>'};
const score={id:'score-mark',anchor:'score',position:3.25,name:'Pickup'};

test('markers round trip through project files and old projects open without markers',()=>{
  assert.equal(parseProjectText(projectText(base)).markers,undefined);
  const saved=validateProject({...base,markers:[audio,score,{...audio,name:'duplicate'},null,{...score,id:'bad',position:-1}]});
  assert.deepEqual(parseProjectText(projectText(saved)).markers,[audio,score]);
});

test('audio markers follow original seconds and score markers follow beats as timing changes',()=>{
  const before=validateProject({...base,offset:1});
  const after=validateProject({...base,offset:.5,timeAnchors:[{beat:0,second:.5},{beat:4,second:5}]});
  assert.equal(captureMarker(before,'audio',1.125),audio.position);
  assert.equal(captureMarker(before,'score',1.625),score.position);
  assert.equal(markerPoint(after,audio).audioSecond,audio.position);
  assert.equal(markerPoint(after,audio).second,1.625);
  assert.notEqual(markerPoint(after,audio).beat,markerPoint(before,audio).beat);
  assert.equal(markerPoint(after,score).beat,score.position);
  assert.notEqual(markerPoint(after,score).audioSecond,markerPoint(before,score).audioSecond);
  assert.equal(markerEntryBeat(2.09),2.0625);
  assert.equal(markerEntryBeat(-.01),null);
});

test('loop picks two explicit endpoints from several markers and reports invalid bounds',()=>{
  const points=[{id:'a',second:1},{id:'b',second:7},{id:'c',second:4},{id:'duplicate',second:1}];
  const bounds={start:0,end:8};
  assert.deepEqual(markerLoopRange(points,'c','a',bounds),{start:1,end:4});
  assert.deepEqual(markerLoopRange(points,'a','b',bounds),{start:1,end:7});
  assert.deepEqual(markerLoopRange(points,'a','duplicate',bounds),{error:'same'});
  assert.deepEqual(markerLoopRange(points,'a','c',{start:2,end:8}),{error:'outside'});
  assert.deepEqual(markerLoopRange(points,'a','missing',bounds),{error:'missing'});
});

test('adopting a new candidate preserves current markers for the same song',()=>{
  const current=validateProject({...base,markers:[audio]}),draft=validateProject({...base,markers:[score]});
  assert.deepEqual(adoptCandidate(current,draft,[],{mode:'whole'}).project.markers,[audio]);
  assert.equal(adoptCandidate(current,draft,[],{mode:'whole',newSong:true}).project.markers,undefined);
});

test('workspace score pins are escaped, cover rests and stay out of default score exports',()=>{
  const markers=[{id:audio.id,beat:2.125,label:'A·1',description:audio.name}];
  const project=validateProject({...base,notes:[{id:'note',start:3,duration:.25,midi:60}]});
  for(const render of [freeScoreSVG,scoreSVG]){
    const svg=render(project,{manualMarkers:markers});
    assert.match(svg,/data-workspace-marker="audio-mark".*verse &amp; &lt;line&gt;/);
    assert.doesNotMatch(render({...project,markers:[audio]}),/data-workspace-marker/);
  }
  const dense=validateProject({...project,notes:[{id:'note',start:3,duration:.125,midi:60}]});
  assert.match(scoreSVG(dense,{manualMarkers:markers}),/data-marker-beat="2.125"/);
  assert.match(scoreSVG(dense,{manualMarkers:[{...markers[0],beat:4}]}),/data-marker-beat="4"/);
  assert.match(freeScoreSVG(project,{manualMarkers:[{...markers[0],beat:13}]}),/data-marker-beat="13"/);
});

test('B marks the playhead once and ignores text entry and other shortcut modifiers',()=>{
  assert.equal(shortcutAction({key:'b'}),'marker');
  assert.equal(shortcutAction({key:'b',repeat:true}),null);
  assert.equal(shortcutAction({key:'B',ctrlKey:true}),null);
  assert.equal(shortcutAction({key:'b'},{editing:true}),null);
});
