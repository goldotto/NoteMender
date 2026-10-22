// All matching and boundary decisions happen in original audio seconds.
// Text does not supply pitches. Quantization only transports established links.
const overlap=(a,b)=>Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
const ordered=list=>[...list].sort((a,b)=>(a.start??Infinity)-(b.start??Infinity));
export function timedWords(tokens){
  let lastEnd=-Infinity;
  return ordered(tokens).map(t=>{
    const valid=Number.isFinite(t.start)&&Number.isFinite(t.end)&&t.start>=0&&t.end>t.start&&(t.reviewed||t.alignmentScore!==0)&&t.start>=lastEnd-.001;
    if(valid)lastEnd=t.end;
    return {...t,alignmentIssue:valid?'':t.start===null?'未定位':'字词时间无效或重叠',valid};
  });
}
export function assistNoteBoundaries(events,tokens,{onsets=[],pitchFrames=[],proposals=[]}={}){
  const words=timedWords(tokens),valid=words.filter(t=>t.valid),decisions=[],notes=[];
  const attacks=onsets.filter(o=>Number.isFinite(o.second)&&(o.confidence??0)>=.5);
  // Model boundaries are proposals only; they need independent acoustic evidence.
  for(const n of proposals)if((n.onsetConfidence??0)>=.5)attacks.push({second:n.start,confidence:n.onsetConfidence,source:'model-onset'});
  for(const [index,event] of ordered(events).entries()){
    const base={...event,evidenceId:event.evidenceId||`lyric-event-${index}-${event.start}-${event.end}`},cuts=[];
    for(const word of valid){
      if(word.start<=base.start+.03||word.start>=base.end-.03)continue;
      const attack=attacks.filter(o=>Math.abs(o.second-word.start)<=.12&&o.second>base.start+.03&&o.second<base.end-.03).sort((a,b)=>Math.abs(a.second-word.start)-Math.abs(b.second-word.start))[0];
      if(attack&&!cuts.some(c=>Math.abs(c.second-attack.second)<.03))cuts.push({...attack,lyricId:word.id});
    }
    const points=[base.start,...cuts.sort((a,b)=>a.second-b.second).map(c=>c.second),base.end];
    for(let i=0;i<points.length-1;i++){
      const note={...base,start:points[i],end:points[i+1],...(cuts.length?{lyricBoundary:true}:{}),evidenceId:cuts.length?base.evidenceId+`-part-${i}`:base.evidenceId};
      // Trim a trailing held candidate only when the audio really becomes unvoiced.
      const lastWord=valid.filter(w=>overlap(w,note)>0).at(-1);
      if(lastWord&&!valid.some(w=>w.start>=lastWord.end&&w.start<note.end)){
        const frames=pitchFrames.filter(f=>f.second>=lastWord.end-.12&&f.second<note.end).sort((a,b)=>a.second-b.second);
        const energy=pitchFrames.filter(f=>f.second>=note.start&&f.second<lastWord.end&&f.voiced===true&&Number.isFinite(f.rms)).map(f=>f.rms).sort((a,b)=>a-b),floor=energy.length?Math.max(.00001,energy[Math.floor(energy.length/2)]*.25):null;
        const quiet=f=>f.voiced===false&&floor!==null&&Number.isFinite(f.rms)&&f.rms<=floor;
        const pause=frames.find((f,j)=>quiet(f)&&j>0&&frames[j-1].voiced===true&&Math.abs(f.second-lastWord.end)<=.12&&frames.filter(g=>g.second>=f.second&&g.second<f.second+.08).length>=4&&frames.some(g=>g.second>=f.second+.06&&g.second<f.second+.08)&&frames.filter(g=>g.second>=f.second&&g.second<f.second+.08).every(quiet));
        if(pause&&pause.second>note.start+.03&&note.end-pause.second>.03){decisions.push({kind:'歌词辅助收音',second:pause.second,end:note.end,evidenceId:note.evidenceId,lyricId:lastWord.id,reason:'字词末尾与音频停顿一致'});note.end=pause.second;note.lyricBoundary=true;}
      }
      notes.push(note);
    }
    for(const cut of cuts)decisions.push({kind:'歌词辅助重新起唱',second:cut.second,evidenceId:base.evidenceId,lyricId:cut.lyricId,reason:'字词边界附近存在独立起音证据'});
  }
  const linked=linkRawLyrics(notes,words);
  return {events:notes,lyrics:linked,decisions,changed:decisions.length>0};
}
export function lyricSegmentationCandidates(events,tokens,evidence,{resplit=false}={}){
  const auxiliary=assistNoteBoundaries(events,tokens,evidence);
  // Automatic generation keeps acoustic notes intact. Boundary changes are a
  // separate candidate, except when the user explicitly asks to resplit a phrase.
  const primary=resplit?auxiliary.events:events.map(n=>({...n}));
  return {primary,lyrics:linkRawLyrics(primary,tokens),auxiliary,changed:resplit&&auxiliary.changed};
}
export function useLyricSinging(task,{ready,hasWords}){
  return Boolean(ready&&task.singingFine&&task.execution.device!=='cpu'&&hasWords);
}
export function linkRawLyrics(events,tokens){
  const notes=ordered(events).filter(n=>Number.isInteger(n.midi));let floor=-1;
  return timedWords(tokens).map(t=>{
    if(!t.valid)return {...t,noteIds:[],evidenceIds:[]};
    const matches=notes.flatMap((n,i)=>{
      if(i<floor)return [];
      const amount=overlap(n,t),known=n.lyricIds?.includes(t.id);
      return amount>=.01&&(known||amount>=Math.min((t.end-t.start)*.2,(n.end-n.start)*.5))?[{id:n.evidenceId,i}]:[];
    });
    if(matches.length)floor=matches.at(-1).i;
    return {...t,noteIds:[],evidenceIds:matches.map(n=>n.id).filter(Boolean),alignmentIssue:matches.length?'':'未找到可靠音符对应'};
  });
}
export function lyricsAfterQuantization(tokens,trace,notes){
  const available=new Set(notes.map(n=>n.id)),mapping=new Map();
  for(const row of trace||[])if(available.has(row.noteId)){const ids=mapping.get(row.evidenceId)||[];ids.push(row.noteId);mapping.set(row.evidenceId,ids);}
  return tokens.map(t=>{const noteIds=[...new Set((t.evidenceIds||[]).flatMap(id=>mapping.get(id)||[]))];
    const {valid,...token}=t;return {...token,noteIds,alignmentIssue:noteIds.length?'':t.alignmentIssue||'量化后未保留对应音符'};
  });
}
export function lyricPhrase(tokens,chosen,{gap=.6}={}){
  if(!chosen||!Number.isFinite(chosen.start)||!Number.isFinite(chosen.end))throw Error('先给所选字词定位');
  const list=ordered(tokens).filter(t=>Number.isFinite(t.start)&&Number.isFinite(t.end));let a=list.findIndex(t=>t.id===chosen.id),b=a;
  if(a<0)throw Error('所选字词不存在');
  // Manually imported sentences already represent the whole requested phrase.
  if(!['txt','lrc'].includes(chosen.source)){
    while(a>0&&list[a].start-list[a-1].end<=gap&&list[b].end-list[a-1].start<=20)a--;
    while(b+1<list.length&&list[b+1].start-list[b].end<=gap&&list[b+1].end-list[a].start<=20)b++;
  }
  return {from:list[a].start,to:list[b].end,tokens:list.slice(a,b+1),text:list.slice(a,b+1).map(t=>t.text).join(['zh','yue','ja'].includes(chosen.language)?'':' '),language:chosen.language};
}
export function splitLyricWord(tokens,id,{at,left,right},events){
  const token=tokens.find(t=>t.id===id);
  if(!token||!Number.isFinite(token.start)||!Number.isFinite(token.end)||!Number.isFinite(at)||at<token.start+.02||at>token.end-.02||!String(left).trim()||!String(right).trim())throw Error('拆分需填写两边文字，时间须在字词内部，两边至少0.02秒');
  const parts=[{...token,text:left,end:at},{...token,id:globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2),text:right,start:at}].map(t=>({...t,source:'manual',reviewed:true}));
  const mapped=linkRawLyrics(events,parts).map(t=>({...t,noteIds:t.evidenceIds,reviewed:true}));
  return tokens.flatMap(t=>t.id===id?mapped:[t]);
}
export function mergeLyricWords(tokens,id){
  const list=ordered(tokens),index=list.findIndex(t=>t.id===id),first=list[index],next=list[index+1];
  if(!first||!next||!Number.isFinite(first.start)||!Number.isFinite(first.end)||!Number.isFinite(next.start)||!Number.isFinite(next.end))throw Error('请选择有原音时间的相邻字词');
  const merged={...first,text:first.text+(['zh','yue','ja'].includes(first.language)?'':' ')+next.text,end:Math.max(first.end,next.end),noteIds:[...new Set([...first.noteIds,...next.noteIds])],source:'manual',reviewed:true};
  return list.flatMap(t=>t.id===first.id?[merged]:t.id===next.id?[]:[t]);
}
