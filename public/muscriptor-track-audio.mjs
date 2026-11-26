import {synthNote} from './audio.mjs';
import {SYNTH_TIMBRES} from './timbre-catalog.mjs';

const noiseByContext=new WeakMap();
const timbres=new Map(SYNTH_TIMBRES.map(t=>[t.id,t]));
function trackTimbre(name){
  if(/guitar|pluck/.test(name))return timbres.get('pluck');
  if(/voice|wind|flute/.test(name))return timbres.get('flute');
  if(/strings|violin|brass|pad/.test(name))return timbres.get('strings');
  if(/bass/.test(name))return timbres.get('soft');
  return timbres.get('classic');
}

function drum(ctx,destination,pitch,at,gain){
  const kick=pitch===35||pitch===36,hat=[42,44,46,51,53,55,57,59].includes(pitch);
  const ring=[46,49,57].includes(pitch);
  const duration=kick ? .15 : ring ? .24 : hat ? .055 : .13;
  const envelope=ctx.createGain();
  envelope.gain.setValueAtTime(Math.max(gain,.0001),at);
  envelope.gain.exponentialRampToValueAtTime(.0001,at+duration);
  envelope.connect(destination);
  let sound,filter;
  if(kick){
    sound=ctx.createOscillator();
    sound.frequency.setValueAtTime(135,at);
    sound.frequency.exponentialRampToValueAtTime(45,at+.09);
    sound.connect(envelope);
  }else{
    let noise=noiseByContext.get(ctx);
    if(!noise){
      noise=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.25),ctx.sampleRate);
      const samples=noise.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
      noiseByContext.set(ctx,noise);
    }
    sound=ctx.createBufferSource();sound.buffer=noise;
    filter=ctx.createBiquadFilter();filter.type=hat?'highpass':'bandpass';filter.frequency.value=hat?6800:1500;
    sound.connect(filter);filter.connect(envelope);
  }
  sound.onended=()=>{sound.disconnect();filter?.disconnect();envelope.disconnect();};
  sound.start(at);sound.stop(at+duration);
  return {stop(){envelope.disconnect();sound.stop();}};
}

function eventsIn(notes,from,to){
  return notes.filter(n=>n.end>from&&n.start<to&&(n.instrument!=='drums'||n.start>=from));
}

function playMuEvent(ctx,destination,note,when,duration,volume){
  const level=volume*.19;
  return note.instrument==='drums'?drum(ctx,destination,note.midi,when,level):
    synthNote(ctx,destination,note.midi,when,Math.max(.001,duration),level,trackTimbre(note.instrument));
}

export async function renderMuAudition(notes,windows,speed){
  let length=0;
  const excerpts=windows.map(({from,to})=>{
    const start=length,end=start+(to-from)/speed;
    length=end+.3;
    return {from:start,to:end};
  });
  const rate=24000,ctx=new OfflineAudioContext(1,Math.ceil(rate*length),rate);
  for(const [i,{from,to}] of windows.entries()){
    for(const note of eventsIn(notes,from,to)){
      const begin=Math.max(from,note.start),end=Math.min(to,note.end);
      playMuEvent(ctx,ctx.destination,note,excerpts[i].from+(begin-from)/speed,(end-begin)/speed,1);
    }
  }
  return {buffer:await ctx.startRendering(),windows:excerpts};
}

// Keep the audio graph small even when a section spans several minutes.
export function scheduleMuMidi(ctx,notes,{startedAt,position,to,speed,volume,destination=ctx.destination}){
  const events=eventsIn(notes,position,to).sort((a,b)=>a.start-b.start);
  const active=new Map();
  let index=0,stopped=false;
  return {
    tick(){
      if(stopped)return;
      const now=ctx.currentTime;
      for(const [voice,expiry] of active)if(expiry<=now)active.delete(voice);
      while(index<events.length){
        const note=events[index],begin=Math.max(position,note.start),end=Math.min(to,note.end);
        const at=startedAt+(begin-position)/speed,finish=startedAt+(end-position)/speed;
        if(at>now+.24)break;
        index++;
        if(finish<=now)continue;
        const when=Math.max(at,now);
        const voice=playMuEvent(ctx,destination,note,when,finish-when,volume);
        active.set(voice,Math.max(finish,when+.24)+.15);
      }
    },
    stop(){
      stopped=true;
      for(const voice of active.keys())try{voice.stop();}catch{}
      active.clear();
    }
  };
}
