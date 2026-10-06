import {EDIT_STEP,snap,uid,validateProject} from './music.mjs';
import {beatAtTime,timeAtBeat} from './time-map.mjs';
import {timelineLyrics} from './lyric-score.mjs';

const overlap=(a,b,c,d)=>Math.max(0,Math.min(b,d)-Math.max(a,c));
// This is an explicit editor operation, not a transcription or pitch estimate.
export function splitNotesByLyrics(project,ids){
  const chosen=new Set(ids),targets=project.notes.filter(n=>chosen.has(n.id)&&n.midi!==null);
  if(!targets.length)throw Error('请先点击要切分的长音；Ctrl 点击或框选可选择多个音符。');
  const tokens=timelineLyrics(project).filter(t=>!t.legacyNoteId||chosen.has(t.legacyNoteId));
  const replacements=new Map(),owners=new Map(),segments=[],warnings=[];
  let skippedBoundaries=0,unchangedNotes=0;
  for(const note of targets){
    const from=timeAtBeat(project,note.start),to=timeAtBeat(project,note.start+note.duration);
    const words=tokens.filter(t=>t.text.trim()&&Number.isFinite(t.start)&&Number.isFinite(t.end)&&overlap(from,to,t.start,t.end)>1e-6).sort((a,b)=>a.start-b.start||a.end-b.end);
    const cuts=[];
    for(let i=1;i<words.length;i++){
      const raw=beatAtTime(project,words[i].start),cut=snap(raw,EDIT_STEP),previous=cuts.at(-1)??note.start;
      if(raw<=note.start+1e-6||raw>=note.start+note.duration-1e-6)continue;
      if(words[i].start<=words[i-1].start+1e-6||cut<previous+EDIT_STEP-1e-6||cut>note.start+note.duration-EDIT_STEP+1e-6){skippedBoundaries++;continue;}
      cuts.push(cut);
    }
    if(!cuts.length){unchangedNotes++;continue;}
    const bounds=[note.start,...cuts,note.start+note.duration];
    const pieces=bounds.slice(0,-1).map((start,i)=>({...note,id:i?uid():note.id,start,duration:bounds[i+1]-start,lyric:'',reviewStatus:'pending'}));
    replacements.set(note.id,pieces);
    for(const piece of pieces){
      const a=timeAtBeat(project,piece.start),b=timeAtBeat(project,piece.start+piece.duration);
      const ranked=words.map(t=>({token:t,amount:overlap(a,b,t.start,t.end)})).filter(x=>x.amount>1e-6).sort((x,y)=>y.amount-x.amount||x.token.start-y.token.start);
      const owner=ranked[0]?.token;
      if(owner){if(!owners.has(owner.id))owners.set(owner.id,[]);owners.get(owner.id).push(piece.id);}
      segments.push({...piece,from:a,to:b,text:owner?.text||'未对应'});
    }
  }
  if(!replacements.size)throw Error('所选音符内没有可切分的歌词边界。请先采用带独立时间的字词歌词，或调整歌词条的位置；单条整句文字不能自动推算字的时间。');
  const changed=new Set(replacements.keys());
  const lyrics=tokens.map(t=>{
    const retained=t.noteIds.filter(id=>!changed.has(id));
    const linked=owners.get(t.id)||[];
    // An unlocated annotation cannot determine cuts; retain its continuation links.
    if(t.start===null)for(const id of t.noteIds)if(changed.has(id))linked.push(...replacements.get(id).map(n=>n.id));
    return {...t,noteIds:[...new Set([...retained,...linked])]};
  });
  const notes=project.notes.flatMap(n=>replacements.get(n.id)||[n]);
  const next=validateProject({...project,notes,lyrics});
  if(skippedBoundaries)warnings.push(`${skippedBoundaries} 处边界过近或时间相同，未强行切成小于 1/16 拍的碎音；文字保留，可继续手改。`);
  if(unchangedNotes)warnings.push(`${unchangedNotes} 个所选音符没有可用内部边界，保持原样。`);
  return {project:next,ids:segments.map(n=>n.id),segments,splitCount:replacements.size,addedCount:segments.length-replacements.size,warnings};
}
