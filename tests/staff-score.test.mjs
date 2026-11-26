import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProject} from '../public/music.mjs';
import {editStaffNote,prepareStaffScore,staffPitch} from '../public/staff-score.mjs';
import {scoreMusicXML} from '../public/score-musicxml.mjs';

const project=(notes,options={})=>validateProject({version:1,title:'合成 · 歌詞',bpm:100,key:0,meter:'4/4',offset:0,...options,
  notes:notes.map(([id,start,duration,midi])=>({id,start,duration,midi}))});
const atoms=score=>score.bars.flatMap(bar=>bar.atoms);
const midi=p=>12*(p.octave+1)+[0,2,4,5,7,9,11]['CDEFGAB'.indexOf(p.step)]+p.alter;

test('every spelling across the piano range retains absolute MIDI pitch',()=>{
  for(let key=0;key<12;key++)for(let pitch=21;pitch<=108;pitch++)for(const flats of [true,false]){
    assert.equal(midi(staffPitch(pitch,key,flats)),pitch);
  }
  assert.deepEqual(staffPitch(59,6),{step:'C',alter:-1,octave:4});
  assert.deepEqual(staffPitch(68,8),{step:'A',alter:-1,octave:4});
});

test('accidentals persist through a measure and reset at a bar or key change',()=>{
  const input=project([['up',0,.5,66],['again',.5,.5,66],['natural',1,1,65],['repeat',2,1,65],['bar',4,1,66],['d',5,1,66],['n',6,1,65]],
    {keyChanges:[{beat:5,key:2}]});
  assert.deepEqual(atoms(prepareStaffScore(input)).filter(a=>a.pitch).map(a=>a.accidental),[1,null,0,null,1,null,0]);
});

test('pickup, rests, dotted notes, ties and 64th notes preserve all source timing in supported meters',()=>{
  for(const [meter,barLength] of [['2/4',2],['3/4',3],['4/4',4],['6/8',3]]){
    const input=project([['pickup',0,.75,59],['short',.75,.0625,58],['long',1,5.125,68],['tail',14,.125,66]],{
      meter,key:6,engraving:{pickup:.75},keyChanges:[{beat:3,key:2}],
      lyrics:[{id:'word',text:'中文 English 日本語 한국어',noteIds:['long','tail']}],
      vocalSlurs:[{start:'short',end:'long'}],
    });
    const before=structuredClone(input),staff=prepareStaffScore(input),items=atoms(staff);
    assert.equal(staff.bars[0].duration,.75);
    assert.equal(items[0].dotted,true);
    assert.equal(items[1].base,.0625);
    assert.ok(items.some(a=>a.measureRest));
    for(const bar of staff.bars){
      assert.ok(bar.index===0||bar.duration===barLength);
      assert.equal(bar.atoms.reduce((sum,a)=>sum+a.duration,0),bar.duration);
    }
    for(const note of input.notes){
      const parts=items.filter(a=>a.id===note.id);
      assert.equal(parts[0].start,note.start);
      assert.equal(parts.reduce((sum,a)=>sum+a.duration,0),note.duration);
      assert.ok(parts.every((a,i)=>midi(a.pitch)===note.midi&&a.tieIn===(i>0)&&a.tieOut===(i<parts.length-1)));
    }
    assert.deepEqual(input,before);
    assert.equal(items.filter(a=>a.printLyric==='中文 English 日本語 한국어').length,1);
    const xml=scoreMusicXML(staff);
    assert.match(xml,/<measure number="0" implicit="yes">/);
    assert.match(xml,/<pitch><step>C<\/step><alter>-1<\/alter><octave>4<\/octave><\/pitch>/);
    assert.match(xml,/<rest measure="yes"\/>/);
    assert.match(xml,/<type>64th<\/type>/);
    assert.match(xml,/<fifths>2<\/fifths>/);
    assert.match(xml,/<slur type="start"/);
    assert.doesNotMatch(xml,/<mode>|<type>undefined/);
  }
});

test('automatic clef and bad pickup are presentation choices',()=>{
  const input=project([['low',0,1,33]],{meter:'2/4',engraving:{pickup:3}});
  const staff=prepareStaffScore(input);
  assert.equal(staff.clef,'bass');
  assert.equal(staff.invalidPickup,true);
  assert.equal(input.engraving.pickup,3);
  assert.equal(staff.settings.pickup,0);
  assert.match(scoreMusicXML(staff),/<clef><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.equal(prepareStaffScore(input,{clef:'treble'}).clef,'treble');
});

test('short notes beam inside compound beats and stop at rests',()=>{
  const input=project([['first',0,.5,60],['second',.5,.25,62],['third',.75,.25,64],
    ['fourth',1,.5,64],['fifth',1.5,.5,67],['sixth',2.5,.5,69]],{meter:'6/8'});
  const staff=prepareStaffScore(input);
  assert.deepEqual(atoms(staff).filter(a=>a.pitch).map(a=>a.beams),[
    ['begin'],['continue','begin'],['continue','end'],['end'],undefined,undefined,
  ]);
  assert.match(scoreMusicXML(staff),/<beam number="2">begin<\/beam>/);
});

test('pitch and duration edits keep IDs, positions and attachments and reject overlap',()=>{
  const input=project([['first',0,1,60],['explicit-rest',2,.5,null],['second',3,1,62]],{
    offset:.2,lyrics:[{id:'line',text:'a',noteIds:['first']}],vocalSlurs:[{start:'first',end:'second'}],
  });
  const original={...input,notes:[{...input.notes[0],vocal:{breath:true,text:'cue'}},...input.notes.slice(1)]};
  const edited=editStaffNote(original,'first',{midi:61,duration:2});
  assert.equal(edited.notes[0].midi,61);
  assert.equal(edited.notes[0].duration,2);
  assert.equal(edited.notes[0].id,'first');
  assert.equal(edited.notes[0].start,0);
  assert.equal(edited.notes[0].vocal,original.notes[0].vocal);
  assert.equal(edited.lyrics,original.lyrics);
  assert.equal(edited.vocalSlurs,original.vocalSlurs);
  assert.equal(edited.timeAnchors,original.timeAnchors);
  assert.equal(original.notes[0].duration,1);
  assert.throws(()=>editStaffNote(original,'first',{duration:2.0625}),/重叠/);
  assert.throws(()=>editStaffNote(original,'first',{duration:.1}),/1\/16/);
  assert.throws(()=>editStaffNote(original,'first',{midi:109}),/音高/);
});
