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

const lyricLines=text=>String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
const lrcTime=String.raw`(\d+):([0-5]?\d)(?:[.:](\d{1,3}))?`;
const lrcPrefix=new RegExp(String.raw`^\[${lrcTime}\]`);
const inlineLrc=new RegExp(String.raw`<${lrcTime}>`,'g');
const inlineVtt=/<((?:\d{2,}:)?[0-5]\d:[0-5]\d\.\d{3})>/g;

export class LyricsImportError extends Error{
  constructor(reason,line,after=null){
    const problems={timing:'时间戳不正确',text:'歌词为空或超出 120 字符',ending:'最后一个字词需要结束时间',empty:'没有可导入的歌词',limit:'歌词最多 20000 字词'};
    super(line?'第 '+line+' 行：'+problems[reason]:problems[reason]);
    Object.assign(this,{reason,line,after});
  }
}

export function detectLyricsFormat(text){
  const lines=lyricLines(text);
  if(/^WEBVTT(?:[ \t].*)?$/.test(lines.find(line=>line.trim())?.trim()||''))return 'vtt';
  if(lines.some(line=>/^\s*\d+:[\d:.,]+\s*-->/.test(line)))return 'srt';
  if(lines.some(line=>lrcPrefix.test(line.trim())))return 'lrc';
  return 'txt';
}

function subtitleSeconds(raw,format,line){
  const pattern=format==='srt'?/^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/:/^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
  const m=pattern.exec(raw);
  if(!m)throw new LyricsImportError('timing',line);
  return Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000;
}

function lrcSeconds(match){
  return Number(match[1])*60+Number(match[2])+Number('0.'+(match[3]||'0'));
}

function subtitleText(text){
  const entities={amp:'&',lt:'<',gt:'>',nbsp:'\u00a0',lrm:'\u200e',rlm:'\u200f',quot:'"',apos:"'"};
  return text.replace(/<\/?(?:b|i|u|s|font|c|v|lang|ruby|rt)(?:[.\s][^<>]*)?>/gi,'')
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);/g,(_,name)=>entities[name]).trim();
}

function lyricInterval(text,start,end,line,source){
  if(!text||text.length>120)throw new LyricsImportError('text',line);
  if(!(start>=0&&end>start&&end<=3600))throw new LyricsImportError('timing',line);
  return {text,start,end,source};
}

function timedFragments(text,markers,from,to,line,source,parseTime,plainText){
  const fragments=[];
  let start=from,cursor=0;
  for(const marker of text.matchAll(markers)){
    const next=parseTime(marker);
    if(source==='vtt'?next<=start||next>=to:next<start||next>to)throw new LyricsImportError('timing',line);
    const content=plainText(text.slice(cursor,marker.index));
    if(content)fragments.push(lyricInterval(content,start,next,line,source));
    start=next;
    cursor=marker.index+marker[0].length;
  }
  const content=plainText(text.slice(cursor));
  if(content)fragments.push(lyricInterval(content,start,to,line,source));
  return fragments;
}

