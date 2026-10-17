import {EDIT_STEP,keyAt,numberPitch,uid,validateProject} from './music.mjs';

import {mapLyricIds,withOrphanLyrics} from './lyrics.mjs';

const STEPS=[0,2,4,5,7,9,11];
export function parseFreeNotes(text,{key=0}={}){
  if(typeof text!=='string'||text.length>4000)throw Error('音符内容过长');
  const tokens=text.trim().split(/[\s，、|]+/).filter(Boolean);
  if(!tokens.length)throw Error('请输入音符，例如 1:1 2:0.5 0:0.5 3:2');
  const notes=[];let cursor=0;
  for(const token of tokens){
    const match=/^([#♯b♭]?)([0-7])([',]*)(?::(\d+(?:\.\d+)?))?$/.exec(token);
    if(!match)throw Error(`无法识别“${token}”。例如 1:1、#4:0.5、1':2、0:1。`);
    const [,acc,digit,oct,durationText]=match,duration=Number(durationText||1);
    if(!Number.isFinite(duration)||duration<EDIT_STEP||duration>64||Math.abs(duration/EDIT_STEP-Math.round(duration/EDIT_STEP))>1e-6)throw Error(`“${token}”时值须为 1/16 拍的倍数，且在 0.0625–64 拍之间。`);
    if(cursor+duration>64+1e-6)throw Error('一次最多写入 64 拍；可分多次继续写。');
    if(digit==='0'&&(acc||oct))throw Error('休止符写作 0:时值，不加升降号或高低音标记。');
    if(oct.includes("'")&&oct.includes(','))throw Error('同一个音不能同时加高音和低音标记。');
    const midi=digit==='0'?null:60+key+STEPS[Number(digit)-1]+(acc==='#'||acc==='♯'?1:acc==='b'||acc==='♭'?-1:0)+12*(oct[0]==="'"?oct.length:-oct.length);
    if(midi!==null&&(midi<21||midi>108))throw Error(`“${token}”超出可编辑音域。`);
    notes.push({id:uid(),start:cursor,duration,midi,confidence:1,reviewStatus:'reviewed',lyric:''});cursor+=duration;
  }
  return {notes,beats:cursor};
}
export function parseBar(text,{key=0,beats=4}={}){
  const result=parseFreeNotes(text,{key});
  if(result.beats>beats+1e-6)throw Error(`本小节超过 ${beats} 拍，请缩短音符时值。`);
  if(Math.abs(result.beats-beats)>1e-6)throw Error(`本小节共 ${result.beats} 拍，需要恰好 ${beats} 拍；空白处请用 0:时值。`);
  return result.notes;
}

export function formatBar(project,start,end){
  const tokens=[];let cursor=start;
  for(const n of project.notes){
    if(n.start+n.duration<=start||n.start>=end)continue;
    const a=Math.max(start,n.start),b=Math.min(end,n.start+n.duration);
    if(a>cursor+1e-6)tokens.push(`0:${+(a-cursor).toFixed(4)}`);
    const p=numberPitch(n.midi,keyAt(project,a));
    const head=p.digit==='0'?'0':`${p.accidental==='♯'?'#':p.accidental==='♭'?'b':''}${p.digit}${p.octave>0?"'".repeat(p.octave):','.repeat(-p.octave)}`;
    tokens.push(`${head}:${+(b-a).toFixed(4)}`);cursor=b;
  }
  if(end>cursor+1e-6)tokens.push(`0:${+(end-cursor).toFixed(4)}`);
  return tokens.join(' ');
}

export function replaceRange(project,start,end,relativeNotes){
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>14400||end-start>64)throw Error('段落范围无效或超过 64 拍');
  const retained=[],mapping=new Map();
  for(const n of project.notes){
    if(n.start>=end||n.start+n.duration<=start){retained.push(n);continue;}
    const survivors=[];
    if(n.start<start){retained.push({...n,duration:start-n.start});survivors.push(n.id);}
    if(n.start+n.duration>end){const id=survivors.length?uid():n.id;retained.push({...n,id,start:end,duration:n.start+n.duration-end,lyric:survivors.length?'':n.lyric});survivors.push(id);}
    mapping.set(n.id,survivors);
  }
  for(const n of relativeNotes){
    if(!Number.isFinite(n.start)||!Number.isFinite(n.duration)||n.duration<EDIT_STEP||n.start<0||n.start+n.duration>end-start+1e-6)throw Error('音符超出段落范围');
    if(n.midi!==null){const position=n.start+start,match=project.notes.find(old=>Math.abs(old.start-position)<1e-6&&old.midi===n.midi),id=uid();
      retained.push({...n,id,start:position,lyric:n.lyric||match?.lyric||''});
      // Preserve an unchanged note's explicit association, not a guessed overlap.
      if(match&&mapping.has(match.id)&&!mapping.get(match.id).length&&Math.abs(match.duration-n.duration)<1e-6)mapping.set(match.id,[id]);
    }
  }
  const next={...project,notes:retained};
  if(project.lyrics!==undefined)next.lyrics=mapLyricIds(project.lyrics,mapping);
  return validateProject(withOrphanLyrics(project,next));
}

export function expandToSong(project){
  if(project.offset<=0)return project;
  const shift=Math.round(project.offset*project.bpm/60*4)/4;
  if(shift<=0)return project;
  const offset=project.offset-shift*60/project.bpm;
  const timeAnchors=project.timeAnchors?.length?[{beat:0,second:offset},...project.timeAnchors.map(a=>({...a,beat:a.beat+shift}))]:[];
  return validateProject({...project,offset,timeAnchors,notes:project.notes.map(n=>({...n,start:n.start+shift})),keyChanges:(project.keyChanges||[]).map(c=>({...c,beat:c.beat+shift})),sections:project.sections||[]});
}
