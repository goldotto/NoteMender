import {tr,onLanguageChange} from './i18n.mjs';
import {EDIT_STEP,numberPitch,pitchName,escapeXML} from './music.mjs';
import {copyNotes} from './note-clipboard.mjs';
import {copyScoreSelection} from './score-edit.mjs';

export function captureFragment(project,noteIds,lyricIds){
  if(!noteIds.size||!lyricIds.size)return copyNotes(project,noteIds,{includeLyrics:false});
  return structuredClone(copyScoreSelection(project,noteIds,lyricIds,{alignLyricsToBeats:true}));
}

export function pasteFragmentPitches(project,ids,fragment){
  const source=pitchNotes(fragment.notes).sort((a,b)=>a.start-b.start);
  const targets=pitchNotes(project.notes).filter(note=>ids.has(note.id)).sort((a,b)=>a.start-b.start);
  if(!source.length||source.length!==targets.length)throw new RangeError(pitchCountText(source.length,targets.length));
  const pitches=new Map(targets.map((note,i)=>[note.id,source[i].midi]));
  if(targets.every(note=>pitches.get(note.id)===note.midi))return project;
  return {...project,notes:project.notes.map(note=>pitches.has(note.id)?{...note,midi:pitches.get(note.id)}:note)};
}

export const fragmentSpan=data=>data.span??Math.max(...data.notes.map(note=>note.start+note.duration),...(data.lyricBeats||[]).map(word=>word.end));

export function fragmentThumbnail({data,span,notation={}}){
  if(!data.notes.length||span<=0)return '';
  const padding=5,scale=Math.min(80,120000/span),width=span*scale+padding*2;
  const drawGap=(from,to)=>to>from?
    `<rect class="fragment-gap" x="${padding+from*scale}" y="10" width="${(to-from)*scale}" height="23" rx="3"/>`:'';
  let end=0,body='';
  data.notes.forEach((note,index)=>{
    const x=padding+note.start*scale,w=note.duration*scale;
    const center=x+w/2,rest=note.midi===null;
    const {digit,accidental,octave}=numberPitch(note.midi,notation.keys?.[index],notation.flats);
    const readable=w>=(accidental?15:8);
    const tone=rest?'rest':note.reviewStatus==='reviewed'?'reviewed':'note';
    const title=rest?tr('休止','Rest','休符'):pitchName(note.midi);
    body+=drawGap(end,note.start);
    body+=`<g><title>${escapeXML(title)} · ${note.duration} ${tr('拍','beats','拍')}</title>`;
    body+=`<rect class="fragment-${tone}" x="${x}" y="7" width="${Math.max(.5,w-Math.min(1,w/2))}" height="29" rx="3"/>`;
    if(readable){
      body+=`<text x="${center}" y="26">${accidental}${digit}</text>`;
      for(let i=0;i<Math.abs(octave);i++){
        const y=octave>0?13-i*2.8:30+i*2.8;
        body+=`<circle cx="${center}" cy="${y}" r="1"/>`;
      }
    }else{
      body+=`<path d="M${center} 17v9"/>`;
    }
    body+='</g>';
    end=Math.max(end,note.start+note.duration);
  });
  return `<svg width="${width}" height="43" viewBox="0 0 ${width} 43" aria-hidden="true">${body}${drawGap(end,span)}</svg>`;
}

const pitchNotes=notes=>notes.filter(note=>note.midi!==null);
const pitchCountText=(source,target)=>tr(
  `片段 ${source} 音，当前选中 ${target} 音（休止不计）。`,
  `Clip: ${source} pitched notes. Selection: ${target} (rests excluded).`,
  `クリップは ${source} 音、選択範囲は ${target} 音です（休符を除く）。`
);

