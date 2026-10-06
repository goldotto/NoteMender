// Positions are SVG coordinates; the playback clock continues to use raw audio seconds.
export function scoreCursorPosition(beat,{starts,ys,heights,zoom,left}){
  if(!Number.isFinite(beat)||!starts?.length||beat<starts[0]||beat>starts.at(-1))return null;
  let row=starts.findIndex((s,i)=>i<starts.length-1&&beat>=s&&beat<starts[i+1]);
  if(row<0&&beat===starts.at(-1))row=starts.length-2;
  if(row<0)return null;
  return {row,x:left+(beat-starts[row])*zoom,y1:ys[row]-24,y2:ys[row]+heights[row]-30};
}
