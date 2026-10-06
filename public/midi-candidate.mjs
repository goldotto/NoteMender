import {clamp,estimateKey,makeDemo,snap,uid,validateProject} from './music.mjs';

// Keep MIDI ticks and tempo changes until the editable, single-line score is built.
export function projectFromMidiTrack(midi,trackIndex,{title,sourceName='',strategy='smooth'}={}){
  const track=midi.tracks?.[trackIndex],header=midi.header,ppq=header?.ppq;
  if(!track||track.instrument?.percussion||!track.notes?.length||!Number.isFinite(ppq)||ppq<=0)throw Error('请选择有音符的非打击乐 MIDI 轨道');
  if(typeof header.ticksToSeconds!=='function')throw Error('MIDI 缺少可用的速度时间信息');
  const source=track.notes.filter(n=>Number.isInteger(n.midi)&&n.midi>=21&&n.midi<=108&&Number.isFinite(n.ticks)&&Number.isFinite(n.durationTicks)&&n.ticks>=0&&n.durationTicks>0);
  if(!source.length)throw Error('所选轨道没有可用的旋律音符');
  const events=source.map(n=>({start:snap(n.ticks/ppq),end:snap((n.ticks+n.durationTicks)/ppq),midi:n.midi,velocity:clamp(n.velocity??.7,0,1)})).map(n=>({...n,end:Math.max(n.start+.25,n.end)})).sort((a,b)=>a.start-b.start||b.velocity-a.velocity);
  const notes=[];
  for(const e of events){
    if(notes.length&&e.start<notes.at(-1).start+notes.at(-1).duration){
      const prev=notes.at(-1);
      if(e.start===prev.start){
        const older=notes.at(-2);
        const score=n=>n.velocity*2-(older?Math.min(Math.abs(n.midi-older.midi),24)*.05:0);
        const replace=strategy==='highest'?e.midi>prev.midi:strategy==='smooth'?score(e)>score(prev):e.velocity>prev.velocity;
        if(replace)notes.pop();else continue;
      }else prev.duration=e.start-prev.start;
    }
    notes.push({id:uid(),start:e.start,duration:Math.min(128,e.end-e.start),midi:e.midi,confidence:.5,reviewStatus:'pending',lyric:'',velocity:e.velocity});
  }
  const lastBeat=Math.max(1,notes.at(-1).start+notes.at(-1).duration);
  const points=[{beat:0,second:0}];
  for(const tempo of [...(header.tempos||[])].sort((a,b)=>a.ticks-b.ticks)){
    const beat=tempo.ticks/ppq,second=header.ticksToSeconds(tempo.ticks);
    if(beat>0&&beat<lastBeat&&beat>points.at(-1).beat&&second>points.at(-1).second)points.push({beat,second});
  }
  const endSecond=header.ticksToSeconds(lastBeat*ppq);
  if(!Number.isFinite(endSecond)||endSecond<=points.at(-1).second)throw Error('MIDI 速度信息无效');
  points.push({beat:lastBeat,second:endSecond});
  const firstTempo=header.tempos?.find(t=>t.ticks===0)?.bpm||120;
  const signature=header.timeSignatures?.[0]?.timeSignature?.join('/')||'4/4';
  return validateProject({...makeDemo(),title:title||midi.name||track.name||'MIDI 旋律',sourceName,bpm:clamp(Math.round(firstTempo),30,300),meter:['2/4','3/4','4/4','6/8'].includes(signature)?signature:'4/4',offset:0,timeAnchors:points,notes:notes.map(({velocity,...n})=>n),key:estimateKey(notes),engine:'MIDI 旋律轨候选'});
}
