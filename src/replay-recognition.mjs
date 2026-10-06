import {processEvidence} from '../public/recognition-v2.mjs';
import {ownEvents,stitchEvidence,shiftEvidence} from '../public/recognition-evidence.mjs';

export function readReviewWav(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(p,n)=>String.fromCharCode(...bytes.subarray(p,p+n));
  if(text(0,4)!=='RIFF'||text(8,4)!=='WAVE')throw Error('回放需要 PCM WAV');
  let format,channels,rate,bits,offset,size;
  for(let p=12;p+8<=bytes.length;){const length=v.getUint32(p+4,true);if(p+8+length>bytes.length)throw Error('WAV 数据不完整');
    if(text(p,4)==='fmt '){format=v.getUint16(p+8,true);channels=v.getUint16(p+10,true);rate=v.getUint32(p+12,true);bits=v.getUint16(p+22,true);}
    if(text(p,4)==='data'){offset=p+8;size=length;}p+=8+length+(length%2);
  }
  if(format!==1||bits!==16||rate!==22050||!channels||offset===undefined)throw Error('需要评测集中的 22050 Hz、16 位 WAV');
  const samples=new Float32Array(Math.floor(size/(2*channels)));
  for(let i=0;i<samples.length;i++){let sum=0;for(let c=0;c<channels;c++)sum+=v.getInt16(offset+2*(i*channels+c),true)/32768;samples[i]=sum/channels;}
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
