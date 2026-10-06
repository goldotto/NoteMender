import {EVIDENCE_VERSION} from './recognition-evidence.mjs';
export function acquisitionSettings(engine,options){
  return {version:EVIDENCE_VERSION,engine,source:options.source,minMidi:options.minMidi,maxMidi:options.maxMidi,
    profile:options.pipeline==='legacy'?'legacy':'corrected',external:options.pipeline==='pyin'?'pyin':options.pipeline==='crepe'?'crepe':null,sr:22050,...(options.execution?{compute:{backend:engine==='pitchy'?'pitchy-cpu':options.execution.basicBackend,model:options.execution.basicFingerprint,precision:'fp32',stems:options.sourceFingerprint||'original',...(options.pipeline==='crepe'?{externalBackend:options.execution.pitchBackend||'cpu'}:{})}}:{})};
}
export async function analysisKey(samples,engine,options){
  const audioHash=await crypto.subtle.digest('SHA-256',samples.buffer.slice(samples.byteOffset,samples.byteOffset+samples.byteLength));
  const hash=[...new Uint8Array(audioHash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const key=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({...acquisitionSettings(engine,options),hash})));
  return [...new Uint8Array(key)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function analysisKeys(samples,engine,options){
  const baseOptions={...options,pipeline:options.pipeline==='legacy'?'legacy':'corrected'};
  const base=await analysisKey(samples,engine,baseOptions);
  return {base,combined:['pyin','crepe'].includes(options.pipeline)?await analysisKey(samples,engine,options):base};
}
export function baseEvidence(evidence){
  const {externalFrames,externalEngine,externalCompute,...base}=evidence;
  return base;
}
export async function loadAnalysis(key,token,signal){
  const r=await fetch('/api/analysis/cache/'+key,{headers:{'X-Studio-Token':token},signal});if(!r.ok)throw Error('读取本机分析缓存失败');return r.json();
}
export async function saveAnalysis(key,evidence,token,signal){
  const r=await fetch('/api/analysis/cache/'+key,{method:'PUT',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(evidence),signal});if(!r.ok)throw Error('原始分析未能写入缓存');
}
