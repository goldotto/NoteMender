const EPS=1e-7;
const grids=[.5,.25,.125,.0625];
const boundaryKey=value=>Math.round(value*1e7)/1e7;

// Presentation-only timing. Preserve every note and the ordering of distinct boundaries.
export function cleanRhythm(notes,{closeGaps=false}={}){
  const copy=notes.map(note=>({...note}));
  let closedGaps=0;
  if(closeGaps){
    for(let i=0;i<copy.length-1;i++){
      const current=copy[i],next=copy[i+1];
      const gap=next.start-current.start-current.duration;
      if(current.midi!==null&&next.midi!==null&&gap>EPS&&gap<=.125+EPS){
        current.duration=next.start-current.start;
        closedGaps++;
      }
    }
  }

  const points=[...new Set(copy.flatMap(note=>[note.start,note.start+note.duration]).map(boundaryKey))].sort((a,b)=>a-b);
  const layers=[];
  let previous=[];
  for(const point of points){
    // Retain the original boundary so a collision never forces deletion of a short note.
    const candidates=new Set([point,...grids.map(step=>Math.round(point/step)*step)]);
    const layer=[];
    for(const value of [...candidates].sort((a,b)=>a-b)){
      if(value<0||Math.abs(value-point)>.125+EPS)continue;
      const complexity=grids.findIndex(step=>Math.abs(value/step-Math.round(value/step))<1e-6);
      const cost=(complexity<0?6:complexity)+Math.abs(value-point)*8;
      let parent=-1,total=Infinity;
      if(!layers.length)total=cost;
      else{
        previous.forEach((node,index)=>{
          if(node.value<value-EPS&&node.cost+cost<total){
            total=node.cost+cost;
            parent=index;
          }
        });
      }
      if(Number.isFinite(total))layer.push({value,cost:total,parent});
    }
    layers.push(layer);
    previous=layer;
  }
  if(!previous.length)return {notes:copy,closedGaps};

  let index=previous.reduce((best,node,i)=>node.cost<previous[best].cost?i:best,0);
  const mapped=new Map();
  for(let i=layers.length-1;i>=0;i--){
    const node=layers[i][index];
    mapped.set(points[i],node.value);
    index=node.parent;
  }
  const position=value=>mapped.get(boundaryKey(value));
  return {
    notes:copy.map(note=>({...note,start:position(note.start),duration:position(note.start+note.duration)-position(note.start)})),
    closedGaps
  };
}
