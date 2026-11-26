import {tr} from './i18n.mjs';
import {EDIT_STEP,KEYS,keyAt,numberPitch,pitchName} from './music.mjs';
import {timeAtBeat} from './time-map.mjs';
export const SOLFEGE=['休止','Do','Re','Mi','Fa','Sol','La','Si'];
export function degreeMidi(digit,{key=0,octave=0,accidental=0}={}){
  if(!Number.isInteger(digit)||digit<0||digit>7)throw Error(tr("请选择 0–7","Choose a number from 0 to 7"));
  if(digit===0)return null;
  const midi=60+key+[0,2,4,5,7,9,11][digit-1]+octave*12+accidental;
  if(!Number.isInteger(midi)||midi<21||midi>108)throw Error(tr("超出可编辑音域（MIDI 21–108）","Outside the editable pitch range (MIDI 21\u2013108)"));
  return midi;
}
export function describePitch(midi,key=0,flats=false){
  const p=numberPitch(midi,key,flats),register=p.octave===0?'中音':`${p.octave>0?'高':'低'}${Math.abs(p.octave)===1?'音':Math.abs(p.octave)+'组'}`;
  return { ...p, label:midi===null?tr('0 休止','0 Rest'):`${tr(register,p.octave===0?'Middle':`${p.octave>0?'Upper':'Lower'} octave${Math.abs(p.octave)>1?' '+Math.abs(p.octave):''}`)} ${p.accidental}${p.digit} ${SOLFEGE[+p.digit]}`, notation:midi===null?'0':`${p.accidental}${p.digit}${p.octave>0?'̇'.repeat(p.octave):p.octave<0?'̣'.repeat(-p.octave):''}`, detail:midi===null?tr("此处留空，不发声","A silent gap"):`${pitchName(midi)} · MIDI ${midi} · ${tr('当前','Key')} 1=${KEYS[key]}`};
}
export function sequencePlan(project,start,items){
  if(!Number.isFinite(start)||start<0||Math.abs(start/EDIT_STEP-Math.round(start/EDIT_STEP))>1e-6)throw Error(tr("起点须为有效的 1/16 拍位置","The start must be a valid multiple of 1/16 beat"));
  if(!items.length)throw Error(tr("先点数字加入音符","Click a number to add a note first"));
  let beats=0;
  const notes=items.map(item=>{
    const {midi,duration}=item;
    if(midi!==null&&(!Number.isInteger(midi)||midi<21||midi>108))throw Error(tr("音高超出可编辑范围","Pitch is outside the editable range"));
    if(!Number.isFinite(duration)||duration<EDIT_STEP||duration>64||Math.abs(duration/EDIT_STEP-Math.round(duration/EDIT_STEP))>1e-6)throw Error(tr("时长须为 1/16 拍的倍数","Duration must be a multiple of 1/16 beat"));
    const n={start:beats,duration,midi,confidence:1,reviewStatus:'reviewed',lyric:''};beats+=duration;return n;
  });
  if(beats>64+1e-6)throw Error(tr("一次最多写入 64 拍","Insert no more than 64 beats at once"));
  if(start+beats>14400)throw Error(tr("写入范围超出工程长度","The insertion exceeds the project length"));
  return {notes,beats,start,end:start+beats,seconds:timeAtBeat(project,start+beats)-timeAtBeat(project,start),key:keyAt(project,start)};
}
