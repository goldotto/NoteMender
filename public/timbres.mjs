import {SYNTH_TIMBRES,timbreId,sampleSpec} from './timbre-catalog.mjs';
let cachedBank=null;const voices=new Set();
// Match the quiet rendered samples to the synth without amplifying silent banks
// or exceeding the source peak headroom. Shared by live and offline rendering.
export function samplePlaybackGain(buffer){
  if(!buffer?.getChannelData||!buffer.sampleRate||!buffer.numberOfChannels)return 1;
  const window=Math.max(1,Math.round(buffer.sampleRate*.05));let peak=0,rms=0;
  for(let c=0;c<buffer.numberOfChannels;c++){
    const data=buffer.getChannelData(c);for(const value of data)peak=Math.max(peak,Math.abs(value));
    for(let at=0;at<Math.min(data.length,buffer.sampleRate*.75);at+=window){let sum=0;const end=Math.min(data.length,at+window);for(let i=at;i<end;i++)sum+=data[i]*data[i];rms=Math.max(rms,Math.sqrt(sum/Math.max(1,end-at)));}
  }
  if(peak<1e-5||rms<1e-6)return 1;
  return Math.min(32,.28/rms,.9/peak);
}
export function stopTimbreVoices(){for(const voice of [...voices])voice.stop();}
export async function prepareTimbre(context,value,midis=[],request){
  const id=timbreId(value);if(!id.startsWith('sample-'))return SYNTH_TIMBRES.find(t=>t.id===id);
  const spec=sampleSpec(id.slice(7));
  if(cachedBank?.id!==id){const bank=await request(spec.id);cachedBank={id,spec,bank,buffers:new Map(),gains:new Map()};}
  const current=cachedBank;
  for(const midi of new Set(midis.filter(m=>Number.isInteger(m)))){
    if(current.buffers.has(midi))continue;
    const url=current.bank[midi];if(!url)throw Error(`采样音色缺少 MIDI ${midi}，请重新检查组件。`);
    const bin=atob(url.split(',')[1]),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0)),buffer=await context.decodeAudioData(bytes.buffer);current.buffers.set(midi,buffer);current.gains.set(midi,samplePlaybackGain(buffer));
  }
  return {id,spec,buffers:current.buffers,gains:current.gains};
}
export function makeTimbreNote(ctx,destination,midi,when,duration,gain=.25,timbre=SYNTH_TIMBRES[0]){
  gain*=timbre.gains?.get(midi)??1;
  when=Math.max(ctx.currentTime||0,when);duration=Math.max(.001,duration);const level=ctx.createGain(),nodes=[];let cleaned=false;
  const release=timbre.release??.025,attack=Math.min(timbre.attack??.008,duration*.25),end=when+duration;
  level.gain.setValueAtTime(0,when);level.gain.linearRampToValueAtTime(gain,when+attack);
  level.gain.exponentialRampToValueAtTime(Math.max(.0001,gain*(timbre.decay??.8)),when+Math.max(attack,duration*.65));level.gain.linearRampToValueAtTime(0,end);level.connect(destination);
  const cleanup=()=>{if(cleaned)return;cleaned=true;for(const node of nodes)node.disconnect();level.disconnect();voices.delete(handle);};
  const handle={stop(){for(const node of nodes)try{node.stop();}catch{}cleanup();}};if(typeof ctx.startRendering!=='function')voices.add(handle);
  if(timbre.buffers){const source=ctx.createBufferSource();source.buffer=timbre.buffers.get(midi);if(!source.buffer){cleanup();throw Error('音色尚未加载，请重新试听。');}if(timbre.spec.sustain&&source.buffer.duration>.4){source.loop=true;source.loopStart=source.buffer.duration*.35;source.loopEnd=source.buffer.duration*.85;}nodes.push(source);source.connect(level);source.onended=cleanup;source.start(when);source.stop(end+release);}
  else{const osc=ctx.createOscillator();if(timbre.harmonics){const real=new Float32Array(timbre.harmonics.length+1),imag=new Float32Array(real.length);imag.set(timbre.harmonics,1);osc.setPeriodicWave(ctx.createPeriodicWave(real,imag));}else osc.type=timbre.wave||'triangle';osc.frequency.value=440*2**((midi-69)/12);nodes.push(osc);osc.connect(level);osc.onended=cleanup;osc.start(when);osc.stop(end+release);}
  return handle;
}
