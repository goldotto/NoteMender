let registration;const latencyCache=new Map();
export async function prepareAudioPlayback(context){
  registration ||= import('/vendor/slow-audio.js').then(async m=>{await m.SoundTouchNode.register(context,'/vendor/soundtouch-processor.js');return m;}).catch(e=>{registration=null;throw e;});
  return {...await registration,playbackLatency};
}
export async function playbackLatency(context,speed){
  if(speed===1)return 0;
  const key=context.sampleRate+':'+speed;if(latencyCache.has(key))return latencyCache.get(key);
  const {SoundTouch}=await import('/vendor/slow-audio.js'),pipe=new SoundTouch({sampleRate:context.sampleRate});pipe.pitch=1/speed;
  const input=new Float32Array(256),output=new Float32Array(256);let gapFrames=0;
  for(let block=0;block<500;block++){
    pipe.inputBuffer.putSamples(input,0,128);pipe.process();const count=Math.min(128,pipe.outputBuffer.frameCount);
    pipe.outputBuffer.extract(output,0,count);pipe.outputBuffer.receive(count);gapFrames+=128-count;
  }
  const latency=gapFrames/context.sampleRate;latencyCache.set(key,latency);return latency;
}
export async function createAudioPlayback(context,buffer,{when,offset=0,duration,speed=1,gain=1}){
  const source=context.createBufferSource(),level=context.createGain();source.buffer=buffer;level.gain.value=gain;level.connect(context.destination);
  let worklet=null,quiet=null;const latency=await playbackLatency(context,speed);
  if(speed!==1){const {SoundTouchNode}=await prepareAudioPlayback(context);worklet=new SoundTouchNode({context});worklet.playbackRate.value=speed;worklet.pitch.value=1;source.playbackRate.value=speed;source.connect(worklet);worklet.connect(level);quiet=context.createBufferSource();quiet.buffer=context.createBuffer(1,128,context.sampleRate);quiet.loop=true;quiet.connect(worklet);quiet.start(when);}else source.connect(level);
  let stopped=false;
  const disconnect=()=>{source.disconnect();if(quiet){try{quiet.stop();}catch{}quiet.disconnect();}worklet?.disconnect();level.disconnect();};
  source.onended=()=>{if(speed===1)disconnect();};
  source.start(when,offset,duration);
  // Keep the processor tail alive until the audible end; stop/seek always discards it.
  const cleanup=setTimeout(disconnect,Math.max(0,(when-context.currentTime+duration/speed+.5)*1000));
  return {latency,stop(){if(stopped)return;stopped=true;clearTimeout(cleanup);try{source.stop();}catch{}disconnect();}};
}
