import {audioPitchEvidence} from './muscriptor-pitch-evidence.mjs';
import {muPitchFramesBetween,muPitchMatches} from './muscriptor-vocal-pitch.mjs';

const onsetTolerance=.04, overlap=(a,b)=>Math.min(a.end,b.end)-Math.max(a.start,b.start);
const duplicate=(a,b)=>Math.abs(a.start-b.start)<=onsetTolerance+1e-9&&
  overlap(a,b)>=.8*Math.max(a.end-a.start,b.end-b.start);

export function muDuplicateIds(notes,target=[]){
  const known=Map.groupBy(target,n=>n.midi),ids=new Set();
  for(const note of notes){
    const nearby=known.get(note.midi)||[];
    if(nearby.some(other=>duplicate(note,other)))ids.add(note.id);
    nearby.push(note);known.set(note.midi,nearby);
  }
  return ids;
}

export function muMoveNotes(edits,notes,target){
  const next=new Map(edits);
  for(const {id,start,end,midi,added,instrument} of notes){
    if(instrument!==target)next.set(id,{start,end,midi,added:added===true,instrument:target});
  }
  return next;
}

export function muVocalSuggestions(audio,notes,reference=[],evidence={}){
  const frames=audioPitchEvidence(audio,'vocals',{hopSeconds:.025});
  const consensus=evidence.consensus;
  const accompaniments=new Map(Object.entries(evidence.accompaniment||{}).map(([source,input])=>
    [source,audioPitchEvidence(input,source==='bass'?'vocals':'original',{hopSeconds:.025})]));
  const byPitch=Map.groupBy(reference,n=>n.midi);
  const existing=Map.groupBy(notes.filter(n=>n.instrument==='voice'),n=>n.midi);
  const groups=new Map();
  for(const note of [...notes].sort((a,b)=>a.start-b.start)){
    if(note.instrument==='voice'||note.instrument==='drums')continue;
    const voiced=frame=>Number.isFinite(frame.pitch);
    const inner=consensus ? .025 : 0;
    const within=muPitchFramesBetween(frames,note.start+inner,note.end-inner);
    const primary=consensus?within.filter(voiced):within;
    const matches=primary.filter(frame=>muPitchMatches(frame,note.midi));
    if(matches.length<3||matches.length<primary.length*.7)continue;
    if(consensus){
      const dual=muPitchFramesBetween(consensus,note.start+.025,note.end-.025);
      const dualMatches=dual.filter(frame=>muPitchMatches(frame,note.midi)).length;
      if(dual.length<3||dualMatches<dual.length*.65)continue;
    }
    const isBass=note.instrument.includes('bass')||note.instrument==='contrabass';
    const backing=accompaniments.get(isBass?'bass':'other');
    const backingMatches=backing?primary.filter(frame=>muPitchFramesBetween(backing,frame.second-.013,frame.second+.013)
      .some(f=>muPitchMatches(f,note.midi))).length:0;
    const alsoInBacking=backingMatches>=primary.length*.45;
    const repeated=(existing.get(note.midi)||[]).some(other=>duplicate(note,other)||consensus&&
      Math.abs(note.start-other.start)<=.08&&overlap(note,other)>.6*(note.end-note.start));
    const backed=(byPitch.get(note.midi)||[]).some(other=>overlap(note,other)>=.5*(note.end-note.start));
    const key=[note.instrument,repeated,alsoInBacking].join('|');
    if(!groups.has(key))groups.set(key,[]);
    const list=groups.get(key);
    let group=list.at(-1);
    if(!group||note.start>group.to+.65){
      group={from:note.start,to:note.end,instrument:note.instrument,repeated,alsoInBacking,backed:0,ids:[]};
      list.push(group);
    }
    group.ids.push(note.id);group.to=Math.max(group.to,note.end);group.backed+=Number(backed);
  }
  return [...groups.values()].flat().sort((a,b)=>a.from-b.from);
}

export async function scanMuVocalNotes(audio,notes,reference,signal,evidence){
  signal.throwIfAborted();
  const worker=new Worker(new URL('./muscriptor-review-worker.mjs',import.meta.url),{type:'module'});
  let abort;
  return new Promise((resolve,reject)=>{
    abort=()=>reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.groups);
    worker.onerror=event=>reject(Error(event.message));
    worker.onmessageerror=()=>reject(Error('Invalid vocal scan response'));
    const transfers=[audio,...Object.values(evidence?.accompaniment||{})].map(input=>input.samples.buffer);
    worker.postMessage({action:'relabelling',audio,notes,reference,evidence},transfers);
  }).finally(()=>{signal.removeEventListener('abort',abort);worker.terminate();});
}
