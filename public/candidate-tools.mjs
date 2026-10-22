import {timeAtBeat,beatAtTime} from './time-map.mjs';
import {pitchName,EDIT_STEP} from './music.mjs';
export const TRACKS=['original','vocals','other','bass','drums','instrumental','guitar','piano'];
export function signalRms(samples){let energy=0;for(const x of samples)energy+=x*x;return Math.sqrt(energy/Math.max(1,samples.length));}
// Reject only effectively inaudible residual tracks. Quiet musical stems remain eligible.
export function hasTrackContent(samples,referenceRms=0){const rms=signalRms(samples);return rms>.00005&&!(rms<.0005&&referenceRms>0&&rms<referenceRms*.005);}
export function activeFragment(project,second,fragment,origin=0){
  if(!fragment?.id)return false;
  const note=project.notes.find(n=>n.id===fragment.id);
  if(!note||note.midi===null||second<timeAtBeat(project,note.start)||second>=timeAtBeat(project,note.start+note.duration))return false;
  const beat=beatAtTime(project,second)-origin;
  return beat>=fragment.start-1e-7&&beat<fragment.start+fragment.duration-1e-7;
}
export function conflictText(issue){
  if(!['音高冲突','两个候选音高不一致'].includes(issue.kind))return issue.kind;
  const evidence=issue.pitches||[];
  return '两个候选音高不一致'+(evidence.length?'：'+evidence.map(p=>`${p.engine} ${pitchName(p.midi)}`).join(' / '):'')+(evidence.length>1&&Math.abs(evidence[0].midi-evidence[1].midi)===12?'（相差一个八度）':'');
}
export function selectedIssues(candidate,windows,from,to,source){
  const issues=candidate?.diagnostics||windows.filter(w=>w.candidateRole==='primary'&&(!source||w.source===source)).flatMap(w=>w.issues||[]);
  return [...new Map(issues.filter(x=>Number.isFinite(x.second)&&x.second>=from&&x.second<to).map(x=>[`${x.kind}-${x.second.toFixed(3)}`,x])).values()].sort((a,b)=>a.second-b.second);
}
export function preservePrimary(project,sections,variants){
  return [...variants,...sections.filter(s=>!variants.some(v=>v.sectionId===s.id&&v.primary)).map(s=>({id:`primary-${s.id}`,sectionId:s.id,source:s.source,method:'原首选',primary:true,audioStart:s.audioStart,audioEnd:s.audioEnd,notes:project.notes.filter(n=>timeAtBeat(project,n.start)<s.audioEnd&&timeAtBeat(project,n.start+n.duration)>s.audioStart).map(n=>({...n,start:Math.max(n.start,Math.round(beatAtTime(project,s.audioStart)/EDIT_STEP)*EDIT_STEP),duration:Math.max(EDIT_STEP,Math.round((Math.min(n.start+n.duration,beatAtTime(project,s.audioEnd))-Math.max(n.start,beatAtTime(project,s.audioStart)))/EDIT_STEP)*EDIT_STEP)})),lyrics:(project.lyrics||[]).filter(t=>t.start!==null&&t.start<s.audioEnd&&t.end>s.audioStart)}))];
}

export function restorableAudioProject(project,draft){return draft?.audioResources?.some(r=>r.source==='original')?draft:project;}
