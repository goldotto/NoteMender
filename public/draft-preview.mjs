import {EDIT_STEP,keyAt} from './music.mjs';
import {anchorsFor,beatAtTime,timeAtBeat} from './time-map.mjs';
import {timelineLyrics} from './lyric-score.mjs';

const PAGE_SECONDS=20;

export function draftPage(range,page=0){
  const count=Math.max(1,Math.ceil((range.to-range.from)/PAGE_SECONDS-1e-9));
  const index=Math.max(0,Math.min(count-1,Math.trunc(page)));
  const from=range.from+index*PAGE_SECONDS;
  return {index,count,from,to:Math.min(range.to,from+PAGE_SECONDS)};
}

export function draftPageAt(range,second){
  return draftPage(range,Math.floor((second-range.from)/PAGE_SECONDS)).index;
}

// Change notation throughout a candidate, never transpose its absolute pitches.
export function candidateNotationKey(project,key){
  if(!Number.isInteger(key)||key<0||key>11)throw Error('请选择有效的记谱调号');
  return {...project,key,keyChanges:[]};
}

export function draftNotePosition(project,id,{from,to}){
  const note=project.notes.find(n=>n.id===id);if(!note)return null;
  const start=timeAtBeat(project,note.start),end=timeAtBeat(project,note.start+note.duration);
  if(end<=from||start>=to)return null;
  return Math.max(from,start);
}

export function draftScoreWindow(project,from,to,title){
  const startBeat=beatAtTime(project,from),endBeat=beatAtTime(project,to);
  const first=Math.max(0,Math.floor(startBeat/EDIT_STEP+1e-6)*EDIT_STEP);
  const last=Math.max(first+EDIT_STEP,Math.ceil(endBeat/EDIT_STEP-1e-6)*EDIT_STEP);
  const notes=project.notes.filter(note=>note.start<endBeat-1e-8&&note.start+note.duration>startBeat+1e-8).map(note=>{
    const start=Math.max(first,note.start),end=Math.min(last,note.start+note.duration);
    return {...note,lyric:'',start:start-first,duration:end-start,hasStart:note.start>=startBeat-1e-8,hasEnd:note.start+note.duration<=endBeat+1e-8};
  });
  // Notes become local beats, while lyric timestamps stay in original audio
  // seconds. Slice both together and rebase the map used by the renderer.
  const ids=new Set(notes.map(note=>note.id));
  const lyrics=timelineLyrics(project).filter(t=>t.beatStart!==null&&t.beatStart<last&&t.beatEnd>first).map(t=>({
    ...t,start:timeAtBeat(project,Math.max(first,t.beatStart)),end:timeAtBeat(project,Math.min(last,t.beatEnd)),
    noteIds:t.noteIds.filter(id=>ids.has(id)),hasStart:t.beatStart>=first
  }));
  const timeAnchors=[{beat:0,second:timeAtBeat(project,first)},
    ...anchorsFor(project).filter(a=>a.beat>first&&a.beat<last).map(a=>({...a,beat:a.beat-first})),
    {beat:last-first,second:timeAtBeat(project,last)}];
  const keyChanges=(project.keyChanges||[]).filter(change=>change.beat>first&&change.beat<last).map(change=>({...change,beat:change.beat-first}));
  return {...project,previewOrigin:first,previewEnd:last-first,title,key:keyAt(project,first),keyChanges,layout:'free',offset:timeAnchors[0].second,timeAnchors,notes,lyrics};
}
