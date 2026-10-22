// Raw evidence uses audio seconds. It is deliberately separate from score JSON.
export const EVIDENCE_VERSION='recognition-2026-10-03-v2';
export const sourceLabel={original:'原曲',vocals:'人声轨',other:'其他器乐',bass:'贝斯轨',drums:'鼓轨',instrumental:'无鼓器乐混合',guitar:'吉他轨',piano:'钢琴轨'};
export function ownEvents(events,clipStart,from,to,{legacy=false,windowId='',decisions=[]}={}){
  const result=[];
  for(const n of events){
    const originalStart=n.start+clipStart,originalEnd=n.end+clipStart,mid=(originalStart+originalEnd)/2,evidenceId=`${windowId}|${n.source||''}|${n.eventId||''}|${n.start}|${n.end}`;
    if(!Number.isFinite(originalStart)||!Number.isFinite(originalEnd)){decisions.push({kind:'无效时间范围',second:from,reason:'起止时间不是有限数'});continue;}
    if(mid<from||mid>=to){decisions.push({kind:'窗口上下文候选',second:originalStart,end:originalEnd,midi:n.midi,reason:'不属于本窗口，保留在原始证据中'});continue;}
    const start=Math.max(from,originalStart),end=Math.min(to,originalEnd);
    if(start!==originalStart||end!==originalEnd)decisions.push({kind:'窗口边界裁剪',second:start,end,midi:n.midi,originalStart,originalEnd});
    if(end<=start||legacy&&end-start<.07){decisions.push({kind:legacy?'现版窗口短音过滤':'空时间范围',second:start,end,midi:n.midi,evidenceId,reason:legacy?'不足约 70 毫秒':''});continue;}
    result.push({...n,start,end,detectedStart:originalStart,detectedEnd:originalEnd,windowId,evidenceId});
  }
  return result;
}
export function stitchEvidence(events,decisions=[]){
  const out=[];
  for(const n of [...events].sort((a,b)=>a.start-b.start||a.end-b.end)){
    const last=out.at(-1),same=last&&last.midi===n.midi&&last.source===n.source;
    const crossWindow=same&&last.windowId&&n.windowId&&last.windowId!==n.windowId;
    const overlap=same?Math.max(0,Math.min(last.detectedEnd??last.end,n.detectedEnd??n.end)-Math.max(last.detectedStart??last.start,n.detectedStart??n.start)):0;
    const sameAttack=same&&Math.abs((last.detectedStart??last.start)-(n.detectedStart??n.start))<=.045;
    // Only join overlapping observations of the same attack across windows.
    // Adjacent same-pitch attacks, even with no gap, remain independent notes.
    if(crossWindow&&overlap>0&&sameAttack){
      decisions.push({kind:'跨窗口去重',second:n.start,end:n.end,midi:n.midi,ids:[last.eventId,n.eventId]});
      last.end=Math.max(last.end,n.end);last.detectedEnd=Math.max(last.detectedEnd??last.end,n.detectedEnd??n.end);
      last.confidence=Math.max(last.confidence??0,n.confidence??0);
    }else out.push({...n});
  }
  return out;
}
export function shiftEvidence(evidence,offset){
  if(!evidence)return null;
  const notes=list=>(list||[]).map(n=>({...n,start:n.start+offset,end:n.end+offset}));
  return {...evidence,rawBasic:notes(evidence.rawBasic),rawMono:notes(evidence.rawMono),selected:notes(evidence.selected),
    pitchFrames:(evidence.pitchFrames||[]).map(p=>({...p,second:p.second+offset})),
    onsets:(evidence.onsets||[]).map(p=>({...p,second:p.second+offset})),
    decisions:(evidence.decisions||[]).map(d=>({...d,second:d.second+offset,...(Number.isFinite(d.end)?{end:d.end+offset}:{}),...(Number.isFinite(d.originalStart)?{originalStart:d.originalStart+offset}:{}),...(Number.isFinite(d.originalEnd)?{originalEnd:d.originalEnd+offset}:{})}))};
}
export function quantizationEvidence(raw,notes,project,timeAtBeat,trace=null){
  const events=notes.map(n=>({id:n.id,start:timeAtBeat(project,n.start),end:timeAtBeat(project,n.start+n.duration),midi:n.midi,confidence:n.confidence,reviewFlags:n.reviewFlags}));
  const assignments=new Map((trace||[]).map(x=>[x.evidenceId,x.noteId])),used=new Set();
  const decisions=raw.map(n=>{
    const match=trace?events.find(q=>q.id===assignments.get(n.evidenceId)):events.filter(q=>!used.has(q)&&q.midi===n.midi&&q.end>n.start&&q.start<n.end).sort((a,b)=>Math.abs(a.start-n.start)-Math.abs(b.start-n.start))[0];
    if(match)used.add(match);
    return {kind:match?'节奏量化':'量化后未保留',second:n.start,end:n.end,midi:n.midi,evidenceId:n.evidenceId,...(match?{noteId:match.id,startErrorMs:(match.start-n.start)*1000,endErrorMs:(match.end-n.end)*1000}:{reason:assignments.has(n.evidenceId)?'同拍位候选竞争被替换':'网格折叠或量化冲突'})};
  });
  return {events,decisions};
}
