import {validateProject} from './music.mjs';
import {timeAtBeat} from './time-map.mjs';
import {mapLyricIds} from './lyrics.mjs';

// Duration filters are navigation aids, not assertions that a note is wrong.
export function durationReviewNotes(project,{shortSeconds=.08,longSeconds=1,kind='all'}={}){
  if(!Number.isFinite(shortSeconds)||!Number.isFinite(longSeconds)||shortSeconds<=0||longSeconds<=shortSeconds)throw Error('短音秒数须大于 0，长音秒数须大于短音');
  return project.notes.filter(n=>n.midi!==null).flatMap(n=>{
    const seconds=timeAtBeat(project,n.start+n.duration)-timeAtBeat(project,n.start);
    const type=seconds<shortSeconds?'short':seconds>longSeconds?'long':null;
    return type&&(kind==='all'||kind===type)?[{id:n.id,start:n.start,seconds,type}]:[];
  });
}

// A user explicitly selects the notes and chooses whether to fill their gaps.
// Unselected notes, score timing, audio mapping and alternatives are preserved.
export function mergeSelectedNotes(project,ids,{fillGaps=false,midi}={}){
  const chosen=new Set(ids),notes=project.notes.filter(n=>chosen.has(n.id));
  if(notes.length!==chosen.size||notes.length<2)throw Error('请至少选择两个现有音符');
  const first=notes[0],last=notes.at(-1),from=project.notes.indexOf(first),to=project.notes.indexOf(last);
  if(to-from+1!==notes.length)throw Error('所选范围中有未选中的音符，请连续选择要合并的音符');
  if(midi===undefined&&notes.some(n=>n.midi!==first.midi))throw Error('不同音高，请选择合并后的音高');
  const target=midi===undefined?first.midi:midi;
  if(target!==null&&(!Number.isInteger(target)||target<21||target>108))throw Error('请选择有效音高');
  const gaps=notes.slice(1).filter((n,i)=>n.start-notes[i].start-notes[i].duration>1e-6);
  if(gaps.length&&!fillGaps)throw Error('音符之间有空拍；如需一并拉长，请勾选“填入所选音之间的空拍”');
  const end=last.start+last.duration;
  if(end-first.start>128)throw Error('合并后的时值超过 128 拍，请分次合并');
  const merged={...first,midi:target,duration:end-first.start,lyric:notes.map(n=>n.lyric||'').join(''),confidence:1,reviewStatus:'reviewed',reviewFlags:[]};
  if(merged.lyric.length>40)throw Error('合并后的注记超过 40 字，请先精简注记');
  const lyrics=mapLyricIds(project.lyrics,new Map(notes.map(n=>[n.id,[first.id]])));
  return {project:validateProject({...project,...(project.lyrics?{lyrics}:{}),notes:project.notes.flatMap(n=>n.id===first.id?[merged]:chosen.has(n.id)?[]:[n])}),id:first.id,count:notes.length,gapCount:gaps.length};
}

// Explicit editor operation, not a rule in the recognition pipeline.
export function shortSamePitchRuns(project,shortSeconds=.08){
  if(!Number.isFinite(shortSeconds)||shortSeconds<=0)throw Error('请输入大于0的短音秒数');
  const groups=[];let run=[];
  const flush=()=>{if(run.length>1)groups.push(run.map(n=>n.id));run=[];};
  for(const n of project.notes){const seconds=timeAtBeat(project,n.start+n.duration)-timeAtBeat(project,n.start),previous=run.at(-1);
    if(n.midi===null||seconds>=shortSeconds){flush();continue;}
    if(previous&&(previous.midi!==n.midi||Math.abs(n.start-previous.start-previous.duration)>1e-6||n.start+n.duration-run[0].start>128))flush();
    run.push(n);
  }flush();return groups;
}
export function mergeShortSamePitchRuns(project,shortSeconds=.08){
  const groups=shortSamePitchRuns(project,shortSeconds);let next=project;
  for(const ids of [...groups].reverse())next=mergeSelectedNotes(next,ids).project;
  return {project:next,groups:groups.length,removed:groups.reduce((sum,g)=>sum+g.length-1,0)};
}
