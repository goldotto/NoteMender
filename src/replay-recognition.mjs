import {processEvidence} from '../public/recognition-v2.mjs';
import {ownEvents,stitchEvidence,shiftEvidence} from '../public/recognition-evidence.mjs';

import {readPcm16Wav} from './pcm-wav.mjs';

export function readReviewWav(bytes){
  const {samples,rate}=readPcm16Wav(bytes);
  if(rate!==22050)throw Error('需要评测集中的 22050 Hz、16 位 WAV');
  return samples;
}

// Replay only the saved acquisition; never load a model or infer a reference answer.
export function replayRecognition(audit,samples,{pipeline='corrected',ablation='none',externalEvidence=null}={}){
  const started=performance.now(),events=[],windows=[];
  for(const window of audit.windows.filter(w=>w.candidateRole!=='alternate')){
    if(window.source!=='original')throw Error('多轨诊断请提供对应分轨；不能用原曲替代其能量证据');
    if(!window.evidence)throw Error('诊断缺少原始分析证据');
    const raw=shiftEvidence(window.evidence,-window.clipStart),clip=samples.slice(Math.round(window.clipStart*22050),Math.round(window.clipEnd*22050));
    if(externalEvidence){raw.externalEngine=externalEvidence.externalEngine;raw.externalFrames=externalEvidence.externalFrames.filter(f=>f.second>=window.clipStart&&f.second<window.clipEnd).map(f=>({...f,second:f.second-window.clipStart}));}
    const result=processEvidence(raw,clip,{...window.parameters,source:window.source,pipeline,ablation});
    events.push(...ownEvents(result.notes,window.clipStart,window.from,window.to,{windowId:`${window.from}-${window.to}`}));
    windows.push({...window,profile:pipeline,ablation,cacheHit:true,evidence:shiftEvidence(result.evidence,window.clipStart),issues:result.diagnostics.issues.map(i=>({...i,second:i.second+window.clipStart,...(Number.isFinite(i.end)?{end:i.end+window.clipStart}:{})}))});
  }
  const stitchDecisions=[],selected=stitchEvidence(events,stitchDecisions);
  return {...audit,pipeline,ablation,events:selected,windows,stitchDecisions,quantized:null,replayOnly:true,acquisitionVersion:audit.evidenceVersion,performance:{modelRuns:0,windows:windows.length,postprocessingElapsedMs:performance.now()-started}};
}
