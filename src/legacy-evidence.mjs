import {selectMelody} from './transcription.mjs';
import {acousticReference} from '../public/grounding.mjs';
import {chooseAnalysisMode,fuseVocalCandidates,traceDenseMelody,chooseDenseCandidate,reviewIssues} from '../public/adaptive-strategy.mjs';
import {EVIDENCE_VERSION} from '../public/recognition-evidence.mjs';

// Keep the Basic Pitch selection paths, without the retired monophonic detector.
export function legacyResult(raw,samples,engine,options={}){
  if(!['basic','adaptive','instrumental'].includes(engine))throw Error('该识别方式已停用，请选择自动或 Basic Pitch');
  const basic=raw.rawBasic||[],mono=[];
  // Old cached Pitchy evidence must never feed new generation.
  raw={...raw,rawMono:[],pitchFrames:[]};
  let notes,mode,alternates=[],sparseDense=false;
  const adaptive=engine==='adaptive',instrumental=engine==='instrumental'||adaptive&&options.source!=='vocals';
  const greedy=selectMelody(basic,options);
  if(adaptive){
    mode=chooseAnalysisMode({requested:options.analysisMode||'auto',source:options.source||'original',basic,mono,windowSeconds:samples.length/22050});
    const traced=mode==='dense'?traceDenseMelody(basic,options):greedy;
    const dense=mode==='dense'?chooseDenseCandidate(traced,greedy,samples.length/22050):{notes:traced,sparse:false};sparseDense=dense.sparse;
    notes=mode==='vocal'?fuseVocalCandidates(greedy,mono,samples):dense.notes;
    alternates=[{id:'basic',label:'Basic Pitch 连续旋律',notes:greedy}];
    if(mode==='dense')alternates.push({id:'tracked',label:'密集器乐追踪',notes:traced});
  }else if(instrumental){
    mode='dense';notes=greedy.map(n=>({...n,confidence:Math.min(.45,n.confidence??.35)}));
  }else{mode='vocal';notes=acousticReference(greedy,null,samples);}
  const decisions=[...basic,...mono].filter(n=>!notes.some(s=>s.midi===n.midi&&s.end>n.start&&s.start<n.end)).map(n=>({kind:'现版筛选未保留',second:n.start,end:n.end,midi:n.midi,reason:'现版筛选、能量或时长规则'}));
  return {notes,mode,alternates,rawEvidence:raw,evidence:{...raw,version:EVIDENCE_VERSION,profile:'legacy',selected:notes,decisions},diagnostics:{basicCount:basic.length,monoCount:mono.length,sparseDense,conflicts:notes.filter(n=>n.reviewFlags?.includes('音高冲突')).length,issues:reviewIssues(notes,samples)}};
}
