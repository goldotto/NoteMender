import test from 'node:test';
import assert from 'node:assert/strict';
import midiPackage from '@tonejs/midi';
const {Midi}=midiPackage;
import {makeTimeAnchors,timeAtBeat,beatAtTime} from '../public/time-map.mjs';
import {activitySections} from '../public/segmentation.mjs';
import {replaceSectionCandidate} from '../public/local-candidates.mjs';
import {makeDemo,validateProject,midiFile} from '../public/music.mjs';
import {expandToSong} from '../public/note-input.mjs';

test('legacy score keeps its absolute audio alignment and explicit anchors change local timing',()=>{
  const legacy=validateProject({...makeDemo(),offset:3,bpm:120});
  assert.equal(timeAtBeat(legacy,8),7);
  assert.equal(beatAtTime(legacy,7),8);
  const mapped=validateProject({...legacy,timeAnchors:[{beat:0,second:3},{beat:4,second:5},{beat:8,second:7.5}]});
  assert.equal(timeAtBeat(mapped,6),6.25);
  assert.equal(beatAtTime(mapped,6.25),6);
  assert.throws(()=>validateProject({...legacy,timeAnchors:[{beat:0,second:3},{beat:4,second:2}]}));
  const midi=new Midi(midiFile(mapped));
  assert.equal(midi.header.tempos.length,2);
});

test('section activity includes instrumental beginning and ending with vocal middle',()=>{
  const sr=100,seconds=22,v=new Float32Array(sr*seconds),o=new Float32Array(sr*seconds);
  for(let i=0;i<o.length;i++){o[i]=.03;if(i>=5*sr&&i<17*sr)v[i]=.08;}
  const sections=activitySections(v,o,seconds,sr);
  assert.deepEqual(sections.map(x=>x.kind),['intro','voice','outro']);
  assert.ok(sections[0].to<=7&&sections[2].from>=15);
});

test('brief isolated vocal-stem bleed does not split a long introduction',()=>{
  const sr=100,v=new Float32Array(sr*30),o=new Float32Array(sr*30).fill(.03);
  v.fill(.08,2*sr,7*sr);
  const sections=activitySections(v,o,30,sr);
  assert.equal(sections.length,1);
  assert.equal(sections[0].source,'other');
});

test('section alternate keeps edited notes outside the range and remains unreviewed',()=>{
  const original=validateProject({...makeDemo(),notes:[{id:'a',start:0,duration:5,midi:60,confidence:1,reviewStatus:'reviewed',lyric:'字'},{id:'b',start:5,duration:1,midi:62,confidence:.7,reviewStatus:'pending',lyric:''}]});
  const next=replaceSectionCandidate(original,{start:4,end:6},[{start:4,duration:1,midi:64,confidence:.5},{start:5,duration:1,midi:65,confidence:.5}]);
  assert.equal(next.notes[0].duration,4);
  assert.equal(next.notes[0].reviewStatus,'reviewed');
  assert.deepEqual(next.notes.slice(1).map(n=>n.midi),[64,65]);
  assert.ok(next.notes.slice(1).every(n=>n.reviewStatus==='pending'));
});

test('beat anchors cover the whole song with monotonic time',()=>{
  const anchors=makeTimeAnchors(30,120,[.4,.9,1.4,1.9,2.5,3,3.5,4]);
  assert.equal(anchors[0].second,0);
  assert.equal(anchors.at(-1).second,30);
  assert.ok(anchors.every((a,i)=>!i||(a.beat>anchors[i-1].beat&&a.second>anchors[i-1].second)));
});

test('expanding an anchored old score keeps every note at the same original audio second',()=>{
  const old=validateProject({...makeDemo(),offset:3,bpm:120,timeAnchors:[{beat:0,second:3},{beat:8,second:7.5},{beat:16,second:12}]});
  const expanded=expandToSong(old);
  assert.equal(expanded.timeAnchors[0].beat,0);
  for(const note of old.notes.slice(0,16))assert.equal(timeAtBeat(expanded,note.start+6),timeAtBeat(old,note.start));
});
