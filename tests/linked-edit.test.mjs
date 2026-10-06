import test from 'node:test';import assert from 'node:assert/strict';
import {validateProject} from '../public/music.mjs';import {associatedGroup,retimeAssociated,moveAssociatedLyrics} from '../public/linked-edit.mjs';
import {timeAtBeat} from '../public/time-map.mjs';
const fixture=()=>validateProject({version:1,bpm:60,key:0,title:'联动',notes:[{id:'a',start:1,duration:1,midi:60},{id:'b',start:2,duration:1,midi:62},{id:'c',start:10,duration:1,midi:65}],lyrics:[{id:'hold',text:'啊',start:1,end:3,noteIds:['a','b'],reviewed:true},{id:'extra',text:'呀',start:2,end:2.5,noteIds:['b'],reviewed:true},{id:'other',text:'外',start:10,end:11,noteIds:['c']}]});
test('linked components support many-to-many and moving from either side preserves associations',()=>{
 const p=fixture(),original=structuredClone(p),g=associatedGroup(p,{noteIds:['a']});assert.equal(g.noteIds.size,2);assert.equal(g.lyricIds.size,2);
 const r=retimeAssociated(p,{kind:'note',id:'a',start:2,end:3});assert.deepEqual(r.project.notes.map(n=>n.start),[2,3,10]);assert.deepEqual(r.project.lyrics.map(t=>[t.start,t.end]),[[2,4],[3,3.5],[10,11]]);assert.deepEqual(r.project.lyrics.map(t=>t.noteIds),p.lyrics.map(t=>t.noteIds));assert.deepEqual(p,original);
 const back=retimeAssociated(r.project,{kind:'lyric',id:'hold',start:1,end:3});assert.deepEqual(back.project.notes.map(n=>[n.start,n.duration]),p.notes.map(n=>[n.start,n.duration]));
});
test('stretching a word scales every associated note and connected word; outside data remains unchanged',()=>{
 const p=fixture(),r=retimeAssociated(p,{kind:'lyric',id:'hold',start:1,end:5});assert.deepEqual(r.project.notes.slice(0,2).map(n=>[n.start,n.duration]),[[1,2],[3,2]]);assert.deepEqual([r.project.lyrics[1].start,r.project.lyrics[1].end],[3,4]);assert.deepEqual(r.project.notes[2],p.notes[2]);assert.deepEqual(r.project.lyrics[2],p.lyrics[2]);
});
test('seconds shifts use the original map and conflicting groups are rejected atomically',()=>{
 const p=fixture();p.timeAnchors=[{beat:0,second:0},{beat:3,second:1.5},{beat:12,second:10.5}];p.lyrics=p.lyrics.map(t=>({...t,start:timeAtBeat(p,t.start),end:timeAtBeat(p,t.end)}));
 const r=moveAssociatedLyrics(p,['hold','extra'],.5);assert.equal(r.project.lyrics[0].start,p.lyrics[0].start+.5);assert.equal(r.project.lyrics[1].start,p.lyrics[1].start+.5);assert.equal(r.project.notes[0].start,2);assert.deepEqual(r.project.lyrics[0].noteIds,['a','b']);
 assert.throws(()=>retimeAssociated(fixture(),{kind:'note',id:'a',start:9,end:10}),/重叠/);assert.throws(()=>retimeAssociated(fixture(),{kind:'lyric',id:'hold',start:-1,end:1}),/未修改/);assert.throws(()=>retimeAssociated(fixture(),{kind:'lyric',id:'hold',start:1,end:1.01}),/时值|过短/);
});
test('legacy note text becomes a timed associated token without changing unrelated legacy text',()=>{
 const p=validateProject({version:1,bpm:60,key:0,notes:[{id:'old',start:1,duration:1,midi:60,lyric:'旧'},{id:'other',start:6,duration:1,midi:62,lyric:'外'}]});
 const r=retimeAssociated(p,{kind:'note',id:'old',start:2,end:4}).project;
 assert.equal(r.notes[0].lyric,'');assert.equal(r.notes[1].lyric,'外');
 assert.deepEqual(r.lyrics.map(t=>[t.text,t.start,t.end,t.noteIds]),[['旧',2,4,['old']]]);
});
