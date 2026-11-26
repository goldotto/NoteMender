import {barLength,keyAt} from './music.mjs';
import {beatAtTime,timeAtBeat} from './time-map.mjs';

const UNIT=16;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
const mod=(x,n)=>((x%n)+n)%n;
const round=value=>Math.round(value*UNIT)/UNIT;
const times=values=>[...new Set((values||[]).filter(t=>Number.isFinite(t)&&t>=0))].sort((a,b)=>a-b);

export function analyseBarPulses(result,meter,manualSeconds,referenceBpm){
  const beats=times(result.beats),downbeats=times(result.downbeats),length=barLength(meter);
  const gaps=beats.slice(1).map((t,i)=>t-beats[i]),period=median(gaps);
  if(beats.length<3||period<.10||period>2.5)return null;
  const pulses=[{index:0,second:beats[0]}];
  for(let i=1;i<beats.length;i++){
    const last=pulses.at(-1),gap=beats[i]-last.second;
    if(gap<period*.36)continue;
    const nearby=gaps.slice(Math.max(0,i-5),i+4).filter(g=>g>=period*.55&&g<=period*1.48);
    const local=median(nearby)||period;
    pulses.push({index:last.index+Math.max(1,Math.min(4,Math.round(gap/local))),second:beats[i]});
  }
  if(pulses.length<3)return null;
  const down=new Set();
  let i=0;
  for(const t of downbeats){
    while(i+1<pulses.length&&Math.abs(pulses[i+1].second-t)<Math.abs(pulses[i].second-t))i++;
    if(Math.abs(pulses[i].second-t)<=Math.min(.12,period*.23))down.add(pulses[i].index);
  }
  const detected=[...down],intervals=detected.slice(1).map((index,i)=>index-detected[i]);
  const modes=meter==='6/8'?[2,6]:[length];
  const counts=[2,3,4,6].map(n=>({n,count:intervals.filter(g=>g===n).length})).sort((a,b)=>b.count-a.count);
  const suggested=counts[0].count>=3&&counts[0].count/intervals.length>=.68?counts[0].n:null;
  const perBar=modes.includes(suggested)?suggested:modes[0];
  const phases=Array.from({length:perBar},(_,phase)=>({phase,count:[...down].filter(k=>mod(k,perBar)===phase).length})).sort((a,b)=>b.count-a.count);
  const automatic=phases[0].count>=4&&phases[0].count/down.size>=.72&&intervals.filter(g=>g===perBar).length/intervals.length>=.60;
  const manual=Number.isFinite(manualSeconds)?pulses.reduce((a,b)=>Math.abs(b.second-manualSeconds)<Math.abs(a.second-manualSeconds)?b:a):null;
  const phase=manual?mod(manual.index,perBar):automatic?phases[0].phase:null;
  const inspect=[];
  let run=[];
  const finishRun=()=>{
    if(run.length>=4)inspect.push({from:run[0].second,to:run.at(-1).second});
    run=[];
  };
  if(automatic&&!manual)for(const p of pulses){
    if(!down.has(p.index))continue;
    const alternate=mod(p.index,perBar);
    if(alternate===phase){finishRun();continue;}
    if(run.length&&(mod(run.at(-1).index,perBar)!==alternate||p.index-run.at(-1).index>perBar*2))finishRun();
    run.push(p);
  }
  finishRun();
  const choices=pulses.map(p=>({...p,downbeat:down.has(p.index)}));
  const fixed=Boolean(manual&&!automatic&&referenceBpm>0&&Number.isFinite(referenceBpm));
  let marks=phase===null?[]:pulses.filter(p=>mod(p.index,perBar)===phase);
  if(fixed){
    const secondsPerBar=60*length/referenceBpm,lastSecond=result.duration||pulses.at(-1).second;
    marks=[];
    for(let i=-Math.floor(manual.second/secondsPerBar);manual.second+i*secondsPerBar<=lastSecond;i++){
      const second=manual.second+i*secondsPerBar;
      marks.push({index:phase+i*perBar,second});
    }
  }
  const map={timeAnchors:marks.map(({index,second})=>({beat:(index-phase)*length/perBar,second}))};
  const marksPerBar=marks.slice(1).map((p,i)=>(p.second-marks[i].second)*perBar/(p.index-marks[i].index));
  return {map,choices,marks,automatic,suggested,perBar,fixed,inspect,bpm:Math.round(60/(median(marksPerBar)||period*perBar)*length*10)/10};
}

// In 6/8, the performer taps the two dotted-quarter pulses of each bar.
export function tappedPulsesPerBar(meter){
  return meter==='6/8'?2:barLength(meter);
}

export function tappedTempo(taps,meter){
  if(taps.length<3)return null;
  const intervals=taps.slice(1).map((second,index)=>second-taps[index]);
  if(intervals.some(interval=>!Number.isFinite(interval)||interval<=0))return null;
  return Math.round(600*barLength(meter)/(tappedPulsesPerBar(meter)*median(intervals)))/10;
}

export function analyseTappedBars(taps,meter,downbeat){
  const bpm=tappedTempo(taps,meter);
  if(bpm===null)return null;
  const perBar=tappedPulsesPerBar(meter),pulse=barLength(meter)/perBar;
  const phase=mod(Math.max(0,taps.indexOf(downbeat)),perBar);
  const map={timeAnchors:taps.map((second,index)=>({beat:(index-phase)*pulse,second}))};
  const choices=taps.map((second,index)=>({index,second,downbeat:mod(index,perBar)===phase}));
  const marks=choices.filter(tap=>tap.downbeat).map(({index,second})=>({index,second}));
  return {map,choices,marks,perBar,bpm,inspect:[]};
}

export function projectOnBarPulses(project,grid){
  if(grid.map.timeAnchors.length<2)return null;
  const notes=project.notes;
  if(!notes.length)return null;
  const pulse=barLength(project.meter)/grid.perBar,map=grid.map;
  const mapBeat=beat=>beatAtTime(map,timeAtBeat(project,beat));
  const first=mapBeat(notes[0].start);
  // Omit complete leading silent bars. Keep the actual pickup and its phase.
  const origin=Math.floor(round(first)/pulse)*pulse,length=barLength(project.meter);
  const pickup=round(mod(-origin,length));
  const timeAnchors=map.timeAnchors.map(a=>({...a,beat:a.beat-origin}));
  const snap=beat=>Math.max(0,round(mapBeat(beat)-origin));
  const result={...project,timeAnchors,offset:timeAtBeat({timeAnchors},0),
    key:keyAt(project,beatAtTime(project,timeAtBeat({timeAnchors},0)))};
  const keyChanges=new Map([[0,{beat:0,key:result.key}]]);
  for(const k of project.keyChanges||[]){
    const beat=snap(k.beat);
    if(beat>0||timeAtBeat(project,k.beat)>=result.offset-1e-7)keyChanges.set(beat,{...k,beat});
  }
  result.keyChanges=[...keyChanges.values()];
  let end=0,maxMs=0;
  result.notes=notes.map(note=>{
    const start=Math.max(end,snap(note.start)),stop=Math.max(start+1/UNIT,snap(note.start+note.duration));
    maxMs=Math.max(maxMs,...[[start,note.start],[stop,note.start+note.duration]].map(([a,b])=>Math.abs(timeAtBeat(result,a)-timeAtBeat(project,b))*1000));
    end=stop;
    return {...note,start,duration:stop-start};
  });
  const barMarkers=grid.marks.map(mark=>({
    second:mark.second,beat:round(beatAtTime(map,mark.second)-origin)
  }));
  return {project:result,pickup,maxMs,barMarkers};
}