function readSubtitles(lines,format){
  const tokens=[];
  let index=0;
  while(!lines[index]?.trim()&&index<lines.length)index++;
  if(format==='vtt'){
    if(!/^WEBVTT(?:[ \t].*)?$/.test(lines[index]?.trim()||''))throw new LyricsImportError('timing',index+1);
    while(lines[index]?.trim())index++;
  }
  while(index<lines.length){
    if(!lines[index].trim()){index++;continue;}
    const first=index,block=[];
    while(lines[index]?.trim())block.push(lines[index++]);
    if(format==='vtt'&&/^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(block[0]))continue;
    const header=block[0].includes('-->')?0:1,line=first+header+1;
    const timing=/^\s*(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(block[header]||'');
    if(!timing)throw new LyricsImportError('timing',line);
    const start=subtitleSeconds(timing[1],format,line),end=subtitleSeconds(timing[2],format,line);
    if(end<=start||end>3600)throw new LyricsImportError('timing',line);
    const content=block.slice(header+1).join('\n');
    if(format==='vtt'&&/<\d+:/.test(content.replace(inlineVtt,'')))throw new LyricsImportError('timing',line);
    const cues=format==='vtt'?timedFragments(content,inlineVtt,start,end,line,'vtt',m=>subtitleSeconds(m[1],'vtt',line),subtitleText)
      :[lyricInterval(subtitleText(content),start,end,line,'srt')];
    if(!cues.length)throw new LyricsImportError('text',line);
    tokens.push(...cues);
  }
  return tokens;
}

function readLrc(lines,{end,lastEnd}){
  let offset=0;
  for(const [index,line] of lines.entries())if(/^\s*\[offset:/i.test(line)){
    const match=/^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i.exec(line);
    if(!match||!Number.isSafeInteger(Number(match[1])))throw new LyricsImportError('timing',index+1);
    offset=Number(match[1])/1000;
  }
  const shifted=(second,shift=0)=>Math.round((second+shift-offset)*1000)/1000;
  const cues=[];
  for(const [index,raw] of lines.entries()){
    const line=index+1,original=raw.trim();
    if(!original||/^\[[a-z]+:[^\]]*\]$/i.test(original))continue;
    let text=original,match;
    const starts=[];
    while((match=lrcPrefix.exec(text))){
      starts.push(lrcSeconds(match));
      text=text.slice(match[0].length).trimStart();
    }
    if(!starts.length)throw new LyricsImportError('timing',line);
    const markers=[...text.matchAll(inlineLrc)];
    if(/<\d+:/.test(text.replace(inlineLrc,'')))throw new LyricsImportError('timing',line);
    for(const start of starts)cues.push({start:shifted(start),text,markers,line,shift:start-starts[0]});
  }
  cues.sort((a,b)=>a.start-b.start);
  const tokens=[];
  let nextIndex=0;
  for(const [i,cue] of cues.entries()){
    const {start,text,markers,line,shift}=cue;
    if(!text)continue;
    if(start<0||start>=3600)throw new LyricsImportError('timing',line);
    nextIndex=Math.max(nextIndex,i+1);
    while(cues[nextIndex]?.start===start)nextIndex++;
    const next=cues[nextIndex]?.start;
    if(markers.length){
      const last=markers.at(-1),markerEnd=shifted(lrcSeconds(last),shift);
      const explicitEnd=!text.slice(last.index+last[0].length).trim()?markerEnd:null;
      const finish=explicitEnd??next??lastEnd;
      if(finish==null)throw new LyricsImportError('ending',line,markerEnd);
      if(explicitEnd===null&&next===undefined&&!(finish>markerEnd&&finish<=3600))throw new LyricsImportError('ending',line,markerEnd);
      tokens.push(...timedFragments(text,inlineLrc,start,finish,line,'elrc',m=>shifted(lrcSeconds(m),shift),x=>x.trim()));
    }else{
      if(text.length>120)throw new LyricsImportError('text',line);
      const finish=next??end;
      tokens.push(finish>start?lyricInterval(text,start,finish,line,'lrc'):{text,start:null,end:null,source:'lrc'});
    }
  }
  return tokens;
}

export function importLyrics(text,{start=0,end,lastEnd,language='zh',format=detectLyricsFormat(text)}={}){
  const lines=lyricLines(text);
  let tokens;
  if(format==='lrc')tokens=readLrc(lines,{end,lastEnd});
  else if(format==='srt'||format==='vtt')tokens=readSubtitles(lines,format);
  else{
    const plain=lines.map(line=>line.trim()).filter(Boolean);
    if(plain.length>1)tokens=plain.map(text=>({text,start:null,end:null,source:'txt'}));
    else if(plain.length){
      if(!Number.isFinite(end)||end<=start)throw Error('请先指定这句歌词的原音范围');
      tokens=[{text:plain[0],start,end,source:'txt'}];
    }
  }
  if(!tokens?.length)throw new LyricsImportError('empty');
  if(tokens.length>20000)throw new LyricsImportError('limit');
  return tokens.map(token=>({...token,id:newId(),noteIds:[],language,reviewed:false}));
}
