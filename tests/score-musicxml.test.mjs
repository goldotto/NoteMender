import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {prepareEngraving} from '../public/engraving.mjs';
import {scoreMusicXML} from '../public/score-musicxml.mjs';

const note=(id,start,duration=1,midi=60)=>({id,start,duration,midi});
const project=notes=>validateProject({...makeDemo(),notes,key:0,keyChanges:[],lyrics:[],sections:[],timeAnchors:[]});
const xml=(p,options={})=>scoreMusicXML(prepareEngraving(p,{step:0,...options}));
const notes=s=>[...s.matchAll(/<note>(.*?)<\/note>/gs)].map(m=>m[1]);
const durations=s=>[...s.matchAll(/<duration>(\d+)<\/duration>/g)].map(m=>Number(m[1]));

test('MusicXML keeps absolute pitch across all keys and MIDI boundaries',()=>{
  const semitones={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  for(let key=0;key<12;key++)for(const midi of [21,48,59,60,61,68,71,72,108])for(const flats of [false,true]){
    const p={...project([note('a',0,1,midi)]),key};
    const output=xml(p,{flats}),pitch=output.match(/<pitch>(.*?)<\/pitch>/s)[1];
    const step=pitch.match(/<step>(.)<\/step>/)[1],alter=Number(pitch.match(/<alter>(-?\d+)<\/alter>/)?.[1]||0),octave=Number(pitch.match(/<octave>(-?\d+)<\/octave>/)[1]);
    assert.equal((octave+1)*12+semitones[step]+alter,midi);
    assert.doesNotMatch(output,/undefined|NaN/);
  }
});

test('short, dotted, sustained notes and rests fill each bar without dropping notes',()=>{
  const p=project([note('short',0,.0625),note('dotted',.0625,.1875,62),note('held',3,7,64)]);
  const output=xml(p),all=notes(output),measures=[...output.matchAll(/<measure[^>]*>(.*?)<\/measure>/gs)];
  assert.match(all[0],/<type>64th<\/type>/);assert.match(all[1],/<type>32nd<\/type><dot\/>/);
  assert.equal(measures.length,3);
  for(const measure of measures)assert.equal(durations(measure[1]).reduce((a,b)=>a+b,0),192);
  assert.ok(all.some(n=>n.includes('<rest/>')));
  const held=all.filter(n=>n.includes('<step>E</step>'));
  assert.equal(held.reduce((sum,n)=>sum+durations(n)[0],0),7*48);
  assert.equal(held.filter(n=>n.includes('<tie type="start"/>')).length,held.length-1);
  assert.equal(held.filter(n=>n.includes('<tied type="stop"/>')).length,held.length-1);
});

test('lyrics, marks, tempo, meter and mid-measure key changes survive without mutating the project',()=>{
  const p=project([note('a',0,1.5),note('b',1.5,.5,61),note('c',2,7,63)]);
  p.title='中 & English <日本語> 한국어';p.bpm=92;
  p.keyChanges=[{beat:1.5,key:8}];
  p.lyrics=[{id:'word',text:'啊 & <hello> 日本語 한국어',noteIds:['a','b']}];
  p.notes[2].vocal={breath:true,fermata:true,accent:true,dynamic:'mf',text:'轻柔 & <soft>'};
  p.vocalSlurs=[{start:'a',end:'c'}];
  const before=structuredClone(p),output=xml(p);
  assert.match(output,/<work-title>中 &amp; English &lt;日本語&gt; 한국어<\/work-title>/);
  assert.match(output,/<time><beats>4<\/beats><beat-type>4<\/beat-type><\/time>/);
  assert.match(output,/<sound tempo="92"\/>/);
  assert.match(output,/<\/note><attributes><key><fifths>-4<\/fifths>/);
  assert.equal((output.match(/<lyric /g)||[]).length,1);
  assert.match(output,/啊 &amp; &lt;hello&gt; 日本語 한국어/);
  for(const mark of ['<breath-mark/>','<fermata/>','<accent/>','<mf/>','<slur type="start"','<slur type="stop"'])assert.equal(output.split(mark).length-1,1);
  assert.match(output,/<words>轻柔 &amp; &lt;soft&gt;<\/words>/);
  assert.doesNotMatch(xml(p,{lyrics:false}),/<lyric /);
  assert.deepEqual(p,before);
});

test('irregular and conflicting quantization blocks export without damaging source notes',()=>{
  const p=project([note('a',0,.0625),note('b',.0625,.0625)]),before=structuredClone(p);
  assert.throws(()=>xml(p,{step:.25}),/时长为零/);
  const irregular=project([note('a',0)]);irregular.notes[0].start=.01;
  assert.throws(()=>xml(irregular),/边界/);
  assert.deepEqual(p,before);
});

test('section export clips held notes and keeps the active key and rest padding',()=>{
  const p=project([note('a',0,8,65)]);
  p.sections=[{id:'section',audioStart:1,audioEnd:2}];p.bpm=120;p.keyChanges=[{beat:1,key:5}];
  const output=xml(p,{sectionId:'section'});
  assert.match(output,/<fifths>-1<\/fifths>/);
  assert.match(output,/<tie type="stop"\/>/);
  assert.equal(durations(output).reduce((a,b)=>a+b,0),192);
});

test('independent and touching slurs reuse numbers, overlapping slurs remain distinct',()=>{
  const p=project(Array.from({length:40},(_,i)=>note('n'+i,i)));
  p.vocalSlurs=Array.from({length:39},(_,i)=>({start:'n'+i,end:'n'+(i+1)}));
  assert.equal((xml(p).match(/<slur type="start" number="1"/g)||[]).length,39);
  p.vocalSlurs=[{start:'n0',end:'n3'},{start:'n1',end:'n4'}];
  assert.match(xml(p),/<slur type="start" number="2"/);
});
