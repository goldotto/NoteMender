import {prepareEngraving} from './engraving.mjs';
import {barLength,EDIT_STEP,KEYS,mod} from './music.mjs';
import {tr} from './i18n.mjs';

export const STAFF_FIFTHS=[0,-5,2,-3,4,-1,-6,1,-4,3,-2,5];
export const STAFF_KEYS=KEYS.map(key=>key.replace('♭','b'));
const letters='CDEFGAB',natural=[0,2,4,5,7,9,11],ticks=beat=>Math.round(beat/EDIT_STEP);
const signatures=STAFF_FIFTHS.map(fifths=>new Map([...(fifths<0?'BEADGCF':'FCGDAEB').slice(0,Math.abs(fifths))].map(letter=>[letter,Math.sign(fifths)])));
const values=[64,48,32,24,16,12,8,6,4,3,2,1];
const dotted=new Set([48,24,12,6,3]);
const stepName=pitch=>pitch.step+({1:'♯','-1':'♭'}[pitch.alter]||'')+pitch.octave;

export function staffPitch(midi,key,preferFlats=false){
  const alterations=signatures[key];
  const candidates=[...letters].flatMap((step,i)=>[-1,0,1].flatMap(alter=>{
    const delta=midi-natural[i]-alter;
    return mod(delta,12)===0?[{step,alter,octave:delta/12-1}]:[];
  }));
  const inKey=candidates.find(p=>p.alter===(alterations.get(p.step)||0));
  return inKey||candidates.find(p=>p.alter===0)||candidates.find(p=>p.alter===(preferFlats||STAFF_FIFTHS[key]<0?-1:1))||candidates[0];
}

export function staffPitchName(pitch){return stepName(pitch);}

export function staffLedgerLines(pitch,clef){
  const line=pitch.octave*7+letters.indexOf(pitch.step),bottom=clef==='bass'?18:30;
  return Math.max(0,Math.floor((bottom-line)/2),Math.floor((line-bottom-8)/2));
}

function durationAt(start,room,barStart,barDuration,compound,rest){
  const group=compound?24:16,relative=start-barStart;
  const boundary=(Math.floor(relative/group)+1)*group;
  return values.find(value=>{
    if(value>room)return false;
    if(relative===0&&value===barDuration)return true;
    if(relative%group!==0){
      // Align subdivisions inside a beat (or dotted beat) before crossing it.
      const base=dotted.has(value)?value*2/3:value;
      return relative+value<=boundary&&(relative%group)%base===0;
    }
    if(compound)return value<=group;
    if(value===32&&barDuration===64&&relative%32!==0)return false;
    return !rest||!dotted.has(value)||value<=group;
  });
}

function markBeams(atoms){
  const count=atom=>atom&&atom.midi!==null?Math.max(0,-Math.log2(atom.base)):0;
  for(const [i,atom] of atoms.entries()){
    const before=atoms[i-1],after=atoms[i+1],levels=count(atom);
    const left=before?.beatGroup===atom.beatGroup&&before.key===atom.key?count(before):0;
    const right=after?.beatGroup===atom.beatGroup&&after.key===atom.key?count(after):0;
    if(!levels||!left&&!right)continue;
    atom.beams=Array.from({length:levels},(_,i)=>{
      const level=i+1;
      if(left>=level&&right>=level)return 'continue';
      if(left>=level)return 'end';
      if(right>=level)return 'begin';
      return left?'backward hook':'forward hook';
    });
  }
}

