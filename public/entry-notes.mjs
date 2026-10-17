import {EDIT_STEP,KEYS,keyAt,numberPitch,pitchName} from './music.mjs';
import {timeAtBeat} from './time-map.mjs';
export const SOLFEGE=['休止','Do','Re','Mi','Fa','Sol','La','Si'];
export function degreeMidi(digit,{key=0,octave=0,accidental=0}={}){
  if(!Number.isInteger(digit)||digit<0||digit>7)throw Error('请选择 0–7');
  if(digit===0)return null;
  const midi=60+key+[0,2,4,5,7,9,11][digit-1]+octave*12+accidental;
  if(!Number.isInteger(midi)||midi<21||midi>108)throw Error('超出可编辑音域（MIDI 21–108）');
  return midi;
}
export function describePitch(midi,key=0,flats=false){
  const p=numberPitch(midi,key,flats),register=p.octave===0?'中音':`${p.octave>0?'高':'低'}${Math.abs(p.octave)===1?'音':Math.abs(p.octave)+'组'}`;
  return { ...p, label:midi===null?'0 休止':`${register} ${p.accidental}${p.digit} ${SOLFEGE[+p.digit]}`, notation:midi===null?'0':`${p.accidental}${p.digit}${p.octave>0?'̇'.repeat(p.octave):p.octave<0?'̣'.repeat(-p.octave):''}`, detail:midi===null?'此处留空，不发声':`${pitchName(midi)} · MIDI ${midi} · 当前 1=${KEYS[key]}`};
}
export function sequencePlan(project,start,items){
  if(!Number.isFinite(start)||start<0||Math.abs(start/EDIT_STEP-Math.round(start/EDIT_STEP))>1e-6)throw Error('起点须为有效的 1/16 拍位置');
  if(!items.length)throw Error('先点数字加入音符');
  let beats=0;
  const notes=items.map(item=>{
    const {midi,duration}=item;
    if(midi!==null&&(!Number.isInteger(midi)||midi<21||midi>108))throw Error('音高超出可编辑范围');
    if(!Number.isFinite(duration)||duration<EDIT_STEP||duration>64||Math.abs(duration/EDIT_STEP-Math.round(duration/EDIT_STEP))>1e-6)throw Error('时长须为 1/16 拍的倍数');
    const n={start:beats,duration,midi,confidence:1,reviewStatus:'reviewed',lyric:''};beats+=duration;return n;
  });
  if(beats>64+1e-6)throw Error('一次最多写入 64 拍');
  if(start+beats>14400)throw Error('写入范围超出工程长度');
  return {notes,beats,start,end:start+beats,seconds:timeAtBeat(project,start+beats)-timeAtBeat(project,start),key:keyAt(project,start)};
}
