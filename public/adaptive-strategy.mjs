import {EDIT_STEP,clamp,snap} from './music.mjs';
import {timeAtBeat,beatAtTime} from './time-map.mjs';

export const ANALYSIS_MODES=['auto','vocal','solo','dense'];
export const modeName={auto:'自动',vocal:'人声',solo:'单音器乐',dense:'密集器乐'};

// Keep the musical sections intact; only the analysis jobs use short windows.
export function analysisWindows(spans,seconds=8){
  return spans.flatMap((span,sectionIndex)=>{
    const count=Math.max(1,Math.round((span.to-span.from)/seconds));
    return Array.from({length:count},(_,i)=>({...span,sectionIndex,from:span.from+i*(span.to-span.from)/count,to:span.from+(i+1)*(span.to-span.from)/count}));
  });
}

export function mergeAnalysisUsed(windows){
  const out=[];
  for(const w of windows){const last=out.at(-1);if(last&&last.mode===w.mode&&last.source===w.source&&Math.abs(last.to-w.from)<.002){last.to=w.to;last.flags=[...new Set([...last.flags,...w.flags])];}else out.push({...w,flags:[...w.flags]});}
  return out;
}

export function stitchNotes(events){
  const out=[];
  for(const n of [...events].sort((a,b)=>a.start-b.start||a.end-b.end)){
    const last=out.at(-1);
    if(last&&last.midi===n.midi&&n.start-last.end>=-.04&&n.start-last.end<=.08){last.end=Math.max(last.end,n.end);last.confidence=Math.min(last.confidence,n.confidence??.4);last.reviewFlags=[...new Set([...(last.reviewFlags||[]),...(n.reviewFlags||[])])];}
    else out.push({...n});
  }
  return out;
}

