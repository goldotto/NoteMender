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

// A zero window means the complete audio. View changes never change section data.
export function sectionViewport(duration,windowSeconds=0,start=0){
  const total=Number.isFinite(duration)&&duration>0?duration:0;
  const seconds=total?Math.min(total,Number.isFinite(windowSeconds)&&windowSeconds>0?windowSeconds:total):0;
  const from=Math.max(0,Math.min(Number.isFinite(start)?start:0,total-seconds));
  return {start:from,end:from+seconds,seconds,full:seconds===total};
}
export function sectionRegionBounds(from,to,view){
  if(!view.seconds||to<=view.start||from>=view.end)return null;
  const left=Math.max(0,(from-view.start)/view.seconds*100),right=Math.min(100,(to-view.start)/view.seconds*100);
  return {left,width:right-left,startHandle:from>=view.start,endHandle:to<=view.end};
}
export function sectionTickStep(seconds,width){
  const desired=seconds/Math.max(1,Math.floor(width/85));
  return [1,2,5,10,15,20,30,60,120,300,600,1200,3600].find(x=>x>=desired)||3600;
}
