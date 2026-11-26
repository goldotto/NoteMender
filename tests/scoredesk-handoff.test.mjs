import test from 'node:test';
import assert from 'node:assert/strict';
import {strFromU8,unzipSync} from 'fflate';
import {scoreDeskAnchors,scoreDeskFile} from '../public/scoredesk-handoff.mjs';
import {validateProject} from '../public/music.mjs';

test('ScoreDesk handoff maps variable tempo onto the actual pickup and skips negative or out-of-audio anchors',()=>{
  const bars=[{start:0,duration:1},{start:1,duration:4},{start:5,duration:4}];
  const project={timeAnchors:[{beat:0,second:-.5},{beat:1,second:.5},{beat:5,second:2.5},{beat:9,second:4.5}]};
  assert.deepEqual(scoreDeskAnchors(project,bars,3),[
    {bar:0,beat:.5,seconds:0},{bar:1,beat:0,seconds:.5},{bar:2,beat:0,seconds:2.5},{bar:2,beat:1,seconds:3},
  ]);
  assert.deepEqual(scoreDeskAnchors({...project,timeAnchors:[],offset:8,bpm:120},bars,1),[]);
  assert.deepEqual(scoreDeskAnchors(project,bars,6).at(-1),{bar:3,beat:0,seconds:4.5});
});

test('ScoreDesk handoff exports the whole adopted score without altering notes, alignment or lyrics',async()=>{
  const project=validateProject({version:1,title:'A & かな',bpm:120,key:0,meter:'4/4',engraving:{pickup:1,tidy:true,step:.5},
    notes:[{id:'one',start:0,duration:.125,midi:60,lyric:'春'},{id:'two',start:4,duration:2,midi:61,lyric:'かな'}],
    timeAnchors:[{beat:0,second:.25},{beat:6,second:3.6}]});
  const before=structuredClone(project);
  const file=await scoreDeskFile(project);
  const archive=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{assert.equal(entry.compression,0);return true;}});
  const m=JSON.parse(strFromU8(archive['manifest.json']));
  assert.equal(file.name,'A & かな.scoredesk');
  assert.equal(m.kind,'ScoreDesk');
  assert.equal(m.format,'musicxml');
  assert.equal(m.audio,null);
  assert.deepEqual(m.anchors,[]);
  assert.equal(archive.original,undefined);
  const xml=strFromU8(archive['score.txt']);
  assert.match(xml,/<measure number="0" implicit="yes">/);
  assert.match(xml,/<duration>6<\/duration>/);
  assert.match(xml,/<tie type="start"\/>/);
  assert.match(xml,/<text>かな<\/text>/);
  assert.deepEqual(project,before);
});

