import {sectionSeconds} from './sections.mjs';
export function lyricRanges(project,duration,{mode='auto',manual=false,from=0,to=duration}={}){
  if(!Number.isFinite(duration)||duration<=0)throw Error('先导入原音');
  const valid=r=>Number.isFinite(r.from)&&Number.isFinite(r.to)&&r.from>=0&&r.to>r.from&&r.to<=duration+.01;
  if(manual){const range={from:Number(from),to:Number(to)||duration,name:'手动范围'};if(!valid(range))throw Error('请指定有效的原音范围');return [range];}
  const sections=project.sections||[];let selected;
  if(mode==='whole')selected=[];else if(mode==='auto')selected=sections.filter(s=>s.source==='vocals'||s.kind==='voice');else{selected=sections.filter(s=>s.id===mode);if(!selected.length)throw Error('所选区块已不存在，请重新选择');}
  if(!selected.length)return [{from:0,to:duration,name:mode==='whole'?'整曲':'自动 · 整曲（尚无人声区段）'}];
  const ranges=selected.map(s=>({...sectionSeconds(project,s),name:s.name||'人声区段'})).map(r=>({...r,from:Math.max(0,r.from),to:Math.min(duration,r.to)})).filter(valid).sort((a,b)=>a.from-b.from),merged=[];
  for(const r of ranges){const prev=merged.at(-1);if(prev&&r.from<prev.to){prev.to=Math.max(prev.to,r.to);prev.name+=' / '+r.name;}else merged.push({...r});}if(!merged.length)throw Error('所选区块不在当前原音内');return merged;
}