const overlap=(a,b)=>Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
const duration=n=>Math.max(0,n.end-n.start);
function voicedLength(notes){return notes.reduce((sum,n)=>sum+duration(n),0);}
function polyphonyRatio(notes,windowSeconds){
  const edges=notes.flatMap(n=>[[n.start,1],[n.end,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let active=0,last=0,total=0;
  for(const [time,delta] of edges){if(active>1)total+=Math.max(0,time-last);active+=delta;last=time;}
  return total/Math.max(.01,windowSeconds);
}
export function chooseAnalysisMode({requested='auto',source='original',basic=[],mono=[],windowSeconds=8}){
  if(requested!=='auto')return requested;
  if(source==='vocals')return 'vocal';
  const voiced=voicedLength(mono)/Math.max(.01,windowSeconds),polyphony=polyphonyRatio(basic,windowSeconds);
  return voiced>=.45&&polyphony<.18?'solo':'dense';
}

function energy(samples,start,end,sr){
  let sum=0,count=0;
  for(let i=Math.max(0,Math.floor(start*sr));i<Math.min(samples.length,Math.ceil(end*sr));i+=16){sum+=samples[i]*samples[i];count++;}
  return Math.sqrt(sum/Math.max(1,count));
}
export function reviewIssues(notes,samples,sr=22050){
  const issues=notes.filter(n=>n.reviewFlags?.includes('音高冲突')).map(n=>({second:n.start,end:n.end,kind:'音高冲突',pitches:n.pitchConflict||[]}));
  const seconds=samples.length/sr,mean=energy(samples,0,seconds,sr),floor=Math.max(.018,mean*.5),step=.1;
  let gapStart=null;
  for(let t=0;t<=seconds+.0001;t+=step){
    const active=t<seconds&&energy(samples,t,Math.min(seconds,t+step),sr)>=floor&&!notes.some(n=>n.start<t+step&&n.end>t);
    if(active&&gapStart===null)gapStart=t;
    if(!active&&gapStart!==null){if(t-gapStart>=.4)issues.push({second:gapStart,kind:'疑似漏音'});gapStart=null;}
  }
  return issues.slice(0,12);
}

function continuity(notes,index,midi){
  const before=notes[index-1],after=notes[index+1];
  const distances=[before,after].filter(Boolean).map(n=>Math.min(24,Math.abs(n.midi-midi)));
  return distances.length?1-distances.reduce((a,b)=>a+b,0)/(24*distances.length):.5;
}

// Disagreement is review evidence, not grounds for silently erasing a note.
export function fuseVocalCandidates(basic,mono,samples,sr=22050){
  const mean=energy(samples,0,samples.length/sr,sr),floor=Math.max(.006,mean*.06);
  const kept=basic.filter(n=>energy(samples,n.start,n.end,sr)>=floor).map((n,i)=>{
    const same=mono.reduce((sum,p)=>sum+(p.midi===n.midi?overlap(n,p):0),0)/Math.max(.001,duration(n));
    const nearest=mono.filter(p=>overlap(n,p)>duration(n)*.25).sort((a,b)=>overlap(n,b)-overlap(n,a))[0];
    const conflict=nearest&&nearest.midi!==n.midi&&same<.25;
    const acoustic=clamp(energy(samples,n.start,n.end,sr)/Math.max(mean,.006),0,1);
    const score=.4*clamp(n.confidence??.4,0,1)+.25*acoustic+.2*continuity(basic,i,n.midi)+.15*Math.min(1,same);
    return {...n,confidence:conflict?Math.min(.45,score):clamp(score,0,.9),reviewFlags:conflict?['音高冲突']:[],...(conflict?{pitchConflict:[{engine:'Basic Pitch',midi:n.midi},{engine:'Pitchy',midi:nearest.midi}]}:{})};
  });
  const additions=[];
  for(const n of mono){
    if((n.confidence??0)<.75||duration(n)<.08)continue;
    let parts=[[n.start,n.end]];
    for(const b of kept){parts=parts.flatMap(([from,to])=>b.end<=from||b.start>=to?[[from,to]]:[[from,Math.min(to,b.start)],[Math.max(from,b.end),to]].filter(([a,z])=>z-a>=.08));}
    for(const [start,end] of parts)if(end-start>=.08&&energy(samples,start,end,sr)>=floor)additions.push({...n,start,end,confidence:Math.min(.48,n.confidence*.55),reviewFlags:['补充候选']});
  }
  return [...kept,...additions].sort((a,b)=>a.start-b.start);
}

// Dynamic path over event boundaries avoids choosing each loud chord tone independently.
export function traceDenseMelody(notes,{minMidi=45,maxMidi=88}={}){
  const candidates=notes.filter(n=>n.midi>=minMidi&&n.midi<=maxMidi&&duration(n)>=.07);
  if(!candidates.length)return [];
  const times=[...new Set(candidates.flatMap(n=>[n.start,n.end]))].sort((a,b)=>a-b),frames=[];
  for(let i=0;i<times.length-1;i++){
    const from=times[i],to=times[i+1],active=candidates.filter(n=>n.start<=from+.00001&&n.end>=to-.00001);
    if(to-from<.005)continue;
    frames.push({from,to,active});
  }
  if(!frames.length)return [];
  let prev=new Map([[null,{score:0,path:[]}]]);
  for(const frame of frames){
    const next=new Map(),choices=[null,...frame.active];
    for(const choice of choices){
      let best=null;
      for(const [last,state] of prev){
        const jump=last&&choice?Math.abs(last.midi-choice.midi):0;
        const transition=last&&choice?-.035*Math.min(jump,24)-(jump>=12?.25:0):choice?.05:0;
        const local=choice?(.15+.55*clamp(choice.confidence??.4,0,1))*Math.min(.3,frame.to-frame.from)/.1:-.08;
        const score=state.score+transition+local;
        if(!best||score>best.score)best={score,path:[...state.path,choice]};
      }
      next.set(choice,best);
    }
    prev=next;
  }
  const path=[...prev.values()].sort((a,b)=>b.score-a.score)[0].path,out=[];
  for(let i=0;i<path.length;i++){
    const n=path[i];if(!n)continue;const frame=frames[i],last=out.at(-1);
    if(last&&last.midi===n.midi&&frame.from-last.end<.006){last.end=frame.to;last.confidence=Math.min(last.confidence,n.confidence??.4);}
    else out.push({start:frame.from,end:frame.to,midi:n.midi,confidence:Math.min(n.confidence??.4,frame.active.length>1?.55:.8),reviewFlags:frame.active.length>1?['多音竞争']:[]});
  }
  return out.filter(n=>duration(n)>=.07);
}

export function chooseDenseCandidate(traced,greedy,seconds){
  const sparse=traced.length<greedy.length*.7&&greedy.length<=seconds*4;
  return {notes:sparse?greedy:traced,sparse};
}

export function chooseQuantization(raw,project,usualStep){
  if(!raw.length)return {step:usualStep,lateRatio:0};
  let late=0,total=0;
  for(const n of raw)for(const second of [n.start,n.end]){
    const snapped=snap(beatAtTime(project,second),usualStep),error=Math.abs(timeAtBeat(project,snapped)-second);
    if(error>.05)late++;total++;
  }
  return {step:late/total>.2?EDIT_STEP:usualStep,lateRatio:late/total};
}
