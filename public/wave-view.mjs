export function followedWaveStart(start,visible,second,duration){
  if(![start,visible,second,duration].every(Number.isFinite)||visible<=0||duration<=0)return start;
  let next=start;
  if(second>=start+visible*.94)next=second-visible*.1;
  else if(second<=start+visible*.06)next=second-visible*.9;
  return Math.max(0,Math.min(Math.max(0,duration-visible),next));
}