const labels={
  title:['片段剪贴板','Clip clipboard','クリップ置き場'],
  save:['存入剪贴板','Save selection','選択範囲を保存'],
  close:['收起','Close','閉じる'],
  empty:['选中谱面上的音符，再点「存入剪贴板」。','Select notes on the score, then use Save selection.','譜面で音符を選び、「選択範囲を保存」を押します。'],
  clip:['片段','Clip','クリップ'],
  name:['片段名称','Clip name','クリップ名'],
  thumbnail:['片段音符缩略图','Clip note preview','クリップの音符プレビュー'],
  preview:['试听','Audition','試聴'],
  stop:['停止试听','Stop audition','試聴を停止'],
  load:['设为当前复制内容','Use for Ctrl+V','Ctrl+V 用にセット'],
  paste:['整段粘贴','Paste clip','クリップを貼り付け'],
  pitch:['仅贴音高','Paste pitches only','音高のみ貼り付け'],
  remove:['移除片段','Remove clip','クリップを削除'],
  beat:['粘贴拍位','Paste beat','貼り付け位置（拍）'],
  playhead:['取播放位置','Use playhead','再生位置を使う'],
  overwrite:['覆盖目标音符','Overwrite notes','貼り付け先の音符を上書き'],
  overwriteLyrics:['覆盖目标歌词','Overwrite lyrics','貼り付け先の歌詞を上書き'],
  full:['剪贴板已满（20 条），移除一条后可继续存入。','The clipboard holds 20 clips. Remove one to save another.','クリップは 20 件までです。追加するには 1 件削除してください。'],
};
const label=key=>tr(...labels[key]);
const LIMIT=20;

