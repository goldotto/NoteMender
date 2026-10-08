import {EDIT_STEP,snap,validateProject} from './music.mjs';
import {timeAtBeat,beatAtTime} from './time-map.mjs';
import {timelineLyrics} from './lyric-score.mjs';

export function associatedGroup(project,{noteIds=[],lyricIds=[]}={}){
  const notes=new Map(project.notes.filter(n=>n.midi!==null).map(n=>[n.id,n]));
  const tokens=timelineLyrics(project),lyrics=new Map(tokens.map(t=>[t.id,t])),byNote=new Map();
  for(const t of tokens)for(const id of t.noteIds){if(!byNote.has(id))byNote.set(id,[]);byNote.get(id).push(t.id);}
  const ns=new Set(),ls=new Set(),queue=[...noteIds.map(id=>['note',id]),...lyricIds.map(id=>['lyric',id])];
  for(let i=0;i<queue.length;i++){
    const [kind,id]=queue[i];
    if(kind==='note'){if(ns.has(id)||!notes.has(id))continue;ns.add(id);for(const word of byNote.get(id)||[])queue.push(['lyric',word]);}
    else{if(ls.has(id)||!lyrics.has(id))continue;ls.add(id);for(const note of lyrics.get(id).noteIds)queue.push(['note',note]);}
  }
  return {noteIds:ns,lyricIds:ls,notes:[...ns].map(id=>notes.get(id)),lyrics:[...ls].map(id=>lyrics.get(id))};
}
function transformGroup(project,group,map,{maxSeconds=3600,seconds=0}={}){
  const notes=project.notes.map(n=>{
    if(!group.noteIds.has(n.id))return n;
    const start=snap(map(n.start),EDIT_STEP),end=start+n.duration;
    // A generated boundary may already lie just beyond the audio after quantization.
    // Allow it to remain or move inward; reject only a new/worsened overrun.
    const limit=Math.max(maxSeconds,timeAtBeat(project,n.start+n.duration));
    if(start<0||end>14400||timeAtBeat(project,end)>limit+1e-6)throw Error('联动移动超出原音范围，整组未修改。');
    return {...n,start,lyric:'',reviewStatus:'reviewed'};
  });
  const updates=new Map(group.lyrics.map(t=>{
    if(!Number.isFinite(t.beatStart)||!Number.isFinite(t.beatEnd))throw Error('对应组中有未定位文字，请先给歌词定位。');
    const start=(t.start??timeAtBeat(project,t.beatStart))+seconds,end=(t.end??timeAtBeat(project,t.beatEnd))+seconds;
    if(start<0||end<=start||end>Math.max(maxSeconds,t.end??timeAtBeat(project,t.beatEnd))+1e-6)throw Error('联动移动超出原音范围，整组未修改。');
    return [t.id,{...t,start,end,source:t.legacyNoteId?'manual':t.source,reviewed:true}];
  }));
  const lyrics=(project.lyrics||[]).map(t=>updates.get(t.id)||t),existing=new Set(lyrics.map(t=>t.id));
  for(const [id,t] of updates)if(!existing.has(id))lyrics.push(t);
  try{return validateProject({...project,notes,lyrics});}
  catch(error){throw Error('联动编辑未应用：'+error.message);}
}
export function retimeAssociated(project,{kind,id,start,end,group=null,maxSeconds=3600}){
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('请输入有效的联动起止拍位。');
  group ||= associatedGroup(project,kind==='note'?{noteIds:[id]}:{lyricIds:[id]});
  const source=kind==='note'?project.notes.find(n=>n.id===id):group.lyrics.find(t=>t.id===id);
  if(!source)throw Error('未找到要联动的音符或歌词。');
  const from=kind==='note'?source.start:source.beatStart,to=kind==='note'?source.start+source.duration:source.beatEnd;
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw Error('请先给文字定位。');
  const seconds=timeAtBeat(project,start)-timeAtBeat(project,from);
  const map=kind==='note'?beat=>beat+start-from:beat=>beatAtTime(project,timeAtBeat(project,beat)+seconds);
  return {project:transformGroup(project,group,map,{maxSeconds,seconds}),group};
}
export function moveAssociatedLyrics(project,ids,seconds,{maxSeconds=3600}={}){
  if(!Number.isFinite(seconds))throw Error('请输入有效移动秒数。');
  const group=associatedGroup(project,{lyricIds:[...ids]});
  if(!group.lyricIds.size)throw Error('先选择要移动的歌词。');
  return {project:transformGroup(project,group,beat=>beatAtTime(project,timeAtBeat(project,beat)+seconds),{maxSeconds,seconds}),group};
}
