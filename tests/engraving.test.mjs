import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {prepareEngraving,engravingBars,layoutEngraving,renderEngraving} from '../public/engraving.mjs';
import {engravingSettings} from '../public/engraving-settings.mjs';
import {projectText,parseProjectText} from '../public/project-file.mjs';

const note=(id,start,duration,midi=60)=>({id,start,duration,midi,lyric:'',confidence:1});
const score=notes=>({...makeDemo(),notes,sections:[],keyChanges:[],lyrics:[],timeAnchors:[],offset:0});
test('engraving keeps the source immutable, IDs and count through rhythmic rounding',()=>{
  const original=score([note('a',.0625,.375),note('b',.5,.375,62)]),before=structuredClone(original);
  const result=prepareEngraving(original);assert.equal(result.settings.step,.25);
  assert.deepEqual(original,before);assert.deepEqual(result.project.notes.map(n=>n.id),['a','b']);
  assert.equal(result.changes.length,2);assert.ok(result.maxSecondShift>0);assert.equal(result.issues.length,0);
  assert.equal(result.project.notes[0].start,0);assert.equal(result.project.notes[1].duration,.5);
});
test('short notes are never silently removed and invalid quantization cannot render',()=>{
  const p=score([note('quick',0,.0625),note('next',.0625,.0625,64)]);
  const coarse=prepareEngraving(p);assert.equal(coarse.project.notes.length,2);
  assert.throws(()=>renderEngraving(coarse),/时长为零/);
  const fine=prepareEngraving(p,{step:.0625});assert.equal(fine.issues.length,0);
  assert.deepEqual(engravingBars(fine)[0].atoms.filter(a=>a.id).map(a=>a.id),['quick','next']);
  const overlap=prepareEngraving(score([note('a',0,1),note('b',.5,1)]));
  assert.throws(()=>renderEngraving(overlap),/重叠/);
});
test('bar splitting and binary durations preserve every sounded beat, with tied continuations and rests',()=>{
  const p=score([note('held',3,7.1875,73)]),result=prepareEngraving(p,{step:0});
  const atoms=engravingBars(result).flatMap(b=>b.atoms),sounded=atoms.filter(a=>a.id==='held');
  assert.equal(atoms.reduce((a,n)=>a+n.duration,0),12);
  assert.equal(sounded.reduce((a,n)=>a+n.duration,0),7.1875);
  assert.equal(sounded[0].tieIn,false);assert.equal(sounded[0].tieOut,true);assert.equal(sounded.at(-1).tieIn,true);assert.equal(sounded.at(-1).tieOut,false);
  const svg=renderEngraving(result).svg;assert.match(svg,/circle/);assert.match(svg,/♯/);assert.match(svg,/stroke="black"/);assert.ok(!svg.includes('data-note'));
});
test('lyrics print once for a melisma, multiple words stay together, and unlinked words are listed',()=>{
  const p=score([note('a',0,1),note('b',1,1),note('c',2,1)]);
  p.lyrics=[{id:'l1',text:'风',noteIds:['a','b']},{id:'l2',text:'Hello',noteIds:['c']},{id:'l3',text:'世界',noteIds:['c']},{id:'l4',text:'未对应',noteIds:[]}];
  const result=prepareEngraving(p);assert.equal(result.project.notes[0].printLyric,'风');assert.equal(result.project.notes[1].printLyric,'');assert.equal(result.project.notes[1].lyricContinuation,true);assert.equal(result.project.notes[2].printLyric,'Hello 世界');assert.deepEqual(result.orphans,['未对应']);
  assert.ok(!renderEngraving(prepareEngraving(p,{lyrics:false})).svg.includes('Hello'));
});
test('section export clips only its copy and preserves key changes unless overridden',()=>{
  const p=score([note('a',0,4),note('b',4,4,66)]);p.bpm=120;p.keyChanges=[{beat:4,key:7}];
  p.sections=[{id:'s',audioStart:1,audioEnd:3,name:'片段'}];
  const cut=prepareEngraving(p,{sectionId:'s',step:0});assert.equal(cut.from,2);assert.equal(cut.project.notes[0].duration,2);assert.equal(cut.project.notes[1].duration,2);assert.equal(p.notes[0].duration,4);
  const atoms=engravingBars(cut).flatMap(b=>b.atoms).filter(a=>a.id);assert.deepEqual(atoms.map(a=>a.key),[0,7]);assert.equal(atoms[0].tieIn,true);
  assert.ok(engravingBars(prepareEngraving(p,{key:2})).flatMap(b=>b.atoms).every(a=>a.key===2));
});
test('dense bilingual pages keep complete rows in page bounds and escape user text',()=>{
  const p=score(Array.from({length:240},(_,i)=>({...note('n'+i,i/4,.25,60+i%12),lyric:['中文','Hello','日本語','한국어'][i%4]})));p.title='<unsafe>&';
  const result=renderEngraving(prepareEngraving(p));assert.ok(result.pages.length>1);
  for(const page of result.pages)assert.ok(page.includes('&lt;unsafe&gt;&amp;')&&!page.includes('<unsafe>'));
  const layout=layoutEngraving(prepareEngraving(p)),maxHeight=layout.height-2*layout.margin-layout.headerHeight;
  for(const page of layout.pages)assert.ok(page.rows.reduce((sum,row)=>sum+row.height,0)<=maxHeight);
  // All written source IDs survive preparation; printed pieces may increase through ties.
  assert.equal(new Set(engravingBars(prepareEngraving(p)).flatMap(b=>b.atoms).filter(a=>a.id).map(a=>a.id)).size,240);
});
test('optional engraving settings survive a project roundtrip, old projects remain unchanged',()=>{
  const p=makeDemo();assert.equal(validateProject(p).engraving,undefined);
  p.engraving=engravingSettings({step:.125,margin:18,lyrics:false,key:2});
  assert.deepEqual(parseProjectText(projectText(p)).engraving,p.engraving);
  assert.equal(engravingSettings({step:'not-a-number'}).step,.25);
});
