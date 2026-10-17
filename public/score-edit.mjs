import {EDIT_STEP,snap,uid,validateProject} from './music.mjs';
import {timeAtBeat,beatAtTime} from './time-map.mjs';
import {mapLyricIds} from './lyrics.mjs';

export function pointerBeat(x,y,{starts,ys,left,zoom},grab=0){
  const row=Math.max(0,Math.min(starts.length-2,ys.findLastIndex(v=>y>=v-27)));
  return Math.max(0,snap(starts[row]+Math.max(0,Math.min(starts[row+1]-starts[row],(x-left)/zoom))-grab,EDIT_STEP));
}
const overlaps=(a,b)=>a.start<b.start+b.duration-1e-6&&a.start+a.duration>b.start+1e-6;
// Keep notes in beat space and words in original-audio seconds, without stretching.
// Collision confirmation is handled by placeMovedNotes after this atomic preview.
export function moveScoreSelection(project,group,{from,to,maxSeconds=3600}){
  if(!Number.isFinite(from)||!Number.isFinite(to))throw Error('请输入有效的移动拍位');
  const beats=snap(to-from,EDIT_STEP),seconds=timeAtBeat(project,from+beats)-timeAtBeat(project,from);
  const notes=project.notes.map(n=>{
    if(!group.noteIds.has(n.id))return n;
    const start=snap(n.start+beats,EDIT_STEP),end=start+n.duration;
    if(start<0||end>14400||timeAtBeat(project,end)>Math.max(maxSeconds,timeAtBeat(project,n.start+n.duration))+1e-6)throw Error('整组移动超出原音或拍位范围，未修改');
    return {...n,start,lyric:'',reviewStatus:'reviewed'};
  });
  const lyrics=(project.lyrics||[]).map(t=>{
    if(!group.lyricIds.has(t.id))return t;
    if(!Number.isFinite(t.start)||!Number.isFinite(t.end))throw Error('先给所选歌词定位，再移动整组');
    const start=t.start+seconds,end=t.end+seconds;
    if(start<0||end>Math.max(maxSeconds,t.end)+1e-6)throw Error('整组移动超出原音或拍位范围，未修改');
    return {...t,start,end,reviewed:true};
  });
  return {...project,notes,lyrics};
}
export function placeMovedNotes(project,moving,{overwrite=false,idFactory=uid}={}){
  const ids=new Set(moving.map(n=>n.id)),others=project.notes.filter(n=>!ids.has(n.id));
  const collisions=others.filter(n=>moving.some(m=>overlaps(n,m)));
  if(collisions.length&&!overwrite)return {collisions,project:null};
  const remap=new Map(),retained=[];
  for(const note of others){
    let pieces=[{start:note.start,end:note.start+note.duration}];
    for(const m of moving)pieces=pieces.flatMap(p=>p.start>=m.start+m.duration-1e-6||p.end<=m.start+1e-6?[p]:[{start:p.start,end:Math.min(p.end,m.start)},{start:Math.max(p.start,m.start+m.duration),end:p.end}].filter(p=>p.end-p.start>=EDIT_STEP-1e-6));
    const fragments=pieces.map((p,i)=>({...note,id:i===0?note.id:idFactory(),start:p.start,duration:p.end-p.start,lyric:i===0?note.lyric:''}));
    retained.push(...fragments);remap.set(note.id,fragments.map(n=>n.id));
  }
  const lyrics=mapLyricIds(project.lyrics,remap);
  return {collisions,project:validateProject({...project,...(lyrics?{lyrics}:{}),notes:[...retained,...moving]})};
}
export function copyScoreSelection(project,noteIds,lyricIds){
  const notes=project.notes.filter(n=>noteIds.has(n.id)),lyrics=(project.lyrics||[]).filter(t=>lyricIds.has(t.id));
  if(!notes.length&&!lyrics.length)throw Error('先选择音符或歌词');
  if(lyrics.some(t=>!Number.isFinite(t.start)||!Number.isFinite(t.end)))throw Error('先给所选歌词定位');
  const beat=Math.min(...notes.map(n=>n.start),...lyrics.map(t=>beatAtTime(project,t.start))),second=timeAtBeat(project,beat);
  return {kind:'mixed',notes:notes.map(n=>({...n,start:n.start-beat})),lyrics:lyrics.map(t=>({...t,start:t.start-second,end:t.end-second,noteIds:t.noteIds.filter(id=>noteIds.has(id))}))};
}
export function pasteScoreSelection(project,clipboard,start,{overwriteNotes=false,overwriteLyrics=false,maxSeconds=3600,idFactory=uid}={}){
  if(!clipboard||clipboard.kind!=='mixed')throw Error('先复制音符与歌词');
  if(!Number.isFinite(start)||start<0||Math.abs(snap(start,EDIT_STEP)-start)>1e-6)throw Error('粘贴位置须对齐到 1/16 拍');
  const noteMap=new Map(),second=timeAtBeat(project,start);
  const moving=clipboard.notes.map(n=>{const id=idFactory();noteMap.set(n.id,id);return {...n,id,start:start+n.start,lyric:'',reviewStatus:'reviewed'};});
  const fresh=clipboard.lyrics.map(t=>({...t,id:idFactory(),start:second+t.start,end:second+t.end,noteIds:t.noteIds.map(id=>noteMap.get(id)).filter(Boolean),source:'manual',reviewed:true,evidenceIds:[],alignmentIssue:''}));
  if(fresh.some(t=>t.start<0||t.end>maxSeconds+1e-6))throw Error('歌词粘贴范围超出原音');
  const target=placeMovedNotes(project,moving,{overwrite:overwriteNotes,idFactory});
  if(!target.project)throw Error('目标已有音符；请启用“覆盖目标范围”');
  const collisions=(target.project.lyrics||[]).filter(t=>Number.isFinite(t.start)&&fresh.some(f=>t.start<f.end-1e-6&&t.end>f.start+1e-6));
  if(collisions.length&&!overwriteLyrics)throw Error('目标已有歌词；请启用“覆盖目标歌词”');
  return {project:validateProject({...target.project,lyrics:[...(target.project.lyrics||[]).filter(t=>!collisions.includes(t)),...fresh]}),noteIds:moving.map(n=>n.id),lyricIds:fresh.map(t=>t.id)};
}
