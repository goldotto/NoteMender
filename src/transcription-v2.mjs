import {PitchDetector} from 'pitchy';

const median=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:0;};
export function energyProfile(samples,sr=22050){
  const hop=Math.max(1,Math.round(sr*.01)),frames=[];
  for(let i=0;i<samples.length;i+=hop){let e=0;const count=Math.min(hop,samples.length-i);for(let j=0;j<count;j++)e+=samples[i+j]**2;frames.push({second:i/sr,rms:Math.sqrt(e/Math.max(1,count))});}
  const values=frames.map(f=>f.rms).sort((a,b)=>a-b),peak=values[Math.floor(values.length*.95)]||0,background=values[Math.floor(values.length*.15)]||0;
  // A recording's level must not determine whether all of its notes disappear.
  const floor=Math.max(1e-7,Math.min(peak*.08,background*2));
  const onsets=[];let previous=0;
  for(let i=0;i<frames.length;i++){
    const f=frames[i],rise=f.rms-previous;
    if(f.rms>floor*2&&rise>Math.max(peak*.08,previous*.45)&&(!onsets.length||f.second-onsets.at(-1).second>.04))onsets.push({second:f.second,confidence:Math.min(1,rise/Math.max(peak*.3,1e-7)),source:'energy'});
    previous=median(frames.slice(Math.max(0,i-2),i+1).map(x=>x.rms));
  }
  return {frames,peak,background,floor,onsets};
}
export function pitchFrames(samples,sr=22050,{minMidi=45,maxMidi=88,threshold=.75,adaptiveEnergy=true}={}){
  const profile=energyProfile(samples,sr),size=1024,hop=Math.round(sr*.01),detector=PitchDetector.forFloat32Array(size),frames=[];
  const floor=adaptiveEnergy?profile.floor:.006;
  for(let t=0;t+size<=samples.length;t+=hop){
    const buf=samples.subarray(t,t+size);let energy=0;for(const x of buf)energy+=x*x;const rms=Math.sqrt(energy/size);
    const [hz,confidence]=rms>floor?detector.findPitch(buf,sr):[0,0],pitch=hz>0?69+12*Math.log2(hz/440):null;
    frames.push({second:(t+size/2)/sr,hz,confidence,rms,pitch,voiced:confidence>=threshold&&pitch!==null&&pitch>=minMidi-.5&&pitch<=maxMidi+.5});
  }
  return {frames,onsets:profile.onsets,energy:profile};
}
export function segmentPitchFrames(frames,onsets=[],{shortNotes=true,repeatedNotes=true,source='pitchy',hop=.01}={}){
  const notes=[];let current=null;
  const finish=()=>{if(!current)return;const midi=Math.round(median(current.pitches)),confidence=current.sum/current.count,n={start:Math.max(0,current.start),end:current.end,midi,confidence,onsetConfidence:current.onset,eventId:`${source}-${notes.length}`,source,reviewFlags:[]};
    if(n.end>n.start&&(shortNotes||n.end-n.start>=.08)){if(n.end-n.start<.08)n.reviewFlags.push('短音待核对');notes.push(n);}current=null;};
  for(let i=0;i<frames.length;i++){
    const f=frames[i],near=frames.slice(Math.max(0,i-2),i+3).filter(p=>p.voiced&&Number.isFinite(p.pitch)).map(p=>p.pitch);
    const pitch=f.voiced&&near.length?median(near):null;
    const onset=onsets.find(o=>o.second>f.second-hop*1.5&&o.second<=f.second+hop*.5&&o.confidence>=.35);
    const attack=repeatedNotes&&onset&&current&&f.second-current.start>.035;
    if(pitch===null){finish();continue;}
    if(current&&(Math.abs(pitch-median(current.pitches))>.65||attack))finish();
    if(!current)current={start:Math.max(0,f.second-hop/2),end:f.second+hop/2,pitches:[],sum:0,count:0,onset:onset?.confidence||0};
    current.end=f.second+hop/2;current.pitches.push(pitch);current.sum+=f.confidence;current.count++;
  }
  finish();return notes;
}
export function detectMonophonicV2(samples,sr=22050,options={}){
  const evidence=pitchFrames(samples,sr,options);
  return {...evidence,notes:segmentPitchFrames(evidence.frames,evidence.onsets,{...options,hop:Math.round(sr*.01)/sr})};
}
