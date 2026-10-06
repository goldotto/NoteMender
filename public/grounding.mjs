// Agreement is a consistency check between imperfect methods, never accuracy.
export function guardMelody(reference,proposal){
  const overlap=(a,b)=>Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
  if(!reference.length)return {notes:proposal.map(n=>({...n,confidence:Math.min(n.confidence??.3,.3)})),status:'no-reference',agreement:null,coverage:null};
  const matched=proposal.map(n=>reference.reduce((s,r)=>s+(r.midi===n.midi?overlap(n,r):0),0));
  const proposalDuration=proposal.reduce((s,n)=>s+n.end-n.start,0),referenceDuration=reference.reduce((s,n)=>s+n.end-n.start,0),shared=matched.reduce((a,b)=>a+b,0);
  const agreement=proposalDuration?shared/proposalDuration:0,coverage=shared/referenceDuration;
  const supported=proposal.every((n,i)=>matched[i]/(n.end-n.start)>=.55);
  const accept=agreement>=.75&&coverage>=.75&&supported;
  return {notes:(accept?proposal:reference).map(n=>({...n,confidence:Math.min(n.confidence??.4,accept?.65:.45)})),status:accept?'consistent':'reference-retained',agreement,coverage};
}
export function referenceClip(notes,clip){return notes.filter(n=>n.end>clip.from&&n.start<clip.to).map(n=>({...n,start:Math.max(0,n.start-clip.from),end:Math.min(clip.to-clip.from,n.end-clip.from)}));}

export function acousticReference(notes,monophonic,samples,sr=22050){
  let total=0;for(let i=0;i<samples.length;i+=8)total+=samples[i]*samples[i];
  const floor=Math.max(.006,Math.sqrt(total/Math.ceil(samples.length/8))*.06),out=[];
  for(const n of notes){
    let energy=0,count=0;for(let i=Math.max(0,Math.floor(n.start*sr));i<Math.min(samples.length,Math.floor(n.end*sr));i+=8){energy+=samples[i]*samples[i];count++;}
    const rms=Math.sqrt(energy/Math.max(1,count));if(rms<floor)continue;
    const support=monophonic.reduce((s,p)=>s+(p.midi===n.midi?Math.max(0,Math.min(p.end,n.end)-Math.max(p.start,n.start)):0),0)/(n.end-n.start);
    if(support<.25&&!(n.confidence>=.7&&rms>.025))continue;
    const last=out.at(-1),sustained=last&&monophonic.some(p=>p.midi===n.midi&&p.start<last.end-.02&&p.end>n.start+.02);
    if(last&&last.midi===n.midi&&n.start-last.end>=0&&n.start-last.end<.035&&sustained){last.end=n.end;last.confidence=Math.min(last.confidence,n.confidence);}
    else out.push({...n,confidence:Math.min(n.confidence??.4,support>=.25?.8:.45)});
  }
  return out;
}
