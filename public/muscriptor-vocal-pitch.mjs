const MAX_CORE_SECONDS=24;
const CONTEXT_SECONDS=1.5;

export function muHasPitchConflict(slot) {
  const first=slot.notes[0]?.midi;
  return slot.notes.some(note=>note.midi!==first);
}

// Keep context for F0 at crop edges. Own each frame once, including at splits.
export function muPitchWindows(slots, {from,to}) {
  const spans=[];
  for(const slot of slots){
    if(!muHasPitchConflict(slot)||slot.end<=from||slot.start>=to)continue;
    const start=Math.max(from,slot.start-.08),end=Math.min(to,slot.end+.08);
    const previous=spans.at(-1);
    if(previous&&start<=previous.end+2*CONTEXT_SECONDS)previous.end=end;
    else spans.push({start,end});
  }
  return spans.flatMap(({start,end})=>{
    const windows=[];
    for(let core=start;core<end;core+=MAX_CORE_SECONDS){
      const next=Math.min(core+MAX_CORE_SECONDS,end);
      windows.push({from:Math.max(from,core-CONTEXT_SECONDS),to:Math.min(to,next+CONTEXT_SECONDS),
        keepFrom:core,keepTo:next});
    }
    return windows;
  });
}

export function muPitchFramesBetween(frames,from,to){
  function firstAt(second){
    let low=0,high=frames.length;
    while(low<high){
      const middle=(low+high)>>1;
      if(frames[middle].second<second)low=middle+1;
      else high=middle;
    }
    return low;
  }
  return frames.slice(firstAt(from),firstAt(to));
}

export const muPitchMatches=(frame,midi)=>Number.isFinite(frame.pitch)&&Math.abs(frame.pitch-midi)<=.75;

function matched(frames,midi){
  return frames.filter(frame=>muPitchMatches(frame,midi)).length;
}

function evidenceCost(note,slot,frames,original){
  const fallback=note.eventId===original.eventId;
  if(!muHasPitchConflict(slot))return fallback?0:.2;
  const direct=muPitchFramesBetween(frames,slot.start+.006,slot.end-.006);
  const vicinity=muPitchFramesBetween(frames,Math.max(slot.start-.075,note.start+.012),Math.min(slot.end+.075,note.end-.012));
  if(!direct.length&&!vicinity.length)return fallback?0:Infinity;
  const votes=matched(direct,note.midi);
  const directRatio=direct.length?votes/direct.length:0;
  const nearVotes=matched(vicinity,note.midi);
  if(!fallback&&!votes&&!nearVotes)return Infinity;
  const nearRatio=vicinity.length?nearVotes/vicinity.length:0;
  const supported=votes>=3&&directRatio>=.6||votes>=2&&directRatio>=.65&&vicinity.length>=3&&nearRatio>=.72;
  const disagreement=direct.length>=2?(1-directRatio)*Math.min(direct.length,9)*.115:0;
  const context=vicinity.length>=3?(1-nearRatio)*.21:0;
  return disagreement+context+(fallback?0:.16)-(supported?.20:0);
}

// Compare already detected notes only. Keep non-conflicting slots and
// unsupported slots on the original path, including same-pitch retriggers.
export function guideMuVocalSlots(slots,original,frames){
  const output=original.slice();
  for(let from=0;from<slots.length;){
    if(!slots[from].notes.length){from++;continue;}
    let to=from+1;
    while(to<slots.length&&slots[to].notes.length)to++;
    if(!slots.slice(from,to).some(muHasPitchConflict)){from=to;continue;}
    let previous=[];
    for(let i=from;i<to;i++){
      const slot=slots[i];
      const choices=muHasPitchConflict(slot)?slot.notes:[original[i]];
      const row=choices.map(note=>{
        const evidence=evidenceCost(note,slot,frames,original[i]);
        let best=null,cost=previous.length?Infinity:0;
        for(const prior of previous){
          const semitones=Math.min(12,Math.abs(prior.note.midi-note.midi));
          const change=prior.note.eventId===note.eventId?0:.055+semitones*.035+(note.start<slot.start-.035?.12:0);
          const total=prior.cost+change;
          if(total<cost){cost=total;best=prior;}
        }
        return {note,cost:cost+evidence,prior:best};
      });
      previous=row;
    }
    let choice=previous.reduce((a,b)=>a.cost<=b.cost?a:b);
    for(let i=to-1;i>=from;i--){output[i]=choice.note;choice=choice.prior;}
    from=to;
  }
  return output;
}

