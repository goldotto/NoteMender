// Selection is independent of playback and editing history.
export function chooseNotes(notes, current, id, {toggle=false,range=false,anchor=null}={}) {
  const ids=notes.map(n=>n.id);
  if(!ids.includes(id))return new Set(current);
  if(range&&ids.includes(anchor)){const a=ids.indexOf(anchor),b=ids.indexOf(id);return new Set(ids.slice(Math.min(a,b),Math.max(a,b)+1));}
  if(toggle){const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;}
  return new Set([id]);
}
export function combineSelection(base,hits,mode='replace'){
  if(mode==='replace')return new Set(hits);
  const result=new Set(base);for(const id of hits)mode==='subtract'?result.delete(id):result.add(id);return result;
}
export function continuousSelection(notes,ids){
  const wanted=new Set(ids),indices=notes.flatMap((n,i)=>wanted.has(n.id)?[i]:[]);
  return indices.length>=2&&indices.length===wanted.size&&indices.at(-1)-indices[0]+1===indices.length;
}
