import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanRhythm} from '../public/rhythm-cleanup.mjs';
import {makeDemo,validateProject} from '../public/music.mjs';
import {prepareEngraving,engravingBars} from '../public/engraving.mjs';
import {dolceDocument} from '../public/dolce-score.mjs';
import {scoreMusicXML} from '../public/score-musicxml.mjs';
import {projectText,parseProjectText} from '../public/project-file.mjs';

const note=(id,start,duration,midi=60)=>({id,start,duration,midi});
const project=notes=>({...makeDemo(),notes,lyrics:[],keyChanges:[],timeAnchors:[],sections:[]});

test('automatic rhythm cleanup simplifies nearly regular timing without losing short notes',()=>{
  const p=project([note('a',.0625,.875),note('b',1.0625,.875),note('quick',2,.0625),note('next',2.0625,.0625)]),before=structuredClone(p);
  const prepared=prepareEngraving(p,{tidy:true,groupBeats:true});
  assert.deepEqual(prepared.project.notes.map(n=>n.id),p.notes.map(n=>n.id));
  assert.deepEqual(p,before);assert.equal(prepared.issues.length,0);
  assert.ok(prepared.maxBeatShift<=.125+1e-7);
  assert.ok(prepared.project.notes.every(n=>n.duration>0));
  assert.ok(prepared.project.notes.every((n,i,a)=>!i||n.start>=a[i-1].start+a[i-1].duration-1e-7));
  assert.ok(prepared.project.notes[0].start===0);
  engravingBars(prepared);
});

test('gap closing is opt-in and respects rests, larger gaps and lyric identities',()=>{
  const p=project([note('a',0,.9375),note('b',1,1),note('rest',2,.0625,null),note('c',2.125,1),note('d',4,1)]);
  p.lyrics=[{id:'word',text:'啊',noteIds:['a','b']}];
  assert.equal(cleanRhythm(p.notes).closedGaps,0);
  const prepared=prepareEngraving(p,{tidy:true,closeGaps:true});
  assert.equal(prepared.closedGaps,1);assert.deepEqual(prepared.project.lyrics,p.lyrics);
  assert.equal(prepared.project.notes[0].duration,1);
  assert.equal(prepared.project.notes[0].printLyric,'啊');assert.equal(prepared.project.notes[1].printLyric,'');
  assert.ok(prepared.project.notes[4].start-prepared.project.notes[3].start-prepared.project.notes[3].duration>.125);
});

test('pickup bars and compound-meter groups preserve notes, ties, keys and XML measure lengths',()=>{
  for(const meter of ['2/4','3/4','4/4','6/8']){
    const p={...project([note('a',0,.5),note('b',.5,8)]),meter};
    p.keyChanges=[{beat:2,key:5}];
    const prepared=prepareEngraving(p,{step:0,pickup:.5,groupBeats:true}),bars=engravingBars(prepared);
    assert.equal(bars[0].atoms.reduce((s,n)=>s+n.duration,0),.5);
    assert.equal(bars.flatMap(b=>b.atoms).filter(n=>n.id==='b').reduce((s,n)=>s+n.duration,0),8);
    assert.match(scoreMusicXML(prepared),/<measure number="0" implicit="yes">/);
    assert.equal(dolceDocument(prepared).doc.songs[0].parts[0].measures[0].number,'0');
  }
  const p=project(Array.from({length:8},(_,i)=>note('n'+i,i*.5,.5)));
  const {doc}=dolceDocument(prepareEngraving(p,{step:0,groupBeats:true}));
  const elements=doc.songs[0].parts[0].measures[0].elements;
  assert.deepEqual(elements.map((n,i)=>n.before?i:null).filter(i=>i!==null),[2,4,6]);
  const compound={...p,meter:'6/8'};
  assert.ok(dolceDocument(prepareEngraving(compound,{step:0,groupBeats:true})).doc.songs[0].parts[0].measures[0].elements[3].before);
});

test('off-beat sustained notes split at the next beat while retaining identity',()=>{
  const p=project([note('held',.75,1.5)]),atoms=engravingBars(prepareEngraving(p,{step:0,groupBeats:true})).flatMap(b=>b.atoms).filter(n=>n.id);
  assert.equal(atoms[0].duration,.25);assert.equal(atoms[0].tieOut,true);
  assert.equal(atoms.reduce((sum,n)=>sum+n.duration,0),1.5);
});

test('cleanup settings roundtrip with old project defaults and invalid pickup stays blocked',()=>{
  const p=validateProject(project([note('a',0,1)]));
  p.engraving={tidy:true,closeGaps:true,groupBeats:true,pickup:.5};
  const restored=parseProjectText(projectText(p));
  assert.equal(restored.engraving.tidy,true);assert.equal(restored.engraving.pickup,.5);
  assert.throws(()=>engravingBars(prepareEngraving({...p,meter:'2/4'},{pickup:3})),/首小节/);
});

test('dense repeated notes, long scores and overlapping inputs remain ordered or explicitly blocked',()=>{
  for(const count of [1,64,2048]){
    const p=project(Array.from({length:count},(_,i)=>note('n'+i,i*.0625,.0625)));
    const prepared=prepareEngraving(p,{tidy:true});assert.equal(prepared.issues.length,0);
    assert.equal(new Set(engravingBars(prepared).flatMap(b=>b.atoms).filter(n=>n.id).map(n=>n.id)).size,count);
  }
  assert.throws(()=>engravingBars(prepareEngraving(project([note('a',0,1),note('b',.5,1)]),{tidy:true})),/重叠/);
});
