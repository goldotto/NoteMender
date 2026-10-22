import {beatAtTime,timeAtBeat} from './time-map.mjs';

export const SECTION_MIN_SECONDS=.25;
export function sectionSeconds(project,section){
  return {from:section.audioStart??timeAtBeat(project,section.start),to:section.audioEnd??timeAtBeat(project,section.end)};
}
export function sectionBeats(project,section){
  const {from,to}=sectionSeconds(project,section);
  return {start:Math.max(0,beatAtTime(project,from)),end:Math.max(0,beatAtTime(project,to))};
}
export function validateSectionRange(sections,{audioStart,audioEnd},excludeId=null){
  if(!Number.isFinite(audioStart)||!Number.isFinite(audioEnd)||audioStart<0||audioEnd-audioStart<SECTION_MIN_SECONDS-1e-6)throw Error('区块须在原音内，且至少持续 0.25 秒');
  if(sections.some(s=>s.id!==excludeId&&audioStart<(s.audioEnd??0)-1e-6&&audioEnd>(s.audioStart??0)+1e-6))throw Error('歌曲区块不能重叠，请调整边界');
}
export function shiftSelectedNotes(project,ids,semitones){
  if(!Number.isInteger(semitones)||![1,-1,12,-12].includes(semitones))throw Error('批量升降只支持半音或八度');
  const chosen=new Set(ids);
  if(project.notes.some(n=>chosen.has(n.id)&&n.midi!==null&&(n.midi+semitones<21||n.midi+semitones>108)))throw Error('所选音符将超出 MIDI 21–108，整批未修改');
  return {...project,notes:project.notes.map(n=>chosen.has(n.id)?{...n,midi:n.midi===null?null:n.midi+semitones,reviewStatus:'reviewed'}:n)};
}
