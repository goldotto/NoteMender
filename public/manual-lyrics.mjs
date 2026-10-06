import {textLanguage} from './lyric-language.mjs';
import {timelineLyrics} from './lyric-score.mjs';
import {normalizeLyrics} from './lyrics.mjs';
import {timeAtBeat} from './time-map.mjs';
const id=()=>globalThis.crypto.randomUUID();
export function materializeLyrics(project,tokens){
  return {...project,notes:project.notes.map(n=>({...n,lyric:''})),lyrics:normalizeLyrics(tokens,project.notes)};
}
export function selectedLyricText(project,noteId){return timelineLyrics(project).filter(t=>t.noteIds.includes(noteId)).map(t=>t.text).join('');}
export function setNoteLyricText(project,noteId,text,{language='auto'}={}){
  const tokens=timelineLyrics(project),linked=tokens.filter(t=>t.noteIds.includes(noteId));
  if(linked.length===1)return materializeLyrics(project,text.trim()?tokens.map(t=>t.id===linked[0].id?{...t,text:text.trim(),language:textLanguage(text,language,linked),reviewed:true}:t):tokens.filter(t=>t.id!==linked[0].id));
  return assignNoteLyrics(project,[noteId],text,{mode:'shared',language});
}
export function assignNoteLyrics(project,ids,text,{mode='per-note',language='auto'}={}){
  const chosen=new Set(ids),notes=project.notes.filter(n=>chosen.has(n.id)&&n.midi!==null);if(!notes.length)throw Error('先点击谱面音符；Ctrl点击可选择多个音');
  const trimmed=String(text).trim(),actualLanguage=textLanguage(trimmed,language,timelineLyrics(project));let words;
  if(mode==='shared')words=trimmed?[trimmed]:[];
  else{const parts=trimmed.split(/\s+/u).filter(Boolean);words=parts.length===1&&['zh','yue'].includes(actualLanguage)&&/[\p{Script=Han}]/u.test(parts[0])?Array.from(parts[0]):parts;if(words.length&&words.length!==notes.length)throw Error(`已选${notes.length}音，输入${words.length}字词；请用空格或换行分隔，一音一项`);}
  const selected=new Set(notes.map(n=>n.id));
  const tokens=timelineLyrics(project).flatMap(t=>{const remaining=t.noteIds.filter(n=>!selected.has(n));return t.noteIds.length&&!remaining.length?[]:[{...t,noteIds:remaining}];});
  const add=(word,linked)=>{const start=timeAtBeat(project,linked[0].start),end=timeAtBeat(project,linked.at(-1).start+linked.at(-1).duration),valid=start>=0&&end>start&&end<=3600;tokens.push({id:id(),text:word,start:valid?start:null,end:valid?end:null,noteIds:linked.map(n=>n.id),source:'manual',reviewed:true,language:actualLanguage});};
  if(mode==='shared'){if(words.length)add(words[0],notes);}else words.forEach((word,i)=>add(word,[notes[i]]));
  return materializeLyrics(project,tokens);
}
export function replaceLyricText(project,find,replacement,{ids=null}={}){
  if(!find)throw Error('请输入要查找的文字');const chosen=ids===null?null:new Set(ids);if(chosen&&!chosen.size)throw Error('先选择音符，或把修改范围改为整份歌词');let count=0;
  const tokens=timelineLyrics(project).flatMap(t=>{if((chosen&&!t.noteIds.some(n=>chosen.has(n)))||!t.text.includes(find))return [t];count++;const text=t.text.split(find).join(replacement);return text?[{...t,text,reviewed:true}]:[];});
  if(!count)throw Error('该范围内没有匹配的文字');return {project:materializeLyrics(project,tokens),count};
}
