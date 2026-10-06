import {chooseAnalysisMode,reviewIssues} from './adaptive-strategy.mjs';
import {energyProfile,segmentPitchFrames} from '../src/transcription-v2.mjs';
import {EVIDENCE_VERSION} from './recognition-evidence.mjs';

const dur=n=>n.end-n.start;
const overlap=(a,b)=>Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
const flags=(n,...extra)=>[...new Set([...(n.reviewFlags||[]),...extra])];
export function melodyPath(events,{strategy='smooth',continuity=true,shortNotes=true,decisions=[]}={}){
  const notes=events.map((n,i)=>({...n,eventId:n.eventId||`path-${i}`})).filter(n=>dur(n)>0&&(shortNotes||dur(n)>=.07));
  const times=[...new Set(notes.flatMap(n=>[n.start,n.end]))].sort((a,b)=>a-b);
  let states=[{note:null,score:0,previous:null}],frames=[];
  for(let i=0;i<times.length-1;i++){
    const from=times[i],to=times[i+1],active=notes.filter(n=>n.start<=from+1e-6&&n.end>=to-1e-6);
    if(to<=from)continue;
    const next=[];
    for(const note of [null,...active]){
      let best=null;
      for(const previous of states){
        const jump=previous.note&&note?Math.abs(note.midi-previous.note.midi):0;
        const cost=continuity&&strategy==='smooth'?.018*Math.min(jump,24)+(jump>=12?.12:0):0;
        const local=note?(.15+.7*(note.confidence??.4)+(strategy==='highest'?.003*note.midi:0))*(to-from):-.1*(to-from);
        const score=previous.score+local-cost;
        if(!best||score>best.score)best={note,score,previous,from,to,active:active.length};
      }
      next.push(best);
    }
    states=next;frames.push({from,to});
  }
  if(!frames.length)return [];
  let cursor=states.reduce((a,b)=>a.score>=b.score?a:b);const path=[];
  while(cursor?.previous){path.push(cursor);cursor=cursor.previous;}path.reverse();
  const out=[];
  for(const frame of path){const n=frame.note;if(!n)continue;const last=out.at(-1);
    if(last&&last.eventId===n.eventId&&Math.abs(last.end-frame.from)<1e-6)last.end=frame.to;
    else out.push({...n,start:frame.from,end:frame.to,reviewFlags:flags(n,...(frame.active>1?['多音竞争']:[]),...(frame.from>n.start+1e-6?['声部切换片段']:[]))});
  }
  for(const n of notes)if(!out.some(p=>p.eventId===n.eventId))decisions.push({kind:'旋律筛选备选',second:n.start,end:n.end,midi:n.midi,eventId:n.eventId,reason:'同段有其他声部候选'});
  for(const p of out){const n=notes.find(n=>n.eventId===p.eventId);if(p.start>n.start+1e-6||p.end<n.end-1e-6)decisions.push({kind:'旋律边界裁剪',second:p.start,end:p.end,midi:p.midi,eventId:p.eventId,originalStart:n.start,originalEnd:n.end,reason:'多声部竞争，只保留被选中的时间范围'});}
  return out;
}
export function fuseEvidence(basic,mono,samples,sr=22050,{adaptiveEnergy=true,shortNotes=true,decisions=[]}={}){
  const profile=energyProfile(samples,sr),floor=adaptiveEnergy?profile.floor:.006;
  const rms=n=>{let sum=0,count=0;for(let i=Math.max(0,Math.floor(n.start*sr));i<Math.min(samples.length,Math.ceil(n.end*sr));i+=8){sum+=samples[i]**2;count++;}return Math.sqrt(sum/Math.max(1,count));};
  const kept=basic.map(n=>{
    const candidates=mono.filter(p=>overlap(n,p)>dur(n)*.25),nearest=candidates.sort((a,b)=>overlap(n,b)-overlap(n,a))[0];
    const conflict=nearest&&nearest.midi!==n.midi,weak=rms(n)<floor;
    if(weak)decisions.push({kind:'弱音保留待核对',second:n.start,end:n.end,midi:n.midi,eventId:n.eventId,reason:'低能量不直接删除'});
    return {...n,...(conflict?{pitchConflict:[{engine:'Basic Pitch',midi:n.midi},{engine:'Pitchy',midi:nearest.midi}]}:{}),confidence:conflict||weak?Math.min(.45,n.confidence??.4):n.confidence,reviewFlags:flags(n,...(conflict?['音高冲突']:[]),...(weak?['弱音待核对']:[]))};
  });
  for(const n of mono){
    if((n.confidence??0)<.75){decisions.push({kind:'低可信度备选',second:n.start,end:n.end,midi:n.midi,eventId:n.eventId});continue;}
    let parts=[[n.start,n.end]];
    for(const b of kept)parts=parts.flatMap(([a,z])=>b.end<=a||b.start>=z?[[a,z]]:[[a,Math.min(z,b.start)],[Math.max(a,b.end),z]].filter(([x,y])=>y>x));
    for(const [start,end] of parts){
      if(!shortNotes&&end-start<.08)continue;
      if(rms({start,end})<floor)continue;
      kept.push({...n,start,end,confidence:Math.min(.55,n.confidence*.6),reviewFlags:flags(n,'补充候选',...(end-start<.08?['短音待核对']:[]))});
      decisions.push({kind:'补充弱音候选',second:start,end,midi:n.midi,eventId:n.eventId});
    }
  }
  return kept.sort((a,b)=>a.start-b.start);
}
export function processEvidence(raw,samples,options={}){
  const ablation=options.ablation||'none',rules={shortNotes:ablation!=='short',repeatedNotes:ablation!=='repeat',adaptiveEnergy:ablation!=='energy',continuity:ablation!=='continuity'};
  const decisions=[],source=options.source||'original';
  const basic=(raw.rawBasic||[]).map((n,i)=>({...n,eventId:n.eventId||`basic-${i}`,source,reviewFlags:flags(n,...(dur(n)<.08?['短音待核对']:[]))}));
  const frames=(raw.externalFrames||raw.pitchFrames||[]).map(f=>({...f,voiced:f.voiced&&(rules.adaptiveEnergy||f.rms>.006)})),onsets=[...(raw.onsets||[]),...basic.filter(n=>(n.onsetConfidence??0)>=.5).map(n=>({second:n.start,confidence:n.onsetConfidence,source:'basic'}))];
  const mono=segmentPitchFrames(frames,onsets,{...rules,source:raw.externalEngine||'pitchy'}).map(n=>({...n,source}));
  // A raw short event is evidence, not automatically a new melody attack.
  const eligible=basic.filter(n=>{
    if(dur(n)>=.08||!rules.shortNotes)return true;
    const attack=(n.onsetConfidence??0)>=.5||onsets.some(o=>o.source==='energy'&&o.confidence>=.5&&Math.abs(o.second-n.start)<=.035);
    const stable=mono.some(p=>p.midi===n.midi&&(p.confidence??0)>=.85&&overlap(n,p)>=dur(n)*.6);
    const keep=attack&&(stable||(n.confidence??0)>=.6)||(n.confidence??0)>=.85;
    if(!keep)decisions.push({kind:'短音备选待核对',second:n.start,end:n.end,midi:n.midi,eventId:n.eventId,reason:'起音与持续音高证据不足；原始候选保留'});
    return keep;
  });
  const mode=chooseAnalysisMode({requested:options.analysisMode||'auto',source,basic,mono,windowSeconds:samples.length/22050});
  const greedy=melodyPath(eligible,{...rules,continuity:false,strategy:options.strategy,decisions:[]});
  const traced=melodyPath(eligible,{...rules,strategy:options.strategy,decisions});
  let selected=mode==='solo'&&mono.length?mono:traced;
  if(mode==='vocal')selected=ablation==='fusion'?traced:fuseEvidence(traced,mono,samples,22050,{...rules,decisions});
  if(!rules.repeatedNotes){const joined=[];for(const n of selected){const last=joined.at(-1);if(last&&last.midi===n.midi&&n.start-last.end<=.08){decisions.push({kind:'消融：同音合并',second:n.start,end:n.end,midi:n.midi});last.end=n.end;}else joined.push({...n});}selected=joined;}
  const monoPath=melodyPath(mono,{...rules,continuity:false}),issues=reviewIssues(selected,samples);
  if(mode==='dense')for(const n of selected){const p=mono.filter(p=>(p.confidence??0)>=.75&&overlap(n,p)>dur(n)*.5).sort((a,b)=>overlap(n,b)-overlap(n,a))[0];if(p&&p.midi!==n.midi)issues.push({second:n.start,end:n.end,kind:'两个候选音高不一致',pitches:[{engine:'Basic Pitch',midi:n.midi},{engine:raw.externalEngine||'Pitchy',midi:p.midi}]});}
  for(const n of selected.filter(n=>dur(n)<.08))issues.push({second:n.start,end:n.end,kind:'短音待核对'});
  for(let i=1;i<basic.length;i++){const a=basic[i-1],b=basic[i];if(a.midi===b.midi&&b.start>=a.end-.04&&b.start-a.end<=.08)issues.push({second:a.start,end:b.end,kind:'重复同音，请核对起音'});}
  issues.push(...decisions.filter(d=>d.kind==='弱音保留待核对').map(d=>({second:d.second,end:d.end,kind:d.kind})));
  issues.push(...decisions.filter(d=>d.kind==='短音备选待核对').map(d=>({second:d.second,end:d.end,kind:d.kind})));
  for(const n of basic)if(!rules.shortNotes&&dur(n)<.07)decisions.push({kind:'消融：短音过滤',second:n.start,end:n.end,midi:n.midi,eventId:n.eventId});
  return {notes:selected,mode,alternates:[{id:'basic',label:'Basic Pitch 无连续性约束',notes:greedy},{id:'pitchy',label:raw.externalEngine||'Pitchy 连续音高分音',notes:monoPath},{id:'raw-short',label:'原始候选旋律（含短音）',notes:melodyPath(basic,{continuity:false,shortNotes:true})}],
    diagnostics:{basicCount:basic.length,monoCount:mono.length,conflicts:selected.filter(n=>n.reviewFlags?.includes('音高冲突')).length,issues:issues.slice(0,100)},
    evidence:{version:EVIDENCE_VERSION,profile:options.pipeline||'corrected',ablation,rawBasic:basic,rawMono:mono,pitchFrames:frames,onsets,selected,decisions}};
}
