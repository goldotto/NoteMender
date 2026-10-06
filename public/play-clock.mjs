export const validSpeed=value=>Math.max(.5,Math.min(1.5,Math.round((Number(value)||1)*100)/100));
export function clockPosition({position,startedAt,speed=1,end=Infinity},now){return Math.min(end,position+Math.max(0,now-startedAt)*speed);}
export function noteSchedule(start,end,position,limit,startedAt,speed=1){
  if(end<=position||start>=limit)return null;
  return {when:startedAt+Math.max(0,start-position)/speed,duration:(Math.min(end,limit)-Math.max(start,position))/speed};
}