// Work in integer editor ticks. Only this presentation copy is split into rests,
// dotted values and tied fragments; every sounded fragment retains its source ID.
export function prepareStaffScore(project,{clef='auto',preferFlats=false}={}){
  const measure=ticks(barLength(project.meter)),storedPickup=ticks(project.engraving?.pickup||0);
  const invalidPickup=storedPickup>=measure;
  const pickup=invalidPickup?0:storedPickup;
  const prepared=prepareEngraving(project,{step:0,pickup:pickup*EDIT_STEP});
  const p=prepared.project,first=pickup||measure,end=ticks(p.notes.at(-1).start+p.notes.at(-1).duration);
  const total=first+Math.max(0,Math.ceil((end-first)/measure))*measure;
  const changes=p.keyChanges.map(change=>({...change,tick:ticks(change.beat)}));
  const bars=[],spans=[];
  let cursor=0;
  for(const note of p.notes){
    const start=ticks(note.start);
    if(start>cursor)spans.push({start:cursor,end:start,midi:null});
    cursor=start+ticks(note.duration);
    spans.push({...note,start,end:cursor});
  }
  if(cursor<total)spans.push({start:cursor,end:total,midi:null});

  let keyIndex=0,accidentals=new Map(),previousBar=-1,previousKey=-1;
  const cost={treble:0,bass:0};
  for(const note of spans){
    let part=0,pitch=null;
    for(let at=note.start;at<note.end;){
      const index=at<first?0:1+Math.floor((at-first)/measure);
      const start=index?first+(index-1)*measure:0,length=index?measure:first;
      const bar=bars[index]??={index,start:start*EDIT_STEP,duration:length*EDIT_STEP,atoms:[]};
      while(changes[keyIndex+1]?.tick<=at)keyIndex++;
      const key=changes[keyIndex].key;
      if(index!==previousBar||key!==previousKey)accidentals=new Map();
      const cap=Math.min(note.end,start+length,changes[keyIndex+1]?.tick??Infinity);
      const measureRest=note.midi===null&&at===start&&cap===start+length;
      const duration=measureRest?length:durationAt(at,cap-at,start,length,p.meter==='6/8',note.midi===null);
      if(note.midi!==null&&!pitch){
        pitch=staffPitch(note.midi,key,preferFlats);
        for(const name of ['treble','bass'])cost[name]+=staffLedgerLines(pitch,name);
      }
      const tieIn=Boolean(pitch&&part),tieOut=Boolean(pitch&&at+duration<note.end);
      let accidental=null;
      if(pitch){
        const place=pitch.step+pitch.octave;
        const expected=accidentals.get(place)??signatures[key].get(pitch.step)??0;
        if(!tieIn&&pitch.alter!==expected){accidental=pitch.alter;accidentals.set(place,pitch.alter);}
      }
      const base=measureRest?64:dotted.has(duration)?duration*2/3:duration;
      bar.atoms.push({...note,start:at*EDIT_STEP,duration:duration*EDIT_STEP,part,key,pitch,accidental,measureRest,
        base:base*EDIT_STEP,dotted:!measureRest&&dotted.has(duration),tieIn,tieOut,printLyric:part?'':note.printLyric||'',
        beatGroup:Math.floor((at-start)/(p.meter==='6/8'?24:16))});
      at+=duration;part++;
      previousBar=index;previousKey=key;
    }
  }
  for(const bar of bars)markBeams(bar.atoms);
  const actualClef=clef==='auto'?(cost.bass<cost.treble?'bass':'treble'):clef;
  return {...prepared,bars,clef:actualClef,invalidPickup};
}

export function editStaffNote(project,id,changes){
  const index=project.notes.findIndex(note=>note.id===id);
  if(index<0||project.notes[index].midi===null)return project;
  const before=project.notes[index],after={...before,midi:changes.midi??before.midi,duration:changes.duration??before.duration};
  if(!Number.isInteger(after.midi)||after.midi<21||after.midi>108)throw Error(tr('音高超出可编辑范围。','Pitch is outside the editable range.','編集可能な音高の範囲を超えています。'));
  if(!Number.isFinite(after.duration)||after.duration<EDIT_STEP||after.duration>128||ticks(after.duration)*EDIT_STEP!==after.duration){
    throw Error(tr('时值须为 1/16 至 128 拍，以 1/16 拍递增。','Enter a duration from 1/16 to 128 beats in 1/16-beat increments.','音価は1/16〜128拍を1/16拍刻みで入力してください。'));
  }
  if(after.start+after.duration>(project.notes[index+1]?.start??14400)){
    throw Error(tr('此时值会与下一音重叠或超出工程长度。','This duration overlaps the next note or exceeds the project length.','次の音符と重なるか、プロジェクトの長さを超えます。'));
  }
  if(before.midi===after.midi&&before.duration===after.duration)return project;
  return {...project,notes:project.notes.map((note,i)=>i===index?{...after,reviewStatus:'reviewed'}:note)};
}
