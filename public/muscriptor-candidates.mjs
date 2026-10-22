import {EDIT_STEP,uid,snap} from './music.mjs';
import {beatAtTime} from './time-map.mjs';

// MuScriptor predicts instrument families, not separated audio stems.
// Preserve all polyphony in the service result/MIDI; the score is explicitly monophonic.
export function muMelody(notes,voice='continuous'){
  // Small onset jitter in a chord must not turn its pitches into a rapid arpeggio.
  // Repeated pitches remain separate even inside this tolerance.
  const groups=[];for(const n of [...notes].sort((a,b)=>a.start-b.start||a.midi-b.midi)){
    const group=groups.at(-1);if(group&&n.start-group[0].start<=.025&&group.every(p=>p.end>n.start+.002)&&!group.some(p=>p.midi===n.midi))group.push(n);else groups.push([n]);
  }
  if(!groups.length)return [];
  let selected;
  if(voice==='high'||voice==='low')selected=groups.map(group=>group.reduce((a,b)=>voice==='high'?(a.midi>b.midi?a:b):(a.midi<b.midi?a:b)));
  else{
    // Choose continuity across the whole phrase, without anchoring every song
    // to MIDI 60. This is only a score reduction; raw polyphonic MIDI is intact.
    const costs=[],parents=[];
    for(let i=0;i<groups.length;i++){
      const group=groups[i],prior=groups[i-1];costs[i]=[];parents[i]=[];
      for(let j=0;j<group.length;j++){
        const note=group[j],local=-Math.min(1,note.end-note.start)*.2;
        if(!i){costs[i][j]=local;parents[i][j]=-1;continue;}
        let best=Infinity,index=0;for(let k=0;k<prior.length;k++){
          const gap=note.start-prior[k].end,step=Math.abs(note.midi-prior[k].midi),cost=costs[i-1][k]+(gap>1?0:step+Math.max(0,step-12)*.5)+local;
          if(cost<best){best=cost;index=k;}
        }costs[i][j]=best;parents[i][j]=index;
      }
    }
    selected=new Array(groups.length);let index=costs.at(-1).indexOf(Math.min(...costs.at(-1)));for(let i=groups.length-1;i>=0;i--){selected[i]=groups[i][index];index=parents[i][index];}
  }
  const chosen=[];for(const value of selected){const n={...value};if(chosen.length&&chosen.at(-1).end>n.start)chosen.at(-1).end=n.start;if(n.end>n.start)chosen.push(n);}return chosen.filter(n=>n.end>n.start);
}
export function muScoreNotes(raw,base,origin,{minMidi=21,maxMidi=108}={}){
  const notes=[];let gridCollisions=0,outOfRange=0;
  for(const n of raw){
    if(n.midi<minMidi||n.midi>maxMidi){outOfRange++;continue;}
    const start=Math.max(0,snap(beatAtTime(base,n.start+origin),EDIT_STEP)),end=Math.max(start+EDIT_STEP,snap(beatAtTime(base,n.end+origin),EDIT_STEP));
    if(start>14400-EDIT_STEP){outOfRange++;continue;}
    if(notes.length){const previous=notes.at(-1);if(previous.start>=start-1e-6){gridCollisions++;continue;}previous.duration=Math.min(previous.duration,start-previous.start);}
    for(let at=start;at<Math.min(end,14400)-1e-6;at+=128)notes.push({id:uid(),start:at,duration:Math.min(128,end-at,14400-at),midi:n.midi,confidence:.5,lyric:'',reviewFlags:['MuScriptor 单旋律待听审']});
  }return {notes,gridCollisions,outOfRange};
}
export function muscriptorCandidates(result,base,origin,sectionId,options={}){
  const families=[...new Set(result.notes.filter(n=>n.instrument!=='drums').map(n=>n.instrument))].sort((a,b)=>Number(b==='voice')-Number(a==='voice')||a.localeCompare(b));
  const variants=[],warnings=[];
  for(const family of families){
    const group=result.notes.filter(n=>n.instrument===family);
    for(const [voice,label] of [['continuous','连续声部'],['high','高声部'],['low','低声部']]){
      const converted=muScoreNotes(muMelody(group,voice),base,origin,options);if(!converted.notes.length)continue;
      if(converted.notes.length>12000)throw Error('单份 MuScriptor 候选超过工程上限，请缩短识别范围；原始 MIDI 已保留');
      if(converted.gridCollisions||converted.outOfRange)warnings.push(`${family} ${label}：${converted.gridCollisions} 个音的起点落在同一编辑网格，${converted.outOfRange} 个音超出所选音域；原始 MIDI 保留全部输出。`);
      variants.push({id:uid(),sectionId,source:'original',method:`MuScriptor large · ${family} · ${label}`,model:'muscriptor-0.3.0-large',instrument:family,analysisId:result.analysisId,audioStart:origin,audioEnd:origin+result.duration,notes:converted.notes,lyrics:[]});
    }
  }
  return {variants,warnings:[...new Set(warnings)]};
}
