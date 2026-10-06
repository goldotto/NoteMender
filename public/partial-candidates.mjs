import {uid,EDIT_STEP} from './music.mjs';
import {beatAtTime} from './time-map.mjs';

function clipped(project,notes,from,to){
  const start=Math.max(0,Math.round(beatAtTime(project,from)/EDIT_STEP)*EDIT_STEP),end=Math.round(beatAtTime(project,to)/EDIT_STEP)*EDIT_STEP;
  return notes.flatMap(n=>{const a=Math.max(start,n.start),b=Math.min(end,n.start+n.duration);return b-a>=EDIT_STEP-1e-6?[{...n,start:a,duration:b-a}]:[];});
}
function clippedLyrics(project,candidate,from,to){const ids=new Set(clipped(project,candidate.notes,from,to).map(n=>n.id));return Array.isArray(candidate.lyrics)?{lyrics:candidate.lyrics.filter(t=>t.start!==null&&t.start<to&&t.end>from).map(t=>({...t,noteIds:t.noteIds.filter(id=>ids.has(id))}))}:{};}
// Section markers stay in audio seconds; only candidate note boundaries use beats.
export function integratePartialCandidates(project,generated,variants,from,to){
  const sections=[...generated],retained=new Map(),replaced=[];
  for(const s of project.sections||[]){
    if(s.audioEnd<=from||s.audioStart>=to){sections.push(s);retained.set(s.id,[s]);continue;}
    replaced.push(s);const parts=[];
    if(from-s.audioStart>=.25)parts.push({...s,audioEnd:from});
    if(s.audioEnd-to>=.25)parts.push({...s,id:parts.length?uid():s.id,audioStart:to,candidateId:null});
    sections.push(...parts);retained.set(s.id,parts);
  }
  const alternates=[...variants];
  for(const v of project.alternates||[]){
    const old=(project.sections||[]).find(s=>s.id===v.sectionId);if(!old)continue;
    for(const s of retained.get(old.id)||[]){
      if(s===old){alternates.push(v);continue;}
      alternates.push({...v,id:s.id===old.id?v.id:uid(),sectionId:s.id,audioStart:s.audioStart,audioEnd:s.audioEnd,notes:clipped(project,v.notes,s.audioStart,s.audioEnd),...clippedLyrics(project,v,s.audioStart,s.audioEnd),diagnostics:(v.diagnostics||[]).filter(d=>d.second>=s.audioStart&&d.second<s.audioEnd)});
    }
    if(replaced.includes(old))for(const s of generated){
      const a=Math.max(old.audioStart,s.audioStart),b=Math.min(old.audioEnd,s.audioEnd);if(b<=a)continue;
      alternates.push({...v,id:uid(),sectionId:s.id,primary:false,method:'先前 · '+v.method,audioStart:a,audioEnd:b,notes:clipped(project,v.notes,a,b),...clippedLyrics(project,v,a,b),diagnostics:(v.diagnostics||[]).filter(d=>d.second>=a&&d.second<b)});
    }
  }
  return {sections:sections.sort((a,b)=>a.audioStart-b.audioStart),alternates};
}
