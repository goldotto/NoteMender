import {evaluateNoteEvents} from './evaluation.mjs';
export function evaluateF0(reference,events){
  let voiced=0,detected=0,correct=0,octave=0,falseVoiced=0,unvoiced=0;
  for(const [second,hz] of reference){
    const note=events.find(n=>n.start<=second&&n.end>second),pitch=hz>0?69+12*Math.log2(hz/440):null;
    if(pitch!==null){voiced++;if(note){detected++;const delta=Math.abs(note.midi-pitch);if(delta<=.5)correct++;if(Math.abs(delta-12)<=.5)octave++;}}
    else{unvoiced++;if(note)falseVoiced++;}
  }
  return {voicedFrames:voiced,detectedFrames:detected,correctFrames:correct,octaveFrames:octave,falseVoicedFrames:falseVoiced,rawPitchAccuracy:voiced?correct/voiced:null,voicingRecall:voiced?detected/voiced:null,falseVoicingRate:unvoiced?falseVoiced/unvoiced:null};
}
export function evaluateF0Frames(reference,frames,{maxDistance=.02,uncertain=[]}={}){
  const sorted=[...frames].sort((a,b)=>a.second-b.second);let index=0;
  let voiced=0,detected=0,correct=0,octave=0,falseVoiced=0,unvoiced=0,excluded=0;
  for(const [second,hz] of [...reference].sort((a,b)=>a[0]-b[0])){
    if(uncertain.some(r=>second>=r.start&&second<r.end)){excluded++;continue;}
    while(index<sorted.length-1&&sorted[index+1].second<=second)index++;
    const frame=[sorted[index],sorted[index+1]].filter(Boolean).sort((a,b)=>Math.abs(a.second-second)-Math.abs(b.second-second))[0];
    const active=frame&&Math.abs(frame.second-second)<=maxDistance&&frame.voiced&&Number.isFinite(frame.hz)&&frame.hz>0;
    if(hz>0){voiced++;if(active){detected++;const delta=Math.abs(12*Math.log2(frame.hz/hz));if(delta<=.5)correct++;if(Math.abs(delta-12)<=.5)octave++;}}
    else{unvoiced++;if(active)falseVoiced++;}
  }
  return {voicedFrames:voiced,detectedFrames:detected,correctFrames:correct,octaveFrames:octave,falseVoicedFrames:falseVoiced,excludedFrames:excluded,rawPitchAccuracy:voiced?correct/voiced:null,voicingRecall:voiced?detected/voiced:null,falseVoicingRate:unvoiced?falseVoiced/unvoiced:null};
}
export function scoreReviewedSample(reference,events){
  if(reference?.status!=='confirmed')return {status:'pending',metrics:null};
  if(!Array.isArray(reference.notes)||reference.notes.some(n=>!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.end<=n.start||!Number.isInteger(n.midi)))throw Error('人工标注包含无效音符');
  if(events.some(n=>!Number.isFinite(n.start)||!Number.isFinite(n.end)||n.end<=n.start||!Number.isInteger(n.midi)))throw Error('识别结果包含无效音符');
  const uncertain=reference.uncertain||[],included=n=>!uncertain.some(r=>n.end>r.start&&n.start<r.end);
  const truth=(reference.notes||[]).filter(included),found=events.filter(included),metrics=evaluateNoteEvents(truth,found);
  return {status:'confirmed',excludedReference:(reference.notes||[]).length-truth.length,excludedCandidate:events.length-found.length,metrics};
}
export function acceptance(rows,{targetGroup='local-2',requiredProfiles=['corrected']}={}){
  const groups=[...new Set(rows.map(r=>r.group))],comparisons=[];let pending=false,failed=false;
  for(const group of groups){
    for(const sampleId of [...new Set(rows.filter(r=>r.group===group).map(r=>r.sampleId))]){
      const samples=rows.filter(r=>r.sampleId===sampleId),baseline=samples.find(r=>r.profile==='legacy');
      if(!baseline||requiredProfiles.some(profile=>!samples.some(r=>r.profile===profile&&r.ablation==='none')))pending=true;
      for(const candidate of samples.filter(r=>r.profile!=='legacy'&&r.ablation==='none')){
        if(!baseline?.notes?.metrics||!candidate.notes?.metrics){pending=true;comparisons.push({sampleId,profile:candidate.profile,status:'pending'});continue;}
        const a=baseline.notes.metrics,b=candidate.notes.metrics;
        const timingOk=['onsetErrorMs','offsetErrorMs'].every(key=>!Number.isFinite(a[key])||(Number.isFinite(b[key])&&b[key]<=a[key]));
        const ok=b.missed<=a.missed&&b.wrongPitch<=a.wrongPitch&&b.octaveErrors<=a.octaveErrors&&b.extra<=a.extra&&timingOk;
        if(!ok)failed=true;comparisons.push({sampleId,group,profile:candidate.profile,status:ok?'pass':'fail',missedReduction:a.missed-b.missed});
      }
    }
  }
  // This is the objective gate only. A human listening sign-off is still required.
  const target=rows.filter(r=>r.group===targetGroup),reductions=Object.fromEntries(requiredProfiles.map(profile=>[profile,comparisons.filter(c=>c.group===targetGroup&&c.profile===profile&&c.status!=='pending').reduce((sum,c)=>sum+c.missedReduction,0)]));
  if(!target.length)pending=true;
  if(!pending&&requiredProfiles.some(profile=>reductions[profile]<=0))failed=true;
  return {status:failed?'fail':!comparisons.length||pending?'pending':'objective-pass',requiresListening:true,targetGroup,missedReduction:reductions,comparisons};
}
