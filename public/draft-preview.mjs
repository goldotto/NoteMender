import {EDIT_STEP,keyAt} from './music.mjs';
import {anchorsFor,beatAtTime,timeAtBeat} from './time-map.mjs';
import {timelineLyrics} from './lyric-score.mjs';

export function draftScoreWindow(project,from,to,title){
  const first=Math.max(0,Math.floor(beatAtTime(project,from)/EDIT_STEP+1e-6)*EDIT_STEP);
  const last=Math.max(first+EDIT_STEP,Math.ceil(beatAtTime(project,to)/EDIT_STEP-1e-6)*EDIT_STEP);
  const notes=project.notes.filter(note=>note.start<last&&note.start+note.duration>first).map(note=>{
    const start=Math.max(first,note.start),end=Math.min(last,note.start+note.duration);
    return {...note,lyric:'',start:start-first,duration:end-start,hasStart:note.start>=first,hasEnd:note.start+note.duration<=last};
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
