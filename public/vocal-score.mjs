import {tr} from './i18n.mjs';
export const VOCAL_DYNAMICS=['pp','p','mp','mf','f','ff'];
export function vocalNote(value={}){
  return {breath:Boolean(value?.breath),fermata:Boolean(value?.fermata),accent:Boolean(value?.accent),dynamic:VOCAL_DYNAMICS.includes(value?.dynamic)?value.dynamic:'',text:String(value?.text||'').slice(0,80)};
}
export function vocalSlurs(value,notes){
  const byId=new Map(notes.filter(n=>n.midi!==null).map(n=>[n.id,n])),seen=new Set();
  return (Array.isArray(value)?value:[]).slice(0,12000).filter(s=>{
    const a=byId.get(s?.start),b=byId.get(s?.end),key=s?.start+'|'+s?.end;
    if(!a||!b||a.start>=b.start||seen.has(key))return false;
    seen.add(key);return true;
  }).map(s=>({start:s.start,end:s.end}));
}
export function editVocalNotes(project,ids,marks){
  const chosen=new Set(ids),vocal=vocalNote(marks);
  if(!project.notes.some(n=>chosen.has(n.id)))throw Error(tr('先选择简谱上的音符','Select notes in the score first'));
  return {...project,notes:project.notes.map(n=>chosen.has(n.id)?{...n,vocal}:n)};
}
export function patchVocalNotes(project,ids,marks){
  const chosen=new Set(ids);
  return {...project,notes:project.notes.map(n=>chosen.has(n.id)?{...n,vocal:vocalNote({...n.vocal,...marks})}:n)};
}
export function editPreviewNotes(project,ids,changes){
  const chosen=new Set(ids);
  if(!project.notes.some(n=>chosen.has(n.id)))throw Error(tr('先选择简谱上的音符','Select notes in the score first'));
  const notes=project.notes.map(n=>{
    if(!chosen.has(n.id))return n;
    const next={...n,...changes,reviewStatus:'reviewed'};
    if(next.midi!==null&&(!Number.isInteger(next.midi)||next.midi<21||next.midi>108))throw Error(tr('音高超出可编辑范围','Pitch is outside the editable range'));
    if(!Number.isFinite(next.duration)||next.duration<.0625||next.duration>128)throw Error(tr('时值须在 1/16 至 128 拍之间','Duration must be between 1/16 and 128 beats'));
    return next;
  });
  return {...project,notes};
}
export function editVocalSlur(project,ids,remove=false){
  const chosen=new Set(ids),notes=project.notes.filter(n=>chosen.has(n.id)&&n.midi!==null);
  if(notes.length<2)throw Error(tr('按住 Shift 点击连音线的另一端，选择至少两个有声音符','Shift-click the other end of the phrase to select at least two sounded notes'));
  const start=notes[0].id,end=notes.at(-1).id;
  const slurs=(project.vocalSlurs||[]).filter(s=>s.start!==start||s.end!==end);
  if(!remove)slurs.push({start,end});
  return {...project,vocalSlurs:slurs};
}
