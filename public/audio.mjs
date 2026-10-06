import {timeAtBeat} from './time-map.mjs';
export function wavChannels(channels,sampleRate=22050){
  const count=channels.length,length=channels[0].length,size=length*count*2,buffer=new ArrayBuffer(44+size),v=new DataView(buffer);const str=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
  str(0,'RIFF');v.setUint32(4,36+size,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,count,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2*count,true);v.setUint16(32,2*count,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,size,true);
  for(let i=0;i<length;i++)for(let c=0;c<count;c++)v.setInt16(44+(i*count+c)*2,Math.max(-1,Math.min(1,channels[c][i]))*32767,true);return new Uint8Array(buffer);
}
export const wavBytes=(samples,sampleRate=22050)=>wavChannels([samples],sampleRate);
export async function stereoWav(buffer){const rate=22050,ctx=new OfflineAudioContext(2,Math.ceil(buffer.duration*rate),rate),source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);source.start();const out=await ctx.startRendering();return wavChannels([out.getChannelData(0),out.getChannelData(1)],rate);}
export function toDataURL(bytes){let bin='';for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode(...bytes.subarray(i,i+32768));return 'data:audio/wav;base64,'+btoa(bin);}
export async function monoSamples(buffer,start=0,end=buffer.duration,sampleRate=22050){
  const duration=end-start;if(duration<=0)throw Error('结束时间必须晚于开始时间');
  const ctx=new OfflineAudioContext(1,Math.ceil(duration*sampleRate),sampleRate),source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);source.start(0,start,duration);return (await ctx.startRendering()).getChannelData(0);
}
export function synthNote(ctx,destination,midi,when,duration,gain=.25){
  const osc=ctx.createOscillator(),vol=ctx.createGain();osc.type='triangle';osc.frequency.value=440*2**((midi-69)/12);vol.gain.setValueAtTime(0,when);vol.gain.linearRampToValueAtTime(gain,when+Math.min(.012,duration*.25));vol.gain.exponentialRampToValueAtTime(Math.max(.0001,gain*.7),when+duration*.65);vol.gain.linearRampToValueAtTime(0,when+duration);osc.connect(vol);vol.connect(destination);osc.start(when);osc.stop(when+duration+.02);osc.onended=()=>{osc.disconnect();vol.disconnect();};return osc;
}
export async function renderWav(project){const origin=timeAtBeat(project,0),end=project.notes.at(-1)?.start+project.notes.at(-1)?.duration||1,duration=timeAtBeat(project,end)-origin+.25;if(duration>1200)throw Error('WAV 导出最长 20 分钟，请分段导出');const ctx=new OfflineAudioContext(1,Math.ceil(duration*22050),22050);for(const n of project.notes)if(n.midi!==null){const start=timeAtBeat(project,n.start)-origin,seconds=timeAtBeat(project,n.start+n.duration)-timeAtBeat(project,n.start);synthNote(ctx,ctx.destination,n.midi,Math.max(0,start),Math.max(.001,seconds*.94),.35);}return wavBytes((await ctx.startRendering()).getChannelData(0));}
