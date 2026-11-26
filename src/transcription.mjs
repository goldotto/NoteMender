// Reduce Basic Pitch's polyphonic events to one voice. This is a heuristic, not source separation.
export function selectMelody(notes,{minMidi=45,maxMidi=88,strategy='smooth'}={}){
  const candidates=notes.filter(n=>n.midi>=minMidi&&n.midi<=maxMidi&&n.end-n.start>=.07);
  if(!candidates.length)return [];
  const times=[...new Set(candidates.flatMap(n=>[n.start,n.end]))].sort((a,b)=>a-b);
  const slices=[];let previous=null;
  for(let i=0;i<times.length-1;i++){
    const t=times[i],end=times[i+1],active=candidates.filter(n=>n.start<=t+.00001&&n.end>=end-.00001);
    let chosen=null,best=-Infinity;
    for(const n of active){let score=(n.confidence||.3)*2;
      if(strategy==='highest')score+=n.midi*.15;
      else if(strategy==='smooth'&&previous!==null)score-=Math.min(Math.abs(n.midi-previous),24)*.045;
      if(score>best){best=score;chosen=n;}
    }
    if(chosen){previous=chosen.midi;const last=slices.at(-1);
      if(last&&last.midi===chosen.midi&&Math.abs(last.end-t)<.005&&chosen.start<t-.001){last.end=end;last.confidence=Math.min(last.confidence,chosen.confidence);}
      else slices.push({start:t,end,midi:chosen.midi,confidence:Math.min(chosen.confidence??.5,active.length>1?.58:.95)});
    }else previous=null;
  }
  return slices.filter(n=>n.end-n.start>=.07);
}
export function estimateTempo(samples,sampleRate=22050){
  const hop=220,envelope=[];let last=0;
  for(let i=0;i<samples.length;i+=hop){let e=0;for(let j=i;j<Math.min(i+hop,samples.length);j++)e+=samples[j]*samples[j];e=Math.sqrt(e/hop);envelope.push(Math.max(0,e-last));last=e;}
  const rate=sampleRate/hop;let best=0,bpm=120;
  for(let tempo=60;tempo<=180;tempo++){const lag=Math.round(rate*60/tempo);let score=0;for(let i=lag;i<envelope.length;i++)score+=envelope[i]*envelope[i-lag];score*=1-.12*Math.abs(tempo-110)/110;if(score>best){best=score;bpm=tempo;}}
  return bpm;
}