export function installFragmentClipboard({getState,capture,load,paste,pastePitches,preview,stopPreview,setBeat,usePlayhead,setOverwriteNotes,setOverwriteLyrics,onError}){
  const toolbarPaste=document.getElementById('toolbarPaste');
  const toggle=document.createElement('button');
  toggle.type='button';
  toggle.id='fragmentClipboardToggle';
  toggle.setAttribute('aria-controls','fragmentClipboard');
  toggle.setAttribute('aria-expanded','false');
  toolbarPaste.after(toggle);

  const panel=document.createElement('section');
  panel.id='fragmentClipboard';
  panel.hidden=true;
  panel.setAttribute('aria-labelledby',toggle.id);
  panel.innerHTML=`<div class="fragment-actions">
    <button type="button" data-control="save" data-label="save"></button>
    <button type="button" data-control="close" data-label="close"></button>
  </div>
  <p class="hint" data-control="empty" data-label="empty"></p>
  <div data-control="details" hidden>
    <div class="fragment-actions">
      <label><span data-label="clip"></span> <select data-control="clip"></select></label>
      <label><span data-label="name"></span> <input data-control="name" maxlength="60"></label>
    </div>
    <div class="fragment-thumbnail" data-control="thumbnail" role="region" tabindex="0" hidden></div>
    <div class="fragment-actions">
      <button type="button" data-control="preview"></button>
      <button type="button" data-control="load" data-label="load"></button>
      <button type="button" data-control="pitch" data-label="pitch"></button>
      <button type="button" data-control="remove" data-label="remove"></button>
      <span class="hint" data-control="match" role="status"></span>
    </div>
    <div class="fragment-actions">
      <label><span data-label="beat"></span> <input data-control="beat" type="number" min="1" max="14400" step="${EDIT_STEP}"></label>
      <button type="button" data-control="playhead" data-label="playhead"></button>
      <label class="checkbox"><input data-control="overwrite" type="checkbox"><span data-label="overwrite"></span></label>
      <label class="checkbox" data-control="lyricOption"><input data-control="overwriteLyrics" type="checkbox"><span data-label="overwriteLyrics"></span></label>
      <button type="button" data-control="paste" data-label="paste"></button>
    </div>
  </div>
  <p class="hint" data-control="full" data-label="full" hidden></p>`;
  toggle.closest('.score-toolbar').after(panel);

  const $=key=>panel.querySelector(`[data-control="${key}"]`);
  const list=$('clip'),name=$('name'),beat=$('beat'),thumbnail=$('thumbnail');
  const clips=new Map();
  let serial=0,previewing=false;
  const current=()=>clips.get(list.value);
  const clipName=clip=>clip.name||`${label('clip')} ${clip.id}`;
  function refresh(){
    if(panel.hidden)return;
    const clip=current(),source=clip?.pitchCount??0;
    const {busy,count,pitchedCount,pasteBeat,overwriteNotes,overwriteLyrics}=getState(clip?.data.kind==='mixed');
    $('save').disabled=busy||!count||clips.size>=LIMIT;
    $('full').hidden=clips.size<LIMIT;
    $('empty').hidden=Boolean(clip);
    $('details').hidden=!clip;
    $('preview').textContent=label(previewing?'stop':'preview');
    $('preview').disabled=!source||busy&&!previewing;
    $('load').disabled=$('paste').disabled=$('playhead').disabled=beat.disabled=$('overwrite').disabled=$('overwriteLyrics').disabled=busy;
    const target=pitchedCount;
    $('pitch').disabled=busy||!source||source!==target;
    const match=clip?pitchCountText(source,target):'';
    if($('match').textContent!==match)$('match').textContent=match;
    if(document.activeElement!==beat)beat.value=pasteBeat;
    $('overwrite').checked=overwriteNotes;
    $('lyricOption').hidden=clip?.data.kind!=='mixed';
    $('overwriteLyrics').checked=overwriteLyrics;
  }
  function renderList(id=list.value){
    list.replaceChildren(...Array.from(clips.values(),clip=>{
      const beats=+clip.span.toFixed(4),n=clip.data.notes.length,words=clip.data.lyrics?.length??0;
      const summary=tr(`${n} 音 · ${beats} 拍`,`${n} notes · ${beats} beats`,`${n} 音 · ${beats} 拍`);
      const lyrics=words?tr(` · ${words} 条歌词`,` · ${words} lyric items`,` · 歌詞 ${words} 件`):'';
      return new Option(`${clipName(clip)} · ${summary}${lyrics}`,clip.id);
    }));
    if(clips.has(id))list.value=id;
    const clip=current();
    name.value=clip?clipName(clip):'';
    thumbnail.innerHTML=clip?fragmentThumbnail(clip):'';
    thumbnail.hidden=!thumbnail.firstElementChild;
    thumbnail.scrollLeft=0;
    refresh();
  }
  function translate(){
    toggle.textContent=label('title');
    thumbnail.setAttribute('aria-label',label('thumbnail'));
    for(const el of panel.querySelectorAll('[data-label]'))el.textContent=label(el.dataset.label);
    renderList();
  }
  function show(open){
    if(!open)stopPreview();
    panel.hidden=!open;
    toggle.setAttribute('aria-expanded',String(open));
    if(open)refresh();
  }
  function run(control,fn){
    $(control).addEventListener('click',async()=>{try{await fn();}catch(error){onError(error);}});
  }
  const keepButtonSpace=event=>{
    if(event.code==='Space'&&event.target.matches('button'))event.stopPropagation();
  };
  toggle.addEventListener('keydown',keepButtonSpace);
  panel.addEventListener('keydown',keepButtonSpace);
  thumbnail.addEventListener('keydown',event=>event.stopPropagation());
  toggle.addEventListener('click',()=>show(panel.hidden));
  run('close',()=>{show(false);toggle.focus();});
  run('save',()=>{
    if(clips.size>=LIMIT)return;
    const {data,bpm,notation}=capture();
    stopPreview();
    const id=String(++serial),span=fragmentSpan(data);
    clips.set(id,{id,data,bpm,span,notation,pitchCount:pitchNotes(data.notes).length});
    renderList(id);
  });
  list.addEventListener('change',()=>{stopPreview();renderList();});
  name.addEventListener('change',()=>{
    if(!current())return;
    current().name=name.value.trim();
    renderList();
  });
  name.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();name.blur();}});
  run('remove',()=>{stopPreview();clips.delete(list.value);renderList();if(!clips.size)$('save').focus();else list.focus();});
  run('preview',async()=>{
    if(previewing){stopPreview();return;}
    await preview(current(),()=>{previewing=true;refresh();});
  });
  run('load',()=>load(current().data));
  run('paste',()=>paste(current().data));
  run('pitch',()=>pastePitches(current().data));
  run('playhead',usePlayhead);
  beat.addEventListener('change',()=>{setBeat(beat.value);refresh();});
  $('overwrite').addEventListener('change',event=>{setOverwriteNotes(event.target.checked,current()?.data.kind==='mixed');refresh();});
  $('overwriteLyrics').addEventListener('change',event=>{setOverwriteLyrics(event.target.checked);refresh();});
  onLanguageChange(translate);
  translate();
  return {refresh,previewEnded(){previewing=false;refresh();}};
}
