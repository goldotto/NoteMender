import {EDIT_STEP,snap,uid,validateProject} from './music.mjs';
import {lyricLabels,mapLyricIds} from './lyrics.mjs';

export function copyNotes(project,ids){
  const chosen=new Set(ids),notes=project.notes.filter(note=>chosen.has(note.id));
  if(!notes.length)throw Error('请先选中要复制的音符');
  const first=notes[0].start,last=Math.max(...notes.map(note=>note.start+note.duration));
  const labels=lyricLabels(project);
  return {span:last-first,notes:notes.map(({id,start,duration,midi,confidence,reviewStatus,lyric})=>({start:start-first,duration,midi,confidence,reviewStatus,lyric:lyric||((labels.get(id)||'').replaceAll('—',''))}))};
}

export function pasteNotes(project,clipboard,start,{overwrite=false}={}){
  if(!clipboard?.notes?.length)throw Error('请先复制音符');
  if(!Number.isFinite(start)||start<0||Math.abs(snap(start,EDIT_STEP)-start)>1e-6)throw Error('粘贴位置须从第 1 拍开始，以 1/16 拍递增');
  const end=start+clipboard.span;
  if(end>14400+1e-6)throw Error('粘贴范围超出工程长度');
  const overlaps=note=>note.start<end-1e-6&&note.start+note.duration>start+1e-6;
  if(!overwrite&&project.notes.some(overlaps))throw Error('目标范围已有音符；请选择空白，或明确选用“覆盖目标范围”');
  const retained=[];
  for(const note of project.notes){
    if(!overwrite||!overlaps(note)){retained.push(note);continue;}
    if(note.start<start-1e-6)retained.push({...note,duration:start-note.start});
    if(note.start+note.duration>end+1e-6)retained.push({...note,id:uid(),start:end,duration:note.start+note.duration-end,lyric:''});
  }
  const pasted=clipboard.notes.map(note=>({...note,id:uid(),start:start+note.start,reviewStatus:'reviewed'}));
  return {project:validateProject({...project,notes:[...retained,...pasted]}),ids:pasted.map(note=>note.id)};
}

export function splitNoteAt(project,id,beat){
  const note=project.notes.find(item=>item.id===id);
  if(!note)throw Error('请先选中要切割的音符');
  if(!Number.isFinite(beat)||Math.abs(snap(beat,EDIT_STEP)-beat)>1e-6||beat<note.start+EDIT_STEP-1e-6||beat>note.start+note.duration-EDIT_STEP+1e-6)throw Error('切割位置须在音符内部，两边至少各保留 1/16 拍');
  const next={...note,id:uid(),start:beat,duration:note.start+note.duration-beat,lyric:'',confidence:1,reviewStatus:'reviewed'};
  const lyrics=mapLyricIds(project.lyrics,new Map([[id,[id,next.id]]]));
  return {project:validateProject({...project,...(project.lyrics?{lyrics}:{}),notes:project.notes.flatMap(item=>item.id===id?[{...note,duration:beat-note.start,confidence:1,reviewStatus:'reviewed'},next]:[item])}),id:next.id};
}
