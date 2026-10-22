import {beatAtTime,timeAtBeat} from './time-map.mjs';
import {matchLyrics} from './lyrics.mjs';
export function timelineLyrics(project){
  const tokens=[...(project.lyrics||[])],manual=new Set(tokens.filter(t=>t.reviewed).flatMap(t=>t.noteIds));
  for(const n of project.notes)if(n.lyric&&!manual.has(n.id))tokens.push({id:'legacy-'+n.id,text:n.lyric,start:Math.max(0,timeAtBeat(project,n.start)),end:Math.max(.02,timeAtBeat(project,n.start+n.duration)),noteIds:[n.id],reviewed:true,source:'legacy',language:'zh',legacyNoteId:n.id});
  return tokens.map(t=>{const linked=project.notes.filter(n=>t.noteIds.includes(n.id));let a=t.start,b=t.end;
    if(a===null&&linked.length){a=timeAtBeat(project,linked[0].start);b=timeAtBeat(project,Math.max(...linked.map(n=>n.start+n.duration)));}
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return {...t,beatStart:null,beatEnd:null};
    return {...t,beatStart:Math.max(0,beatAtTime(project,a)),beatEnd:Math.max(0,beatAtTime(project,b))};
  });
}
export function lyricRows(project,rowStarts,{rowTop=88,rowHeight=68}={}){
  const tokens=timelineLyrics(project),rows=[];let y=rowTop;
  for(let i=0;i<rowStarts.length-1;i++){
    const from=rowStarts[i],to=rowStarts[i+1],segments=tokens.filter(t=>t.beatStart!==null&&t.beatStart<to&&t.beatEnd>from).map(t=>({...t,from:Math.max(from,t.beatStart),to:Math.min(to,t.beatEnd)})).sort((a,b)=>a.from-b.from||a.to-b.to),ends=[];
    for(const s of segments){let lane=ends.findIndex(end=>end<=s.from+1e-6);if(lane<0)lane=ends.length;s.lane=lane;ends[lane]=s.to;}
    const height=rowHeight+ends.length*24;rows.push({from,to,y,height,segments});y+=height;
  }return rows;
}
export function retimeLyric(project,token,start,end,{maxSeconds=3600}={}){
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.02-1e-6||end>maxSeconds+.001)throw Error('歌词起止须在原音内，最短0.02秒');
  const changed={...token,start:+start.toFixed(4),end:+end.toFixed(4),reviewed:true};
  const notes=project.notes.map(n=>({...n,lyric:''}));const [matched]=matchLyrics({...project,notes,lyrics:[]},[changed],{preserve:false});return {...matched,reviewed:true};
}
