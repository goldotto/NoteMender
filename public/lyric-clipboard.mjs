import {matchLyrics} from './lyrics.mjs';
const timed=t=>Number.isFinite(t.start)&&Number.isFinite(t.end)&&t.end>t.start;
const intersects=(a,b)=>a.start<b.end-1e-6&&a.end>b.start+1e-6;
export function copyLyrics(tokens,ids){
  const chosen=tokens.filter(t=>ids.has(t.id)).sort((a,b)=>(a.start??Infinity)-(b.start??Infinity));
  if(!chosen.length)throw Error('先选择歌词；Ctrl 点击可多选，Shift 点击可选择连续歌词');
  if(chosen.some(t=>!timed(t)))throw Error('先给未定位歌词设置原音时间，再复制其时间条；文字仍可在输入框复制');
  const origin=chosen[0].start,span=Math.max(...chosen.map(t=>t.end))-origin;
  return {kind:'lyrics',span,tokens:chosen.map(t=>({text:t.text,start:t.start-origin,end:t.end-origin,language:t.language}))};
}
export function pasteLyrics(project,tokens,clipboard,start,{overwrite=false,maxSeconds=3600,idFactory=()=>crypto.randomUUID()}={}){
  if(!clipboard?.tokens?.length)throw Error('先复制歌词');
  if(!Number.isFinite(start)||start<0||start+clipboard.span>maxSeconds+1e-6)throw Error('粘贴范围须在原音时间范围内');
  const range={start,end:start+clipboard.span},collisions=tokens.filter(t=>timed(t)&&intersects(t,range));
  if(collisions.length&&!overwrite)throw Error('目标范围已有歌词；请选择空白或启用“覆盖目标歌词”');
  const retained=overwrite?tokens.filter(t=>!collisions.includes(t)):tokens;
  const fresh=clipboard.tokens.map(t=>({...t,id:idFactory(),start:+(start+t.start).toFixed(6),end:+(start+t.end).toFixed(6),noteIds:[],source:'manual',reviewed:true}));
  // New locations must never reuse the source note IDs or source evidence.
  const linked=matchLyrics({...project,notes:project.notes.map(n=>({...n,lyric:''})),lyrics:[]},fresh,{preserve:false}).map(t=>({...t,reviewed:true}));
  return {tokens:[...retained,...linked].sort((a,b)=>(a.start??Infinity)-(b.start??Infinity)),ids:linked.map(t=>t.id)};
}
export function shiftLyrics(project,tokens,ids,seconds,{maxSeconds=3600}={}){
  const clipboard=copyLyrics(tokens,ids),origin=Math.min(...tokens.filter(t=>ids.has(t.id)).map(t=>t.start));
  if(!Number.isFinite(seconds)||origin+seconds<0||origin+seconds+clipboard.span>maxSeconds+1e-6)throw Error('移动后的歌词须在原音范围内');
  const changed=tokens.filter(t=>ids.has(t.id)).map(t=>({...t,start:+(t.start+seconds).toFixed(6),end:+(t.end+seconds).toFixed(6),noteIds:[],evidenceIds:[],alignmentIssue:'',source:'manual',reviewed:true}));
  const linked=matchLyrics({...project,notes:project.notes.map(n=>({...n,lyric:''})),lyrics:[]},changed,{preserve:false}).map(t=>({...t,reviewed:true}));
  const map=new Map(linked.map(t=>[t.id,t]));return tokens.map(t=>map.get(t.id)||t);
}
