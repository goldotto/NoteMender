// Absolute audio seconds are the source of truth. A missing map preserves v1 timing.
export function anchorsFor(project){
  return project.timeAnchors?.length>=2?project.timeAnchors:[{beat:0,second:project.offset||0},{beat:Math.max(1,(project.notes?.at(-1)?.start||0)+(project.notes?.at(-1)?.duration||0)),second:(project.offset||0)+Math.max(1,(project.notes?.at(-1)?.start||0)+(project.notes?.at(-1)?.duration||0))*60/project.bpm}];
}
function interpolate(points,value,input,output){
  let i=0;while(i<points.length-2&&value>points[i+1][input])i++;
  const a=points[i],b=points[i+1],slope=(b[output]-a[output])/(b[input]-a[input]);
  return a[output]+(value-a[input])*slope;
}
export const timeAtBeat=(project,beat)=>interpolate(anchorsFor(project),beat,'beat','second');
export const beatAtTime=(project,second)=>interpolate(anchorsFor(project),second,'second','beat');
export function makeTimeAnchors(duration,bpm,beats=[]){
  const first=beats[0],base=first===undefined?0:Math.round(first*bpm/60*4)/4;
  const out=[{beat:0,second:0}];
  for(let i=0;i<beats.length;i+=4){const beat=base+i,second=beats[i];if(beat>out.at(-1).beat+.01&&second>out.at(-1).second+.01)out.push({beat,second});}
  const last=out.at(-1),tail=Math.max(last.beat+.25,Math.round((last.beat+(duration-last.second)*bpm/60)*4)/4);
  if(duration>last.second+.01)out.push({beat:tail,second:duration});
  else if(out.length===1)out.push({beat:Math.max(.25,Math.round(duration*bpm/60*4)/4),second:duration});
  return out;
}
export function quantizeTimed(raw,project,step=.25){
  return raw.map(n=>({...n,start:Math.max(0,Math.round(beatAtTime(project,n.start)/step)*step),end:Math.max(0,Math.round(beatAtTime(project,n.end)/step)*step)})).filter(n=>n.end>n.start);
}
