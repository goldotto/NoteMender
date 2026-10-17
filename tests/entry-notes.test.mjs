import test from 'node:test';
import assert from 'node:assert/strict';
import {degreeMidi,describePitch,sequencePlan} from '../public/entry-notes.mjs';
import {keyAt,makeDemo,numberPitch,validateProject} from '../public/music.mjs';
import {replaceRange} from '../public/note-input.mjs';

test('number buttons agree with notation in every key and register',()=>{
  for(let key=0;key<12;key++)for(let octave=-2;octave<=2;octave++)for(let digit=1;digit<=7;digit++){
    const midi=degreeMidi(digit,{key,octave});assert.deepEqual(numberPitch(midi,key),{digit:String(digit),accidental:'',octave});
  }
  assert.equal(degreeMidi(0,{key:11,octave:9}),null);
  assert.throws(()=>degreeMidi(1,{octave:-4}),/音域/);
  assert.throws(()=>degreeMidi(7,{key:11,octave:3}),/音域/);
  assert.equal(degreeMidi(4,{key:2,octave:1,accidental:1}),80);
  assert.equal(describePitch(61,0,true).label,'中音 ♭2 Re');
});
test('queue keeps actual pitch when retargeted, uses nonlinear duration, supports rests and 64 beats',()=>{
  const p=validateProject({...makeDemo(),bpm:60,offset:0,keyChanges:[{beat:4,key:2}],timeAnchors:[{beat:0,second:0},{beat:4,second:4},{beat:8,second:12}],notes:[]});
  const items=[{midi:degreeMidi(1,{key:keyAt(p,0)}),duration:.5},{midi:null,duration:.5},{midi:degreeMidi(3,{key:keyAt(p,5)}),duration:1}];
  const first=sequencePlan(p,0,items),moved=sequencePlan(p,4,items);
  assert.equal(first.seconds,2);assert.equal(moved.seconds,4);assert.equal(moved.key,2);
  assert.deepEqual(moved.notes.map(n=>n.midi),[60,null,66]);
  const edited=sequencePlan(p,0,[{...items[0],duration:2},...items.slice(1)]);
  assert.deepEqual(edited.notes.map(n=>n.start),[0,2,2.5]);
  assert.equal(sequencePlan(p,0,[{midi:null,duration:64}]).end,64);
  assert.throws(()=>sequencePlan(p,0,[{midi:60,duration:64},{midi:62,duration:.0625}]),/64/);
  assert.throws(()=>sequencePlan(p,.03,items),/起点/);
  assert.throws(()=>sequencePlan(p,0,[{midi:60,duration:.1}]),/时长/);
  assert.throws(()=>sequencePlan(p,14399,[{midi:60,duration:2}]),/长度/);
});
test('range overwrite keeps outside fragments and their lyric associations; rests do not create notes',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'long',start:0,duration:8,midi:60},{id:'later',start:10,duration:1,midi:65}],lyrics:[{id:'word',text:'唱',start:0,end:8,noteIds:['long'],reviewed:true}]});
  const plan=sequencePlan(p,2,[{midi:62,duration:1},{midi:null,duration:1}]),next=replaceRange(p,plan.start,plan.end,plan.notes);
  assert.deepEqual(next.notes.map(n=>[n.start,n.duration,n.midi]),[[0,2,60],[2,1,62],[4,4,60],[10,1,65]]);
  assert.deepEqual(next.lyrics[0].noteIds,[next.notes[0].id,next.notes[2].id]);assert.equal(next.lyrics[0].text,'唱');
  assert.deepEqual(p.lyrics[0].noteIds,['long']);assert.equal(p.notes[0].duration,8);
});
test('removed words stay unassigned, including legacy lyrics, and right-only remnants retain identity',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'first',start:0,duration:2,midi:60,lyric:'甲'},{id:'tail',start:2,duration:4,midi:62}],lyrics:[{id:'second',text:'乙',start:2,end:6,noteIds:['tail'],reviewed:true}]});
  const next=replaceRange(p,0,3,[{midi:null,start:0,duration:3}]);
  assert.equal(next.notes[0].id,'tail');assert.equal(next.notes[0].start,3);
  assert.deepEqual(next.lyrics.find(t=>t.id==='second').noteIds,['tail']);
  assert.deepEqual(next.lyrics.find(t=>t.text==='甲').noteIds,[]);
  const empty=replaceRange(next,3,6,[{midi:null,start:0,duration:3}]);
  assert.equal(empty.notes.length,0);assert.deepEqual(empty.lyrics.map(t=>t.noteIds),[[],[]]);
});
test('invalid empty/rest ranges cannot silently erase a project',()=>{
  const p=makeDemo();
  assert.throws(()=>replaceRange(p,NaN,4,[]),/范围/);
  assert.throws(()=>replaceRange(p,0,4,[{midi:null,start:0,duration:-1}]),/范围/);
  assert.throws(()=>replaceRange(p,0,4,[{midi:null,start:NaN,duration:1}]),/范围/);
});
