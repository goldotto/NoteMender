import {timeAtBeat} from './time-map.mjs';
const newId=()=>globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2);
export function normalizeLyrics(tokens=[],notes=[]){
  if(!Array.isArray(tokens)||tokens.length>20000)throw Error('歌词最多 20000 字词');
  const available=new Set(notes.filter(n=>n.midi!==null).map(n=>n.id)),ids=new Set();
  return tokens.map(t=>{
    const id=typeof t.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(t.id)?t.id:newId();if(ids.has(id))throw Error('歌词 ID 重复');ids.add(id);
    const start=t.start==null?null:Number(t.start),end=t.end==null?null:Number(t.end);
    if((start===null)!==(end===null)||start!==null&&(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>3600))throw Error('歌词起止时间无效');
    const originalIds=Array.isArray(t.noteIds)?[...new Set(t.noteIds)]:[],noteIds=originalIds.filter(id=>available.has(id));
    const alignmentScore=typeof t.alignmentScore==='number'&&Number.isFinite(t.alignmentScore)?Math.max(0,Math.min(1,t.alignmentScore)):undefined;
    return {id,text:String(t.text||'').slice(0,120),start,end,noteIds,source:String(t.source||'manual').slice(0,40),reviewed:Boolean(t.reviewed),language:String(t.language||'zh').slice(0,12),...(alignmentScore===undefined?{}:{alignmentScore}),...(Array.isArray(t.evidenceIds)?{evidenceIds:t.evidenceIds.slice(0,2000).map(x=>String(x).slice(0,200))}:{}),...(t.alignmentIssue?{alignmentIssue:String(t.alignmentIssue).slice(0,100)}:{})};
  });
}
export function wordsFromSegments(segments,language='zh'){
  return segments.flatMap(s=>{
    const actualLanguage=s.language||language,units=['zh','yue'].includes(actualLanguage)?(s.chars||[]):s.words||[];
    if(!units.length)return String(s.text||'').trim()?[{id:newId(),text:s.text,start:null,end:null,noteIds:[],language:actualLanguage,source:s.source||'whisper',reviewed:false}]:[];
    return units.filter(t=>String(t.char||t.word||'').trim()).map(t=>({id:newId(),text:t.char||t.word,start:Number.isFinite(t.start)&&Number.isFinite(t.end)&&t.end>t.start?t.start:null,end:Number.isFinite(t.start)&&Number.isFinite(t.end)&&t.end>t.start?t.end:null,noteIds:[],language:actualLanguage,source:t.source||s.source||(typeof t.score==='number'?'whisperx':'whisper'),reviewed:false,...(typeof t.score==='number'?{alignmentScore:t.score}:{}),...(t.alignmentIssue?{alignmentIssue:t.alignmentIssue}:{})}));
  });
}
export async function stableWordsFromSegments(segments,language,resourceId,{from=0,to=3600}={}){
  const words=[],occurrences=new Map();
  for(const [segmentIndex,segment] of segments.entries()){
    const units=wordsFromSegments([segment],language);
    for(const [unitIndex,word] of units.entries()){
      // Missing alignment times are not an identity: repeated unlocated words
      // must keep their own source segment and occurrence instead of collapsing.
      const identity=[resourceId,word.text,word.start,word.end,word.language];
      if(word.start===null)identity.push('unlocated',segment.start??from,segment.end??to,segmentIndex,unitIndex);
      const key=JSON.stringify(identity),occurrence=occurrences.get(key)||0;occurrences.set(key,occurrence+1);
      if(occurrence)identity.push('occurrence',occurrence);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity)));
      words.push({...word,id:'qwen-'+[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,40)});
    }
  }
  return words;
}
export function matchLyrics(project,tokens,{preserve=true}={}){
  const notes=project.notes.filter(n=>n.midi!==null),index=new Map(notes.map((n,i)=>[n.id,i])),locked=new Set(preserve?(project.lyrics||[]).filter(t=>t.reviewed).flatMap(t=>t.noteIds):[]);let last=-1;
  return tokens.map(t=>{
    if(preserve&&t.reviewed&&t.noteIds?.length){last=Math.max(last,...t.noteIds.map(id=>index.get(id)??-1));return {...t};}
    if(t.start===null||t.end===null||!t.reviewed&&(t.alignmentScore===0||['txt','lrc'].includes(t.source)))return {...t,noteIds:[]};
    const matches=notes.flatMap((n,i)=>{
      if(i<last||n.lyric||locked.has(n.id))return [];
      const a=timeAtBeat(project,n.start),b=timeAtBeat(project,n.start+n.duration),overlap=Math.min(b,t.end)-Math.max(a,t.start);
      return overlap>=.01&&(overlap>=(t.end-t.start)*.2||overlap>=(b-a)*.5)?[{id:n.id,i}]:[];
    });
    if(matches.length)last=matches.at(-1).i;
    return {...t,noteIds:matches.map(n=>n.id),reviewed:false};
  });
}
export function lyricLabels(project){
  const labels=new Map(),manual=new Set((project.lyrics||[]).filter(t=>t.reviewed).flatMap(t=>t.noteIds));for(const t of project.lyrics||[])for(let i=0;i<t.noteIds.length;i++){const id=t.noteIds[i],text=i===0?t.text:'—';labels.set(id,(labels.get(id)||'')+text);}
  for(const n of project.notes)if(n.lyric&&!manual.has(n.id))labels.set(n.id,n.lyric);return labels;
}
export function mapLyricIds(tokens,mapping){return (tokens||[]).map(t=>({...t,noteIds:[...new Set(t.noteIds.flatMap(id=>mapping.get(id)||[id]))]}));}
export function withOrphanLyrics(current,next){
  const ids=new Set(next.notes.map(n=>n.id)),tokens=[...(next.lyrics??current.lyrics??[])];
  for(const n of current.notes)if(n.lyric&&!ids.has(n.id)){
    if(next.notes.some(m=>m.start<=n.start&&m.start+m.duration>=n.start+n.duration&&m.lyric?.includes(n.lyric)))continue;
    const a=timeAtBeat(current,n.start),b=timeAtBeat(current,n.start+n.duration),valid=a>=0&&b>a&&b<=3600,start=valid?a:null,end=valid?b:null;
    if(!tokens.some(t=>t.text===n.lyric&&t.start===start&&t.end===end))tokens.push({id:newId(),text:n.lyric,start,end,noteIds:[],source:'legacy',reviewed:true,language:'zh'});
  }
  return tokens.length||next.lyrics!==undefined||current.lyrics!==undefined?{...next,lyrics:tokens}:next;
}
export function importLyrics(text,{start=0,end,language='zh'}={}){
  const lines=String(text).split(/\r?\n/).map(x=>x.trim()).filter(Boolean),timed=[];
  for(const line of lines){const stamps=[...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)],words=line.replace(/\[[^\]]*\]/g,'').trim();for(const m of stamps)if(words)timed.push({text:words,start:Number(m[1])*60+Number(m[2])});}
  if(timed.length)return timed.sort((a,b)=>a.start-b.start).map((t,i)=>({...t,id:newId(),end:timed[i+1]?.start??end??null,noteIds:[],source:'lrc',language,reviewed:false})).map(t=>t.end>t.start?t:{...t,start:null,end:null});
  if(lines.length>1)return lines.map(text=>({id:newId(),text,start:null,end:null,noteIds:[],source:'txt',language,reviewed:false}));
  if(!lines.length)throw Error('请先输入歌词');
  if(!Number.isFinite(end)||end<=start)throw Error('请先指定这句歌词的原音范围');
  return [{id:newId(),text:lines[0],start,end,noteIds:[],source:'txt',language,reviewed:false}];
}
