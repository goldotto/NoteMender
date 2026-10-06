import {timeAtBeat} from './time-map.mjs';
import {mapLyricIds,withOrphanLyrics} from './lyrics.mjs';
import {EDIT_STEP,snap,uid,validateProject} from './music.mjs';

export function replaceSectionCandidate(project,section,candidate){
  // Audio section boundaries are continuous seconds. Snap only the score edit;
  // callers retain the original second-based markers and time alignment.
  if(!Number.isFinite(section.start)||!Number.isFinite(section.end)||section.end<=section.start)throw Error('无效候选范围');
  const start=Math.max(0,snap(section.start,EDIT_STEP)),end=Math.max(start+EDIT_STEP,snap(section.end,EDIT_STEP)),retained=[],mapping=new Map(),newMapping=new Map(),candidateNotes=Array.isArray(candidate)?candidate:candidate.notes;
  for(const n of project.notes){
    const tail=n.start+n.duration;
    if(tail<=start||n.start>=end){retained.push(n);continue;}
    if(n.start<start)retained.push({...n,duration:start-n.start});
    if(tail>end){const id=uid();retained.push({...n,id,start:end,duration:tail-end,lyric:''});mapping.set(n.id,[...(n.start<start?[n.id]:[]),id]);}
  }
  for(const n of candidateNotes){
    const from=Math.max(start,snap(n.start,EDIT_STEP)),to=Math.min(end,snap(n.start+n.duration,EDIT_STEP));
    if(to-from>=EDIT_STEP-1e-6){const id=uid();retained.push({...n,id,start:from,duration:to-from,reviewStatus:'pending',lyric:''});if(n.id)newMapping.set(n.id,[id]);}
  }
  const a=timeAtBeat(project,start),b=timeAtBeat(project,end),hasLyrics=!Array.isArray(candidate)&&Array.isArray(candidate.lyrics);
  const available=new Set(retained.map(n=>n.id));
  const incoming=hasLyrics?mapLyricIds(candidate.lyrics,newMapping):[];
  const old=mapLyricIds(project.lyrics||[],mapping).map(t=>{const linked=incoming.find(m=>m.id===t.id&&m.text===t.text);return linked?{...t,noteIds:[...new Set([...t.noteIds.filter(id=>available.has(id)),...linked.noteIds])] }:t;}).filter(t=>!hasLyrics||t.reviewed||t.start===null||t.end<=a||t.start>=b||t.noteIds.some(id=>available.has(id)));
  const added=hasLyrics?incoming.filter(t=>!old.some(m=>m.id===t.id||m.reviewed&&m.start!==null&&t.start!==null&&Math.min(m.end,t.end)-Math.max(m.start,t.start)>(t.end-t.start)*.5)):[];
  return validateProject(withOrphanLyrics(project,{...project,notes:retained,...(project.lyrics||hasLyrics?{lyrics:[...old,...added].sort((x,y)=>(x.start??Infinity)-(y.start??Infinity))}:{})}));
}
