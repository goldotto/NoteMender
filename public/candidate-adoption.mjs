import {EDIT_STEP,snap,uid,validateProject} from './music.mjs';
import {timeAtBeat,beatAtTime} from './time-map.mjs';
import {sectionBeats,sectionSeconds} from './sections.mjs';
import {replaceSectionCandidate} from './local-candidates.mjs';
import {integratePartialCandidates} from './partial-candidates.mjs';

// A preview is rebased and clipped for display. Never use it as an edit source.
export function adoptCandidate(current,draft,sections,{mode='notes',newSong=false}={}){
  if(draft.previewOrigin!==undefined||draft.previewEnd!==undefined)throw Error('不能采用试听切片，请恢复完整候选后重试');
  if(!['notes','sections','whole'].includes(mode))throw Error('无效候选采用方式');
  if(newSong||mode==='whole')return {project:validateProject({...draft,markers:newSong?[]:current.markers}),ranges:[],replaced:current.notes.length,added:draft.notes.length};
  if(!sections.length)throw Error('候选没有有效区段，原工作区未修改');
  const source=validateProject(draft),ranges=[];
  const remap=notes=>notes.map(n=>{
    const start=Math.max(0,snap(beatAtTime(current,timeAtBeat(source,n.start)),EDIT_STEP));
    const end=snap(beatAtTime(current,timeAtBeat(source,n.start+n.duration)),EDIT_STEP);
    if(end-start<EDIT_STEP||end-start>128)throw Error('候选与当前时间映射不兼容，请调整对齐点；原工作区未修改');
    return {...n,start,duration:end-start};
  });
  let next=current,added=0;
  for(const section of sections){
    const bounds=sectionBeats(source,section),notes=source.notes.filter(n=>n.start<bounds.end&&n.start+n.duration>bounds.start);
    if(mode==='notes'&&!notes.length)continue; // An empty candidate must not silently erase a section.
    const start=mode==='notes'?Math.max(bounds.start,Math.min(...notes.map(n=>n.start))):bounds.start;
    const end=mode==='notes'?Math.min(bounds.end,Math.max(...notes.map(n=>n.start+n.duration))):bounds.end;
    const from=timeAtBeat(source,start),to=timeAtBeat(source,end);
    const target={start:Math.max(0,snap(beatAtTime(current,from),EDIT_STEP)),end:snap(beatAtTime(current,to),EDIT_STEP)};
    if(target.end<=target.start)throw Error('采用范围太短，原工作区未修改');
    const incoming=remap(notes.map(n=>({...n,start:Math.max(start,n.start),duration:Math.min(end,n.start+n.duration)-Math.max(start,n.start)})));
    const ids=new Set(incoming.map(n=>n.id));
    const lyrics=(source.lyrics||[]).filter(t=>t.noteIds.some(id=>ids.has(id))||t.start!==null&&t.start<to&&t.end>from);
    next=replaceSectionCandidate(next,target,{notes:incoming,lyrics});
    // Keep text even when replacement invalidates its old note association.
    next=validateProject({...next,lyrics:[...(next.lyrics||[]),...(current.lyrics||[]).filter(t=>!next.lyrics?.some(m=>m.id===t.id))]});
    const full=sectionSeconds(source,section),markerStart=Math.max(full.from,Math.min(from,full.to-.25)),marker={...section,id:uid(),audioStart:markerStart,audioEnd:Math.min(full.to,Math.max(to,markerStart+.25))};
    if(marker.audioEnd-marker.audioStart>=.25-1e-6){
      const variants=(source.alternates||[]).filter(v=>v.sectionId===section.id).map(v=>({...v,sectionId:marker.id,notes:remap(v.notes)}));
      const combined=integratePartialCandidates(next,[marker],variants,marker.audioStart,marker.audioEnd);
      next=validateProject({...next,...combined});
    }
    ranges.push({...target,from,to});added+=incoming.length;
  }
  if(!ranges.length)throw Error('所选候选没有音符，原工作区未修改；如需清空区段请明确选择完整识别区段');
  const resources=new Map([...(current.audioResources||[]),...(source.audioResources||[])].map(r=>[`${r.source}:${r.audioStart}:${r.audioEnd}:${r.id}`,r]));
  next=validateProject({...next,audioResources:[...resources.values()]});
  return {project:next,ranges,added,replaced:current.notes.filter(n=>ranges.some(r=>n.start<r.end&&n.start+n.duration>r.start)).length};
}
