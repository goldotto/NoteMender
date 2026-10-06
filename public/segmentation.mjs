// Broad activity regions, never a claim that the song's musical form is known.
export function activitySections(vocals,other,duration,sr=22050){
  if(!vocals||!other)return [{from:0,to:duration,kind:'instrumental',name:'整曲主旋律',source:'original'}];
  const hop=Math.round(sr*.25),frames=Math.ceil(duration*sr/hop),flags=[];
  for(let f=0;f<frames;f++){
    let v=0,o=0,count=0;for(let i=f*hop;i<Math.min((f+1)*hop,vocals.length,other.length);i+=32){v+=vocals[i]*vocals[i];o+=other[i]*other[i];count++;}
    const vr=Math.sqrt(v/Math.max(1,count)),or=Math.sqrt(o/Math.max(1,count));flags.push(vr>.007&&vr>or*.3);
  }
  const smooth=flags.map((_,i)=>{let yes=0,total=0;for(let j=Math.max(0,i-4);j<=Math.min(flags.length-1,i+4);j++){yes+=flags[j]?1:0;total++;}return yes/total>=.55;});
  const spans=[];let from=0,state=smooth[0]||false;
  for(let i=1;i<=smooth.length;i++)if(i===smooth.length||smooth[i]!==state){spans.push({from:from*.25,to:Math.min(duration,i*.25),voice:state});from=i;state=smooth[i];}
  for(let i=1;i<spans.length-1;i++)if(spans[i].to-spans[i].from<4){spans[i-1].to=spans[i+1].to;spans.splice(i,2);i--;}
  for(let i=1;i<spans.length-1;i++)if(spans[i].voice&&!spans[i-1].voice&&!spans[i+1].voice&&spans[i].to-spans[i].from<8){spans[i-1].to=spans[i+1].to;spans.splice(i,2);i--;}
  const out=[];for(const s of spans){if(s.to-s.from<.25)continue;const instrumental=!s.voice;out.push({from:s.from,to:s.to,kind:instrumental?(out.length?'interlude':'intro'):'voice',name:instrumental?(out.length?'间奏候选':'前奏候选'):`人声段 ${out.filter(x=>x.kind==='voice').length+1}`,source:instrumental?'other':'vocals'});}
  if(out.at(-1)?.kind==='interlude'){out.at(-1).kind='outro';out.at(-1).name='尾奏候选';}
  return out.length?out:[{from:0,to:duration,kind:'instrumental',name:'整曲主旋律',source:'other'}];
}
export function automaticSpans(vocals,other,duration,from=0,to=duration){
  return activitySections(vocals,other,duration).map(s=>({...s,from:Math.max(from,s.from),to:Math.min(to,s.to)})).filter(s=>s.to-s.from>=.25-1e-6);
}
