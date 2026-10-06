// Compare note events in original-audio seconds, before score quantization.
const valid=n=>Number.isFinite(n.start)&&Number.isFinite(n.end)&&n.end>n.start&&Number.isInteger(n.midi);
const median=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
export function evaluateNoteEvents(reference,candidate,{onsetTolerance=.12,minOverlap=.05}={}){
  const truth=reference.filter(valid),found=candidate.filter(valid),pairs=[];
  for(let i=0;i<truth.length;i++)for(let j=0;j<found.length;j++){
    const a=truth[i],b=found[j],overlap=Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
    if(overlap<minOverlap&&Math.abs(a.start-b.start)>onsetTolerance)continue;
    const score=overlap/Math.max(a.end-a.start,b.end-b.start)-Math.abs(a.start-b.start)*.15;
    pairs.push({i,j,score});
  }
  // Maximize temporal matches first, then their quality. Greedy pairing can let
  // one long candidate steal a short attack and falsely count another as missed.
  // Pitch deliberately does not participate in alignment: wrong pitch is scored
  // after matching rather than hidden by choosing a different same-pitch note.
  const size=truth.length+found.length+2,source=size-2,sink=size-1,graph=Array.from({length:size},()=>[]);
  function edge(a,b,cost,pair){const forward={to:b,cap:1,cost,rev:graph[b].length,pair},reverse={to:a,cap:0,cost:-cost,rev:graph[a].length};graph[a].push(forward);graph[b].push(reverse);}
  truth.forEach((_,i)=>edge(source,i,0));found.forEach((_,j)=>edge(truth.length+j,sink,0));
  pairs.forEach(p=>edge(p.i,truth.length+p.j,1-p.score,p));
  // Residual edges can be negative. Queue relaxation finds the cheapest next
  // augmentation and can undo an earlier pairing when a better assignment exists.
  for(;;){
    const distance=Array(size).fill(Infinity),previous=Array(size),queued=Array(size).fill(false),queue=[source];distance[source]=0;queued[source]=true;
    for(let at=0;at<queue.length;at++){const node=queue[at];queued[node]=false;graph[node].forEach((e,index)=>{if(e.cap&&distance[e.to]>distance[node]+e.cost+1e-10){distance[e.to]=distance[node]+e.cost;previous[e.to]=[node,index];if(!queued[e.to]){queue.push(e.to);queued[e.to]=true;}}});}
    if(!previous[sink])break;
    for(let node=sink;node!==source;){const [from,index]=previous[node],e=graph[from][index];e.cap--;graph[node][e.rev].cap++;node=from;}
  }
  const matches=graph.slice(0,truth.length).flatMap(edges=>edges.filter(e=>e.pair&&!e.cap).map(e=>({reference:truth[e.pair.i],candidate:found[e.pair.j]})));
  const correct=matches.filter(x=>x.reference.midi===x.candidate.midi),wrongPitch=matches.length-correct.length;
  return {referenceNotes:truth.length,candidateNotes:found.length,matched:matches.length,correctPitch:correct.length,wrongPitch,octaveErrors:matches.filter(x=>Math.abs(x.reference.midi-x.candidate.midi)===12).length,missed:truth.length-matches.length,extra:found.length-matches.length,onsetErrorMs:median(matches.map(x=>Math.abs(x.reference.start-x.candidate.start)*1000)),offsetErrorMs:median(matches.map(x=>Math.abs(x.reference.end-x.candidate.end)*1000))};
}
