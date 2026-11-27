import {replaceSectionCandidate} from './local-candidates.mjs';
import {sectionBeats} from './sections.mjs';
import {validateProject} from './music.mjs';
import {guideMuVocalSlots} from './muscriptor-vocal-pitch.mjs';

// Instrument predictions are not audio stems. On a real vocal stem, retain
// singing even when the model changes its predicted instrument halfway through.
export const MU_CANDIDATE_MODEL='muscriptor-integrated-0.3.0';
const LEGACY_MU_CANDIDATE_MODEL='muscriptor-integrated-0.3.0-large';
export const isMuCandidate=c=>c?.model===MU_CANDIDATE_MODEL||c?.model===LEGACY_MU_CANDIDATE_MODEL;

export function muMelodySlots(raw){
  const notes=raw.filter(n=>n.instrument!=='drums'&&Number.isFinite(n.start)&&Number.isFinite(n.end)&&n.end>n.start&&Number.isInteger(n.midi)).map((n,i)=>({...n,eventId:n.id||`mu-${i}`})).sort((a,b)=>a.start-b.start||b.midi-a.midi);
  // Treat near-simultaneous different pitches as a chord, keeping retriggers.
  let chord=[];for(const n of notes){if(chord.length&&n.start-chord[0].start<=.025&&chord.every(p=>p.end>n.start+.002&&p.midi!==n.midi)){n.start=chord[0].start;chord.push(n);}else chord=[n];}
  const changes=new Map();for(const n of notes){if(!changes.has(n.start))changes.set(n.start,{add:[],remove:[]});if(!changes.has(n.end))changes.set(n.end,{add:[],remove:[]});changes.get(n.start).add.push(n);changes.get(n.end).remove.push(n);}
  const times=[...changes.keys()].sort((a,b)=>a-b),active=new Map(),slots=[];
  for(let i=0;i<times.length-1;i++){const at=times[i],event=changes.get(at);for(const n of event.remove)active.delete(n.eventId);for(const n of event.add)active.set(n.eventId,n);slots.push({start:at,end:times[i+1],notes:[...active.values()].sort((a,b)=>b.midi-a.midi)});}
  return slots;
}

export function muSourceMelody(raw,voice='continuous',pitchFrames=[]){
  const slots=muMelodySlots(raw);
  const selected=new Array(slots.length);
  // Optimize each continuous phrase, including held notes at later attacks.
  // This avoids cutting off a sustained melody when a lower note begins.
  for(let from=0;from<slots.length;){if(!slots[from].notes.length){from++;continue;}let to=from;while(to<slots.length&&slots[to].notes.length)to++;
    if(voice==='high'||voice==='low'){for(let i=from;i<to;i++)selected[i]=voice==='high'?slots[i].notes[0]:slots[i].notes.at(-1);}
    else{const costs=[],parents=[];for(let i=from;i<to;i++){const group=slots[i].notes,prior=i>from?slots[i-1].notes:[];costs[i]=[];parents[i]=[];for(let j=0;j<group.length;j++){const n=group[j];let best=i===from?0:Infinity,parent=-1;for(let k=0;k<prior.length;k++){const p=prior[k],step=Math.abs(n.midi-p.midi),cost=costs[i-1][k]+(n.eventId===p.eventId?0:.05+step*.06);if(cost<best){best=cost;parent=k;}}costs[i][j]=best;parents[i][j]=parent;}}
      let index=costs[to-1].indexOf(Math.min(...costs[to-1]));for(let i=to-1;i>=from;i--){selected[i]=slots[i].notes[index];index=parents[i][index];}}
    from=to;
  }
  const path=voice==='continuous'&&pitchFrames.length?guideMuVocalSlots(slots,selected,pitchFrames):selected;
  const out=[];for(let i=0;i<slots.length;i++){const n=path[i],s=slots[i];if(!n)continue;const last=out.at(-1);if(last?.eventId===n.eventId&&Math.abs(last.end-s.start)<1e-8)last.end=s.end;else out.push({...n,start:s.start,end:s.end,confidence:.5});}return out;
}

// The model is loaded once per actual input buffer/range, never per 8s window.
export function createMuSourceAnalysis(load){
  const sources=new Map();return async(key,input)=>{if(!sources.has(key))sources.set(key,Promise.resolve().then(()=>load(input)));return sources.get(key);};
}

export function muSourceVariants(result,options={}){
  const allowed=result.notes.filter(n=>n.midi>=(options.minMidi??21)&&n.midi<=(options.maxMidi??108));
  const choices=[['continuous','连续旋律'],['high','较高旋律'],['low','较低旋律']],variants=[];
  const baseline=muSourceMelody(allowed);
  const pitchFrames=options.pitchFrames||[];
  if(pitchFrames.length){
    const notes=muSourceMelody(allowed,'continuous',pitchFrames);
    if(!sameMuMelody(notes,baseline)){
      variants.push({id:'vocal-pitch',label:'MuScriptor · 人声音高校正',model:MU_CANDIDATE_MODEL,analysisId:result.analysisId,notes});
    }
  }
  for(const [id,label] of choices){const notes=id==='continuous'?baseline:muSourceMelody(allowed,id);variants.push({id,label:`MuScriptor · ${label}`,model:MU_CANDIDATE_MODEL,analysisId:result.analysisId,notes});}
  const preferred=options.strategy==='highest'?variants.find(v=>v.id==='high').notes:variants[0]?.notes||[];
  return {primary:preferred,variants};
}

function sameMuMelody(notes,baseline){
  return notes.length===baseline.length&&notes.every((n,i)=>n.start===baseline[i].start&&n.end===baseline[i].end&&n.midi===baseline[i].midi);
}

export function muWindowResult(prepared,window,origin,source){
  const own=notes=>notes.filter(n=>n.start+origin<window.to&&n.end+origin>window.from).map(n=>({...n,source,start:Math.max(window.from,n.start+origin),end:Math.min(window.to,n.end+origin),detectedStart:n.start+origin,detectedEnd:n.end+origin,windowId:`${window.from}-${window.to}`,evidenceId:`mu:${n.eventId}:${window.from}-${window.to}`}));
  const choices=prepared.variants.map(v=>({...v,source,notes:own(v.notes)}));
  const baseline=choices.find(v=>v.id==='continuous');
  const variants=choices.filter(v=>v.id!=='vocal-pitch'||!baseline||!sameMuMelody(v.notes,baseline.notes));
  return {primary:own(prepared.primary),variants,mode:source==='vocals'?'vocal':'dense',source,diagnostics:{issues:[]}};
}

// Deduplicate after section clipping and quantization, not on the entire song.
export function distinctMuCandidates(variants){
  const seen=new Set();return variants.filter(v=>{const key=v.notes.map(n=>`${n.start}:${n.duration}:${n.midi}`).join('|');if(seen.has(key))return false;seen.add(key);return true;});
}

export function chooseMuCandidates(base,sections,variants){
  let project=base;const selected=new Map(),missing=[];
  for(const s of sections){const choices=variants.filter(v=>v.sectionId===s.id&&isMuCandidate(v)&&v.notes.length),candidate=choices.find(v=>v.source===s.source)||choices.find(v=>v.source==='original')||choices[0];
    if(!candidate){missing.push(s.name);continue;}
    project=replaceSectionCandidate(project,sectionBeats(project,s),candidate);selected.set(s.id,candidate.id);
  }
  return {project:validateProject({...project,alternates:variants}),selected,missing};
}
