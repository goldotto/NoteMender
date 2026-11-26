const ceiling=.8;
const maxMidiBoost=16;
const targetRms=10**(-19/20);
const absoluteGate=1e-6;

// Two frequency-weighting stages for A/B loudness, with coefficients computed
// at the buffer's sample rate. This meter is for audition gain, not delivery QC.
function filters(rate){
  const shelf=1560,boost=10**(4/20),a=Math.sqrt(boost),q=.707;
  const k=Math.tan(Math.PI*shelf/rate),k2=k*k,norm=1+k/q+k2;
  const high=[(boost+a*k/q+k2)/norm,2*(k2-boost)/norm,(boost-a*k/q+k2)/norm,
    2*(k2-1)/norm,(1-k/q+k2)/norm];
  const w=Math.tan(Math.PI*38/rate),w2=w*w,d=1+w/.5+w2;
  return [high,[1/d,-2/d,1/d,2*(w2-1)/d,(1-w/.5+w2)/d]];
}

export function measureAudition(buffer,ranges){
  const rate=buffer.sampleRate,count=Math.min(2,buffer.numberOfChannels),coeff=filters(rate);
  const chunkSize=Math.max(1,Math.round(rate*.1)),blocks=[];
  let peak=0;
  for(const {from,to} of ranges){
    const start=Math.max(0,Math.round(from*rate)),end=Math.min(buffer.length,Math.round(to*rate));
    if(end<=start)continue;
    const chunks=new Float64Array(Math.ceil((end-start)/chunkSize));
    for(let channel=0;channel<count;channel++){
      const data=buffer.getChannelData(channel);
      const [[b0,b1,b2,a1,a2],[c0,c1,c2,d1,d2]]=coeff;
      let s1=0,s2=0,t1=0,t2=0;
      for(let at=start;at<end;at+=chunkSize){
        let energy=0;
        for(let i=at;i<Math.min(end,at+chunkSize);i++){
          const x=data[i],y=b0*x+s1,z=c0*y+t1;
          s1=b1*x-a1*y+s2;s2=b2*x-a2*y;
          t1=c1*y-d1*z+t2;t2=c2*y-d2*z;
          peak=Math.max(peak,Math.abs(x));energy+=z*z;
        }
        chunks[(at-start)/chunkSize]+=energy;
      }
    }
    const window=Math.min(4,chunks.length);
    for(let i=0;i+window<=chunks.length;i++){
      const length=Math.min(end-start-i*chunkSize,window*chunkSize);
      if(i&&length<window*chunkSize)break;
      let energy=0;for(let j=i;j<i+window;j++)energy+=chunks[j];
      blocks.push(energy/(length*count));
    }
  }
  const meanAbove=gate=>{
    let sum=0,n=0;
    for(const energy of blocks)if(energy>gate){sum+=energy;n++;}
    return n?sum/n:0;
  };
  return {rms:Math.sqrt(meanAbove(Math.max(absoluteGate,meanAbove(absoluteGate)*.1))),peak};
}

export function matchedAuditionLevels(original,midi){
  if(!(original?.rms>0&&midi?.rms>0))return {original:1,midi:1};
  // Share a reachable target. A soft solo may require lowering the mix as well
  // as boosting MIDI, especially when the rendered chords have sharp peaks.
  const target=Math.min(targetRms,original.rms,midi.rms*maxMidiBoost,
    ceiling*original.rms/original.peak,ceiling*midi.rms/midi.peak);
  return {original:target/original.rms,midi:target/midi.rms};
}

export function auditionWindows(notes,{from,to},speed){
  const occupied=[];
  for(const {start,end} of [...notes].sort((a,b)=>a.start-b.start)){
    const a=Math.max(from,start),b=Math.min(to,end);
    if(b<=a)continue;
    const previous=occupied.at(-1);
    if(previous&&a<=previous.to)previous.to=Math.max(previous.to,b);
    else occupied.push({from:a,to:b});
  }
  const duration=occupied.reduce((sum,n)=>sum+n.to-n.from,0);
  const width=Math.min(to-from,Math.max(.75,Math.min(3,2.2*speed)));
  if(!duration||width<=0)return [];
  const excerpts=[];
  for(const fraction of [1/6,.5,5/6]){
    let offset=duration*fraction;
    const active=occupied.find(n=>{const span=n.to-n.from;if(offset<span)return true;offset-=span;return false;});
    const start=Math.max(from,Math.min(to-width,active.from+offset-width/2));
    const previous=excerpts.at(-1);
    if(previous&&start<=previous.to)previous.to=Math.max(previous.to,start+width);
    else excerpts.push({from:start,to:start+width});
  }
  return excerpts;
}

export function createAuditionMatcher(renderMidi){
  const byBuffer=new WeakMap();
  return (buffer,roll,speed)=>{
    if(!buffer||!roll.notes.length)return Promise.resolve(matchedAuditionLevels());
    let byRange=byBuffer.get(buffer);
    if(!byRange){byRange=new WeakMap();byBuffer.set(buffer,byRange);}
    let mixes=byRange.get(roll.range);
    if(!mixes){mixes=new Map();byRange.set(roll.range,mixes);}
    const key=JSON.stringify([roll.mixKey,speed]);
    if(!mixes.has(key)){
      const pending=(async()=>{
        const windows=auditionWindows(roll.notes,{from:roll.range.from,to:Math.min(roll.range.to,buffer.duration)},speed);
        if(!windows.length)return matchedAuditionLevels();
        const rendered=await renderMidi(roll.notes,windows,speed);
        return matchedAuditionLevels(measureAudition(buffer,windows),measureAudition(rendered.buffer,rendered.windows));
      })().catch(()=>{
        if(mixes.get(key)===pending)mixes.delete(key);
        return matchedAuditionLevels();
      });
      mixes.set(key,pending);
      if(mixes.size>12)mixes.delete(mixes.keys().next().value);
    }
    return mixes.get(key);
  };
}

const peakCurve=Float32Array.from({length:2049},(_,i)=>{
  const x=(i-1024)/1024,peak=Math.abs(x);
  if(peak<=ceiling)return x;
  return Math.sign(x)*(ceiling+.15*(1-((1-peak)/(1-ceiling))**(4/3)));
});
export function auditionOutput(context,gain){
  const input=context.createGain(),limiter=context.createWaveShaper();
  input.gain.value=gain;
  limiter.curve=peakCurve;
  input.connect(limiter);
  limiter.connect(context.destination);
  return {input,stop(){input.disconnect();limiter.disconnect();}};
}
