import {BasicPitch,outputToNotesPoly,noteFramesToTime} from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';
import {detectMonophonic,estimateTempo} from './transcription.mjs';
import {legacyResult} from './legacy-evidence.mjs';
import {detectMonophonicV2} from './transcription-v2.mjs';
import {processEvidence} from '../public/recognition-v2.mjs';
import {nativeBasic} from './basic-native.mjs';
import {EVIDENCE_VERSION} from '../public/recognition-evidence.mjs';
let model;
self.onmessage=async({data})=>{
  const {samples,engine,options}=data;
  const progress=(value,stage)=>self.postMessage({type:'progress',value,stage});
  try{
    if(engine==='tempo'){self.postMessage({type:'tempo',bpm:estimateTempo(samples)});return;}
    let notes=[],computeRecords=[];
    const native=options?.execution?.basicBackend?.startsWith("onnx-");
    const improved=options?.pipeline&&options.pipeline!=='legacy',cached=options?.rawEvidence;
    if(improved&&cached){progress(.95,'复用原始分析，重新筛选候选');const raw={...cached,...(options.externalEvidence||{})};self.postMessage({type:'result',...processEvidence(raw,samples,engine==='pitchy'?{...options,analysisMode:'solo'}:options),rawEvidence:raw,cacheHit:true});return;}
    if(!improved&&cached){self.postMessage({type:'result',...legacyResult(cached,samples,engine,options),cacheHit:true});return;}
    if(improved&&engine==='pitchy'){
      const pitch=detectMonophonicV2(samples,22050,options),raw={version:EVIDENCE_VERSION,rawBasic:[],pitchFrames:pitch.frames,onsets:pitch.onsets,...(options.externalEvidence||{})};
      self.postMessage({type:'result',...processEvidence(raw,samples,{...options,analysisMode:'solo'}),rawEvidence:raw});return;
    }
    if(engine==='pitchy'){progress(0,'Pitchy 单音检测');const raw={version:EVIDENCE_VERSION,rawBasic:[],rawMono:detectMonophonic(samples,22050,options,p=>progress(p,'Pitchy 单音检测')),pitchFrames:[]};self.postMessage({type:'result',...legacyResult(raw,samples,engine,options)});return;}
    else {
      const adaptive=engine==='adaptive',instrumental=engine==='instrumental'||(adaptive&&options.source!=='vocals');
      progress(0,'加载本地 Basic Pitch 模型');
      if(!native){await tf.setBackend('cpu');await tf.ready();
      model ||= new BasicPitch('/models/basic-pitch/model.json');
      await model.model;}
      // Bounded overlapping blocks prevent whole-song tensors from growing without bound.
      const block=20,overlap=.5,sr=22050,total=Math.ceil(samples.length/sr/block);
      for(let i=0;i<total;i++){
        const left=Math.max(0,i*block-overlap),right=Math.min(samples.length/sr,(i+1)*block+overlap),audio=samples.slice(Math.floor(left*sr),Math.floor(right*sr));
        const frames=[],onsets=[];tf.engine().startScope();
        try{
          if(native){const output=await nativeBasic(audio,options.execution,options.token);frames.push(...output.frames);onsets.push(...output.onsets);computeRecords.push(output.metadata);progress((i+1)/total,`Basic Pitch ${output.metadata.device==='cuda'?'显卡':'原生 CPU'} 转录 ${i+1}/${total}`);}
          else await model.evaluateModel(audio,(f,o)=>{frames.push(...f);onsets.push(...o);},p=>progress((i+p)/total,`Basic Pitch 转录 ${i+1}/${total}`));
          const noteFrames=outputToNotesPoly(frames,onsets,instrumental?.22:.3,instrumental?.16:.25,improved?1:6,true,440*2**((options.maxMidi-69)/12),440*2**((options.minMidi-69)/12)),result=noteFramesToTime(noteFrames);
          for(let k=0;k<result.length;k++){const n=result[k],mid=left+n.startTimeSeconds+n.durationSeconds/2;if(mid>=i*block&&mid<(i+1)*block){const frame=noteFrames[k].startFrame,bin=n.pitchMidi-21,onsetConfidence=Math.max(...onsets.slice(Math.max(0,frame-2),frame+3).map(o=>o[bin]||0),0);notes.push({start:Math.max(0,left+n.startTimeSeconds),end:Math.min(samples.length/sr,left+n.startTimeSeconds+n.durationSeconds),midi:n.pitchMidi,confidence:n.amplitude,...(improved?{onsetConfidence,eventId:`basic-${i}-${notes.length}`}:{})});}}
        }finally{tf.engine().endScope();}
      }
      if(improved){
        const pitch=detectMonophonicV2(samples,22050,options),raw={version:EVIDENCE_VERSION,compute:{backend:computeRecords.at(-1)?.backend||'tfjs-cpu',fingerprint:computeRecords.at(-1)?.fingerprint||options?.execution?.basicFingerprint,records:computeRecords},rawBasic:notes,pitchFrames:pitch.frames,onsets:pitch.onsets,...(options.externalEvidence||{})};
        self.postMessage({type:'result',...processEvidence(raw,samples,options),rawEvidence:raw});return;
      }
      const raw={version:EVIDENCE_VERSION,compute:{backend:computeRecords.at(-1)?.backend||'tfjs-cpu',fingerprint:computeRecords.at(-1)?.fingerprint||options?.execution?.basicFingerprint,records:computeRecords},rawBasic:notes,rawMono:detectMonophonic(samples,22050,!adaptive&&instrumental?{...options,threshold:.82}:options),pitchFrames:[]};
      self.postMessage({type:'result',...legacyResult(raw,samples,engine,options)});return;
    }
    self.postMessage({type:'result',notes});
  }catch(error){self.postMessage({type:'error',message:error.message||'本地转录失败'});}
};
