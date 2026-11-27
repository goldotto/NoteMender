import {tr,onLanguageChange} from './i18n.mjs';
import {muTrackAnalyses,muTrackWindow,audibleMuTracks,muInstrumentLabel,muInstrumentColor,applyMuRollEdits,muRollEditKey,muInstruments} from './muscriptor-tracks.mjs';
import {MU_MODELS,muVariantFromModel} from './muscriptor-spec.mjs';
import {monoSamples} from './audio.mjs';
import {muDuplicateIds,muMoveNotes,scanMuVocalNotes} from './muscriptor-relabel.mjs';

function element(tag,text='',className=''){
  const node=document.createElement(tag);
  node.textContent=text;
  if(className)node.className=className;
  return node;
}
function button(label,action,disabled=false,pressed){
  const node=element('button',label);
  node.type='button';
  node.disabled=disabled;
  if(pressed!==undefined)node.setAttribute('aria-pressed',String(pressed));
  node.addEventListener('click',action);
  return node;
}

function showRollShortcut(control,keys,label){
  const key=element('kbd',label,'button-shortcut');
  key.setAttribute('aria-hidden','true');
  control.setAttribute('aria-keyshortcuts',keys);
  control.append(key);
}

const keyWidth=42, top=24;
function pianoRoll(canvas,width,zoom,window,selected,solo,muted,noteId,ghost,bounds,marked,box){
  const pitches=[...window.tracks.values()].flatMap(notes=>notes.map(note=>note.midi));
  let low=60,high=72;
  if(pitches.length){
    low=pitches.reduce((a,b)=>Math.min(a,b))-2;high=pitches.reduce((a,b)=>Math.max(a,b))+2;
    const gap=Math.max(0,12-(high-low));
    low=Math.max(0,low-Math.ceil(gap/2));high=Math.min(127,high+Math.floor(gap/2));
  }
  if(bounds)({low,high}=bounds);
  const rows=high-low+1,row=Math.max(3,Math.min(15,Math.floor(268/rows))),height=top+rows*row;
  const pixels=Math.max(1,(Math.floor(width)-keyWidth)*zoom),dpr=Math.min(2,devicePixelRatio||1,16384/(keyWidth+pixels));
  canvas.style.width=(keyWidth+pixels)+'px';canvas.style.height=height+'px';
  const pixelWidth=Math.ceil((keyWidth+pixels)*dpr),pixelHeight=Math.ceil(height*dpr);
  if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight;}
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const x=second=>keyWidth+(second-window.from)/(window.to-window.from)*pixels;
  const y=midi=>top+(high-midi)*row;
  ctx.fillStyle='#f8faf5';ctx.fillRect(0,0,keyWidth+pixels,height);
  ctx.font='11px system-ui';ctx.textBaseline='middle';
  for(let midi=high;midi>=low;midi--){
    const black=[1,3,6,8,10].includes(midi%12),offset=y(midi);
    ctx.fillStyle=black?'#edf1e9':'#fbfcfa';ctx.fillRect(keyWidth,offset,pixels,row);
    ctx.fillStyle=black?'#445649':'#fff';ctx.fillRect(0,offset,black?keyWidth-11:keyWidth,row-.4);
    if(midi%12===0&&row>=8){ctx.fillStyle='#476052';ctx.fillText('C'+(Math.floor(midi/12)-1),4,offset+row/2);}
  }
  const span=window.to-window.from;
  const step=[.25,.5,1,2,5,10,15,30,60,120,300,600,1200].find(n=>n>=span*66/pixels)||1200;
  for(let t=Math.ceil(window.from/step)*step;t<window.to;t+=step){
    const position=x(t);
    ctx.strokeStyle='#d9e1d6';ctx.beginPath();ctx.moveTo(position,top);ctx.lineTo(position,height);ctx.stroke();
    ctx.fillStyle='#496453';
    const sec=Math.floor(t),seconds=String(sec%60).padStart(2,'0');
    ctx.fillText(Math.floor(sec/60)+':'+seconds+(step<1?'.'+Math.round(t%1*100):''),position+4,top/2);
  }
  const layers=[...window.tracks].sort(([a],[b])=>Number(a===selected)-Number(b===selected));
  for(const [name,notes] of layers){
    const dimmed=solo?name!==solo:muted.has(name);
    ctx.globalAlpha=dimmed ? .19 : name===selected ? .99 : .76;
    ctx.fillStyle=muInstrumentColor(name);
    for(const n of notes)ctx.fillRect(x(n.start),y(n.midi)+.5,Math.max(1,x(n.end)-x(n.start)-.6),row-1);
    ctx.fillStyle='#303627';
    ctx.globalAlpha*=.48;
    for(const n of notes)ctx.fillRect(x(n.start),y(n.midi)+.5,.8,row-1);
  }
  ctx.globalAlpha=1;
  for(const notes of window.tracks.values())for(const n of notes)if(marked.has(n.id)){
    ctx.strokeStyle=marked.get(n.id);ctx.lineWidth=1.5;
    ctx.strokeRect(x(n.start),y(n.midi)+.5,Math.max(2,x(n.end)-x(n.start)),row-1);
  }
  ctx.lineWidth=1;
  if(box){ctx.fillStyle='#2e765b33';ctx.strokeStyle='#2e765b';ctx.fillRect(...box);ctx.strokeRect(...box);}
  const active=ghost||window.tracks.get(selected)?.find(n=>n.id===noteId);
  if(active){
    const width=Math.max(2,x(active.end)-x(active.start));
    if(ghost){ctx.fillStyle=muInstrumentColor(active.instrument);ctx.fillRect(x(active.start),y(active.midi),width,row);}
    ctx.strokeStyle='#183e31';ctx.strokeRect(x(active.start)+.5,y(active.midi)+.5,Math.max(1,width-1),row-1);
  }
  return {height,x,pixels,low,high,row};
}

export function installMuTracks(panel,{context,fetchResult,describeInput,formatTime,onPlay,onStop,onCreate,getEdits,onEdit,onGenerate,onCancel,getSpeed,onSpeed,loadVocalReference,loadCorrectionEvidence}){
  const heading=panel.querySelector('summary'),host=panel.querySelector('.mu-tracks-body');
  const cache=new Map(),histories=new Map();
  let scope=null,choices=[],inputs=[],analysis=null,input=null,raw=null,window=null,generating=null;
  let selected=null,solo=null,muted=new Set(),cursor=0,zoom=1,mode='mu-midi';
  let editing=false,noteId=null,drag=null,history=null,edits=new Map();
  let boxMode=false,selectedIds=new Set(),mergeTracks=new Set(),moveTarget='voice',mergeTarget='voice';
  let correctionOpen=false,mergeOpen=false,scan=null,suggestions=null,reference=null,checked=new Set(),preview=null,scanMessage='';
  let request=null,scoring=null,error='',stats=null,playing=null,starting=null;
  let canvas=null,marker=null,metrics=null,time=null,viewport=null,seekSlider=null,previewSeek=null,playToggle=null,speedSelect=null;
  const lang=(zh,en,ja)=>tr(zh,en,ja);
  const editKey=()=>muRollEditKey(scope.section,scope.range,analysis);
  const activeNote=()=>window?.tracks.get(selected)?.find(note=>note.id===noteId);

  function draw(){
    if(!viewport?.clientWidth||!window?.tracks.size||!canvas)return;
    const marked=new Map();
    if(correctionOpen)for(const group of suggestions||[])for(const id of group.ids)marked.set(id,group.repeated||group.alsoInBacking?'#985812':'#71379d');
    for(const id of selectedIds)marked.set(id,'#066644');
    metrics=pianoRoll(canvas,viewport.clientWidth,zoom,window,selected,solo,muted,noteId,drag?.ghost,drag?.bounds,marked,drag?.box);
    marker.style.height=metrics.height+'px';
    updateCursor();
  }
  const observer=new ResizeObserver(draw);
  function updateCursor(){
    const position=previewSeek??cursor;
    if(metrics&&marker)marker.style.left=metrics.x(position)+'px';
    if(time)time.textContent=formatTime(position);
    if(seekSlider&&previewSeek===null)seekSlider.value=String(position);
  }
  function paintTransport(){
    if(!playToggle)return;
    const active=Boolean(starting||playing);
    playToggle.textContent=active?lang('暂停','Pause','一時停止'):lang('播放','Play','再生');
    playToggle.disabled=!window.tracks.size||mode==='original'&&!scope.canPlayOriginal;
  }
  function sync(state){
    const next=state?.key===scope?.id?state:null;
    if(next)cursor=next.position;
    playing=next?.playing?next.kind:null;
    paintTransport();updateCursor();
  }
  function stop(discard){
    starting=null;onStop(discard);playing=null;paintTransport();
  }
  async function play(){
    if(!window?.tracks.size||mode==='original'&&!scope.canPlayOriginal||mode==='mu-vocals'&&!reference)return;
    const ticket={};starting=ticket;paintTransport();
    const position=cursor>=window.to-.015?window.from:cursor;
    const kind=mode,range=preview||window;
    const playedSolo=preview?'voice':solo;
    const notes=audibleMuTracks(range.tracks,playedSolo,muted);
    const mixKey=playedSolo?[playedSolo]:[null,...[...muted].sort()];
    try{await onPlay({key:scope.id,range,position,notes,mixKey,reference},kind);}
    catch(failure){if(starting===ticket&&failure.name!=='AbortError'){error=failure.message;render();}}
    finally{if(starting===ticket){starting=null;paintTransport();}}
  }
  function chooseMode(next){
    if(mode===next)return;
    const resume=playing||starting;
    mode=next;render();if(resume)play();
  }
  function refreshMix(){
    if(playing||starting)play();
  }
  function chooseTrack(name){
    scoring?.abort();scoring=null;
    preview=null;selectedIds.clear();
    selected=name;noteId=null;solo=solo===name?null:name;if(solo)muted.delete(name);stats=null;render();
    refreshMix();
  }
  function refresh(){
    const current=context(),available=muTrackAnalyses(current?.variants||[],current?.active?.id);
    const id=current&&JSON.stringify([current.section.id,current.range.from,current.range.to,current.revision]);
    const changed=id!==scope?.id;
    if(scope?.revision!==current?.revision)histories.clear();
    if(current&&!current.canPlayOriginal&&mode==='original')mode='mu-midi';
    scope=current?{...current,id}:null;
    choices=available;
    inputs=(current?.inputs||[]).filter(item=>!available.some(a=>a.candidate.source===item.source&&
      (item.source==='original'||a.candidate.resourceId===item.resourceId||(!a.candidate.resourceId&&item.inputModel===a.candidate.inputModel))&&
      a.origin<=current.range.from+.02&&a.end>=current.range.to-.02));
    panel.hidden=!available.length&&!inputs.length;
    if(changed||analysis&&!choices.some(a=>a.key===analysis.key)){
      stop(true);clearRequest();generating=null;input=null;
      analysis=choices.find(a=>a.candidate.id===current?.active?.id)||choices.find(a=>a.candidate.source==='original')||
        choices.find(a=>a.candidate.source===current?.source)||choices[0];
      resetRoll();zoom=1;
      if(panel.open&&analysis){load();return;}
    }
    if(!analysis&&!input){analysis=choices[0];input=analysis?null:inputs[0];if(panel.open&&analysis){load();return;}}
    if(panel.open)render();
  }
  function resetScan(){
    scan?.abort();scan=null;suggestions=null;checked.clear();preview=null;scanMessage='';
  }
  async function findVoice(){
    const wasPreviewing=Boolean(preview);
    resetScan();
    if(wasPreviewing)refreshMix();
    const job=new AbortController(),{signal}=job,range=window;
    scan=job;render();
    try{
      const audio=await loadVocalReference(range,signal);
      signal.throwIfAborted();
      if(!audio){scanMessage=lang('本段缺少对齐的人声分轨。','No aligned vocal stem is available for this section.','この区間に同期したボーカルトラックがありません。');return;}
      reference=audio;
      const {origin,buffer,resourceId}=audio,rate=8000;
      const start=Math.max(origin,range.from),end=Math.min(origin+buffer.duration,range.to);
      const samples=await monoSamples(buffer,start-origin,end-origin,rate);
      const comparison=choices.find(item=>item.candidate.source==='vocals'&&resourceId&&item.candidate.resourceId===resourceId&&
        item.origin<=range.from+.001&&item.end>=range.to-.001);
      let referenceNotes=[];
      if(comparison){
        try{
          const id=comparison.candidate.analysisId;
          const result=cache.get(id)||await fetchResult(id,signal);
          referenceNotes=muTrackWindow(result,comparison.origin,range,id).tracks.get('voice')||[];
        }catch{signal.throwIfAborted();}
      }
      const evidence=await loadCorrectionEvidence?.(audio,range,signal);
      signal.throwIfAborted();
      suggestions=await scanMuVocalNotes({samples,rate,start},[...range.tracks.values()].flat(),referenceNotes,signal,evidence);
      signal.throwIfAborted();
      checked=new Set(suggestions.filter(group=>!group.repeated&&!group.alsoInBacking));
      if(!suggestions.length)scanMessage=lang('本段没有找到足够证据的错标音符。','No notes with enough evidence of mislabelling in this section.','この区間で誤分類を示す十分な証拠のある音符はありません。');
      else if(!evidence?.consensus)scanMessage=lang('使用基础音高证据，请试听核对。','The scan used basic pitch evidence. Audition to verify.','基本の音高検出結果です。試聴して確認してください。');
    }catch(failure){
      if(!signal.aborted)scanMessage=failure.message;
    }finally{if(scan===job){scan=null;render();}}
  }
  function notesWithIds(ids){
    return [...window.tracks.values()].flat().filter(note=>ids.has(note.id));
  }
  function selectionNotes(){
    if(selectedIds.size)return notesWithIds(selectedIds);
    const note=activeNote();
    return note?[note]:[];
  }
  function pickedVoiceNotes(){
    return notesWithIds(new Set([...checked].flatMap(group=>group.ids)));
  }
  function setChecked(groups){
    checked=new Set(groups);
    if(preview){
      const picked=pickedVoiceNotes();
      preview=picked.length?applyMuRollEdits(raw,analysis.candidate.analysisId,muMoveNotes(edits,picked,'voice')):null;
      refreshMix();
    }
    render();
  }
  function migrate(notes,target){
    if(!notes.length||!target)return;
    selected=target;solo=target;muted.delete(target);noteId=null;
    if(mode==='mu-vocals')mode='mu-midi';
    commitBatch(muMoveNotes(edits,notes,target));
  }
  function targetControl(target,change,focus){
    const label=element('label',lang('目标轨','Target track','移動先トラック'));
    const select=element('select');select.dataset.muFocus=focus;
    const names=new Set(['voice',...window.tracks.keys(),...muInstruments]);
    for(const name of names){
      const missing=!window.tracks.has(name);
      select.add(new Option(muInstrumentLabel(name)+(missing?' · '+lang('新建','New','新規'):''),name));
    }
    select.value=target;select.addEventListener('change',()=>{change(select.value);render();});
    label.append(select);return label;
  }
  function checkbox(label,checked,callback,focus){
    const field=element('label',label),input=element('input');
    input.type='checkbox';input.checked=checked;input.dataset.muFocus=focus;
    input.addEventListener('change',()=>callback(input.checked));
    field.prepend(input);return field;
  }
  function showGroup(group){
    seek(group.from);
    if(viewport&&metrics)viewport.scrollLeft=Math.max(0,metrics.x(group.from)-viewport.clientWidth/3);
  }
  function renderCorrection(){
    const panel=element('section','','mu-correction');
    const automatic=element('div','','mu-tracks-actions');
    const find=scan?button(lang('取消扫描','Cancel scan','検出を中止'),()=>{resetScan();render();}):
      button(lang('找回人声音符','Find mislabelled vocals','誤分類された歌声を探す'),findVoice);
    find.dataset.muFocus='find-vocals';automatic.append(find);
    if(reference){
      const vocals=button(lang('人声参考','Vocal reference','ボーカル参照'),()=>chooseMode('mu-vocals'),false,mode==='mu-vocals');
      vocals.dataset.muFocus='reference';automatic.append(vocals);
    }
    panel.append(automatic);
    if(scan||scanMessage){
      const status=element('p',scan?lang('正在检查人声分轨…','Checking vocal stem…','ボーカルトラックを確認中…'):scanMessage,'hint');
      status.setAttribute('role','status');panel.append(status);
    }
    if(suggestions?.length){
      const list=element('div','','mu-correction-results');
      list.setAttribute('aria-label',lang('疑似错标的音符','Possibly mislabelled notes','誤分類の候補'));
      for(const [index,group] of suggestions.entries()){
        const row=element('div','','mu-tracks-actions');
        const label=muInstrumentLabel(group.instrument)+' · '+formatTime(group.from)+'–'+formatTime(group.to)+' · '+group.ids.length;
        row.append(checkbox(lang('迁移','Move','移動'),checked.has(group),value=>{
          const next=new Set(checked);
          if(value)next.add(group);else next.delete(group);
          setChecked(next);
        },'suggestion:'+index),button(label,()=>showGroup(group)));
        if(group.repeated)row.append(element('span',lang('可能重复','Possible duplicate','重複の可能性'),'hint'));
        if(group.alsoInBacking)row.append(element('span',lang('伴奏也有同音','Same pitch in accompaniment','伴奏にも同じ音高'),'hint'));
        if(group.backed)row.append(element('span',lang('人声缓存吻合','Matches vocal cache','歌声キャッシュと一致')+' · '+group.backed,'hint'));
        list.append(row);
      }
      const chosen=pickedVoiceNotes();
      const toggle=button(preview?lang('回听迁移前','Hear before move','移動前を試聴'):lang('试听迁移后的人声轨','Preview corrected vocal track','移動後の歌声を試聴'),()=>{
        preview=preview?null:applyMuRollEdits(raw,analysis.candidate.analysisId,muMoveNotes(edits,chosen,'voice'));
        solo='voice';mode='mu-midi';render();play();
      },!chosen.length);
      toggle.dataset.muFocus='preview-relabel';
      const apply=button(lang('应用所选迁移','Apply selected moves','選んだ移動を適用')+' · '+chosen.length,()=>migrate(chosen,'voice'),!chosen.length);
      apply.dataset.muFocus='apply-relabel';
      const only=suggestions.filter(group=>group.instrument===selected&&!group.repeated);
      const onlyTrack=button(lang('只勾选当前轨','Select suggestions for this track','選択トラックの候補のみ'),()=>setChecked(only),!only.length);
      const clear=button(lang('取消全选','Clear selection','選択を解除'),()=>setChecked([]),!checked.size);
      onlyTrack.dataset.muFocus='suggest-current';clear.dataset.muFocus='suggest-clear';
      automatic.append(onlyTrack,clear,toggle,apply);panel.append(list);
    }
    const merge=element('details');
    merge.open=mergeOpen;
    merge.addEventListener('toggle',()=>{mergeOpen=merge.open;});
    merge.append(element('summary',lang('合并轨道','Merge tracks','トラックを結合')));
    const tracks=element('div','','mu-tracks-actions');
    for(const name of window.tracks.keys())if(name!==mergeTarget){
      tracks.append(checkbox(muInstrumentLabel(name),mergeTracks.has(name),value=>{
        if(value)mergeTracks.add(name);else mergeTracks.delete(name);render();
      },'merge:'+name));
    }
    const actions=element('div','','mu-tracks-actions');
    const source=[...mergeTracks].filter(name=>name!==mergeTarget).flatMap(name=>window.tracks.get(name)||[]);
    const duplicates=muDuplicateIds(source,window.tracks.get(mergeTarget)).size;
    const apply=button(lang('应用合并','Apply merge','結合を適用'),()=>{mergeTracks.clear();migrate(source,mergeTarget);},!source.length);
    apply.dataset.muFocus='apply-merge';
    actions.append(targetControl(mergeTarget,name=>{mergeTarget=name;mergeTracks.delete(name);},'merge-target'),
      element('span',lang('移动音符 / 疑似重复','Notes to move / Possible duplicates','移動する音符 / 重複候補')+' · '+source.length+' / '+duplicates,'hint'),apply);
    merge.append(tracks,actions);panel.append(merge);
    return panel;
  }

  function clearRequest(){request?.abort();request=null;}
  function resetRoll(){
    scoring?.abort();scoring=null;
    resetScan();reference=null;selectedIds=new Set();mergeTracks=new Set();
    if(mode==='mu-vocals')mode='mu-midi';
    raw=window=null;previewSeek=null;selected=noteId=solo=drag=null;
    muted.clear();stats=null;error='';edits=new Map();history=null;
  }
  async function load(){
    clearRequest();
    const chosen=analysis,captured=scope,controller=new AbortController();
    request=controller;resetRoll();render();
    try{
      const id=chosen.candidate.analysisId;
      let result=cache.get(id);
      if(!result){
        result=await fetchResult(id,controller.signal);
        controller.signal.throwIfAborted();cache.set(id,result);
        if(cache.size>4)cache.delete(cache.keys().next().value);
      }
      if(request!==controller||captured.id!==scope?.id)return;
      raw=muTrackWindow(result,chosen.origin,captured.range,id);
      const key=editKey();edits=getEdits(key);window=applyMuRollEdits(raw,id,edits);
      history=histories.get(key)||{undo:[],redo:[]};
      cursor=window.from;
      const preferred=context()?.active?.instrument;
      if(window.tracks.has(preferred))selected=preferred;
    }catch(failure){
      if(!controller.signal.aborted)error=failure.message;
    }finally{if(request===controller){request=null;render();}}
  }
  async function generate(){
    const requested=input,id=scope.id;
    generating=requested;error='';render();
    try{
      const candidate=await onGenerate(requested);
      if(scope?.id!==id||generating!==requested)return;
      analysis=choices.find(a=>a.candidate.id===candidate.id)||
        choices.find(a=>a.candidate.analysisId===candidate.analysisId&&a.candidate.source===candidate.source&&a.candidate.resourceId===candidate.resourceId);
      input=null;generating=null;
      if(analysis){await load();return;}
    }catch(failure){if(generating===requested&&failure.name!=='AbortError')error=failure.message;}
    finally{if(generating===requested){generating=null;render();}}
  }
  function applyEdits(next){
    edits=next;
    window=applyMuRollEdits(raw,analysis.candidate.analysisId,edits);
    if(!window.tracks.has(selected))selected=null;
    if(!window.tracks.has(solo))solo=null;
    if(!activeNote())noteId=null;
    selectedIds.clear();resetScan();
    onEdit(editKey(),edits);stats=null;render();refreshMix();
  }
  function commit(id,note){
    const next=new Map(edits),original=[...raw.tracks.values()].flat().find(n=>n.id===id);
    if(original&&['start','end','midi','instrument'].every(key=>note[key]===original[key]))next.delete(id);
    else next.set(id,note);
    commitBatch(next);
  }
  function removeNotes(notes){
    const next=new Map(edits);
    for(const note of notes){
      if(note.added===true)next.delete(note.id);
      else next.set(note.id,null);
    }
    commitBatch(next);
  }
  function commitBatch(next){
    const key=editKey();
    histories.set(key,history);history.undo.push(edits);history.redo.length=0;
    if(history.undo.length>40)history.undo.shift();
    applyEdits(next);
  }
  function restore(direction){
    const from=history[direction],to=history[direction==='undo'?'redo':'undo'];
    if(!from.length)return;
    to.push(edits);applyEdits(from.pop());
  }
  function seek(value){
    cursor=value;updateCursor();if(playing||starting)play();
  }
  function coordinates(event){
    const rect=canvas.getBoundingClientRect();
    return {x:event.clientX-rect.left,y:event.clientY-rect.top};
  }
  function seconds(x){
    return window.from+Math.max(0,Math.min(1,(x-keyWidth)/metrics.pixels))*(window.to-window.from);
  }
  function pitch(y){return Math.max(0,Math.min(127,metrics.high-Math.floor((y-top)/metrics.row)));}
  function hit(x,y){
    const notes=window.tracks.get(selected)||[];
    return notes.findLast(n=>n.midi===pitch(y)&&x>=metrics.x(n.start)-1&&x<=Math.max(metrics.x(n.start)+2,metrics.x(n.end)));
  }
  function canvasDown(event){
    if(!editing||!metrics||event.button!==0||(!selected&&!boxMode))return;
    const {x,y}=coordinates(event);
    if(x<keyWidth||y<top||y>=metrics.height)return;
    if(boxMode){
      drag={pointer:event.pointerId,x,y,box:[x,y,0,0]};
      canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);return;
    }
    const note=hit(x,y),width=note?metrics.x(note.end)-metrics.x(note.start):0;
    const resize=note&&width>=7&&metrics.x(note.end)-x<=Math.min(7,width/2);
    noteId=note?.id??null;
    drag={pointer:event.pointerId,x,y,note,resize,bounds:{low:metrics.low,high:metrics.high},ghost:null};
    canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
  }
  function canvasMove(event){
    if(!editing||!metrics)return;
    const {x,y}=coordinates(event);
    if(boxMode){
      canvas.style.cursor='crosshair';
      if(drag?.pointer===event.pointerId){
        const right=Math.max(keyWidth,Math.min(x,keyWidth+metrics.pixels)),bottom=Math.max(top,Math.min(y,metrics.height));
        drag.box=[Math.min(right,drag.x),Math.min(bottom,drag.y),Math.abs(right-drag.x),Math.abs(bottom-drag.y)];draw();
      }
      return;
    }
    if(!drag){
      const note=y>=top&&x>=keyWidth?hit(x,y):null;
      const width=note?metrics.x(note.end)-metrics.x(note.start):0;
      canvas.style.cursor=width>=7&&metrics.x(note.end)-x<=Math.min(7,width/2)?'ew-resize':note?'move':'crosshair';
      return;
    }
    if(drag.pointer!==event.pointerId||!drag.ghost&&Math.hypot(x-drag.x,y-drag.y)<3)return;
    const at=seconds(x),initial=seconds(drag.x),note=drag.note;
    const limit=(value,min,max)=>Math.max(min,Math.min(max,value));
    const minimum=Math.min(.015,note?note.end-note.start:window.to-window.from);
    let start,end,midi;
    if(!note){start=Math.min(at,initial);end=Math.max(at,initial);midi=pitch(drag.y);}
    else if(drag.resize){start=note.start;end=limit(note.end+at-initial,start+minimum,window.to);midi=note.midi;}
    else{
      const duration=note.end-note.start;
      start=limit(note.start+at-initial,window.from,window.to-duration);end=start+duration;
      midi=limit(note.midi+pitch(y)-pitch(drag.y),0,127);
    }
    drag.ghost={start,end,midi,instrument:selected,added:note?note.added===true:true};draw();
  }
  function canvasUp(event){
    if(!drag||drag.pointer!==event.pointerId)return;
    const {ghost,note,box}=drag;drag=null;
    if(box){
      const [x,y,w,h]=box;
      const tracks=solo?[window.tracks.get(solo)||[]]:[...window.tracks].filter(([track])=>!muted.has(track)).map(([,notes])=>notes);
      selectedIds=new Set(w>2||h>2?tracks.flat().filter(n=>n.end>=seconds(x)&&n.start<=seconds(x+w)&&n.midi<=pitch(y)&&n.midi>=pitch(y+h)).map(n=>n.id):[]);
      noteId=null;
      if(!selectedIds.size)seek(seconds(x));
      render();return;
    }
    selectedIds.clear();
    if(ghost&&ghost.end>ghost.start){
      noteId=note?.id||'edit_'+crypto.randomUUID();
      commit(noteId,ghost);
    }else{seek(seconds(coordinates(event).x));render();}
  }
  function canvasKey(event){
    if(!editing)return;
    const note=activeNote();
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){
      event.preventDefault();event.stopPropagation();restore(event.shiftKey?'redo':'undo');
    }else if(event.key==='Delete'||event.key==='Backspace'){
      const notes=selectionNotes();
      if(!notes.length)return;
      event.preventDefault();event.stopPropagation();removeNotes(notes);
    }else if(note&&(event.key==='ArrowUp'||event.key==='ArrowDown')){
      event.preventDefault();event.stopPropagation();
      const midi=Math.max(0,Math.min(127,note.midi+(event.key==='ArrowUp'?1:-1)));
      if(midi!==note.midi)commit(note.id,{start:note.start,end:note.end,midi,instrument:note.instrument,added:note.added===true});
    }
  }
  function setSpeed(speed){
    if(!speedSelect)return;
    const value=String(speed);
    for(const option of [...speedSelect.options])if(option.dataset.custom)option.remove();
    if(![...speedSelect.options].some(option=>option.value===value)){
      const option=new Option(value+'×',value);option.dataset.custom='true';speedSelect.add(option);
    }
    speedSelect.value=value;
  }

  function render(){
    heading.textContent=tr('MuScriptor 乐器轨','MuScriptor instrument tracks');
    const priorScroll=viewport?.scrollLeft||0,focused=document.activeElement?.dataset.muFocus;
    const priorResultsScroll=host.querySelector('.mu-correction-results')?.scrollTop||0;
    if(viewport)observer.unobserve(viewport);
    viewport=canvas=marker=metrics=time=seekSlider=playToggle=speedSelect=null;previewSeek=null;drag=null;
    host.replaceChildren();
    if(panel.hidden||!scope)return;
    if(!panel.open)return;

    const inputRow=element('label',tr('识别输入','Analysis input'),'mu-tracks-input');
    const select=element('select');
    const resultLabel=choice=>{
      const candidate=choice.candidate,variant=candidate.muVariant??muVariantFromModel(candidate.model)??'large';
      return describeInput(candidate)+' · '+MU_MODELS[variant].name+' · '+formatTime(choice.origin)+'–'+formatTime(choice.end);
    };
    for(const [index,choice] of choices.entries()){
      const label=resultLabel(choice),suffix=choices.filter(c=>resultLabel(c)===label).length>1?' · '+(index+1):'';
      select.add(new Option(label+suffix,'ready:'+index));
    }
    for(const [index,item] of inputs.entries()){
      select.add(new Option(describeInput(item)+' · '+lang('待识别','Not analyzed','未解析'),'input:'+index));
    }
    const chosenInput=inputs.findIndex(item=>item.source===input?.source&&item.resourceId===input?.resourceId);
    if(input&&chosenInput<0){
      select.add(new Option(describeInput(input),'pending'));
      select.value='pending';
    }else select.value=input?'input:'+chosenInput:'ready:'+choices.findIndex(c=>c.key===analysis?.key);
    select.dataset.muFocus='input';select.disabled=Boolean(generating);
    select.addEventListener('change',()=>{
      stop(true);clearRequest();
      const [kind,index]=select.value.split(':');
      if(kind==='ready'){input=null;analysis=choices[Number(index)];load();}
      else{analysis=null;input=inputs[Number(index)];resetRoll();render();}
    });
    inputRow.append(select);host.append(inputRow);
    if(error){const feedback=element('p',error,'hint');feedback.setAttribute('role','status');host.append(feedback);}
    if(input){
      const controls=element('div','','mu-tracks-actions');
      controls.append(generating?button(lang('取消识别','Cancel analysis','解析を中止'),onCancel):
        button(lang('识别此音轨','Analyze this input','この入力を解析'),generate,Boolean(context()?.busy)));
      host.append(controls);return;
    }
    if(request){host.append(element('p',tr('正在读取原始 MIDI 结果…','Loading the original MIDI result…'),'hint'));return;}
    if(!window){
      if(error&&analysis)host.append(button(tr('重试读取','Retry loading'),load));
      return;
    }
    if(!window.tracks.size&&!history?.undo.length&&!history?.redo.length){host.append(element('p',tr('本段在这份结果中没有 MIDI 音符。','This result has no MIDI notes in this section.'),'hint'));return;}

    host.append(element('p',tr('卷帘范围','Piano roll range')+' · '+formatTime(window.from)+'–'+formatTime(window.to),'hint'));
    const wrapper=element('div','','mu-tracks-layout');
    const list=element('div','','mu-tracks-list');
    for(const [name,notes] of [...window.tracks].sort(([a],[b])=>Number(b==='voice')-Number(a==='voice')||Number(a==='drums')-Number(b==='drums'))){
      const row=element('div','','mu-tracks-row');
      const track=button(muInstrumentLabel(name)+' · '+notes.length,()=>chooseTrack(name),false,selected===name);
      track.dataset.muFocus='track:'+name;track.title=name;
      const swatch=element('i');swatch.style.backgroundColor=muInstrumentColor(name);swatch.setAttribute('aria-hidden','true');
      track.prepend(swatch);
      const mute=button(tr('静音','Mute'),()=>{
        if(muted.has(name))muted.delete(name);else muted.add(name);
        solo=null;render();refreshMix();
      },false,muted.has(name));
      mute.setAttribute('aria-label',muInstrumentLabel(name)+' · '+tr('静音','Mute'));
      mute.dataset.muFocus='mute:'+name;
      row.append(track,mute);list.append(row);
    }
    const view=element('div','','mu-tracks-view');
    viewport=element('div','','mu-tracks-viewport');
    const chart=element('div','','mu-tracks-chart');
    canvas=element('canvas');canvas.tabIndex=0;canvas.dataset.muFocus='roll';
    canvas.classList.toggle('mu-editing',editing&&Boolean(selected));
    canvas.setAttribute('aria-label',tr('按原曲秒数显示的 MIDI 钢琴卷帘','MIDI piano roll in original audio seconds'));
    marker=element('span','','mu-tracks-cursor');marker.setAttribute('aria-hidden','true');
    if(editing){
      canvas.addEventListener('pointerdown',canvasDown);
      canvas.addEventListener('pointermove',canvasMove);
      canvas.addEventListener('pointerup',canvasUp);
      canvas.addEventListener('pointercancel',()=>{drag=null;draw();});
      canvas.addEventListener('keydown',canvasKey);
    }
    canvas.addEventListener('click',event=>{
      if(!metrics||event.offsetX<keyWidth||editing&&(selected||boxMode)&&event.offsetY>=top)return;
      seek(seconds(event.offsetX));
    });
    chart.append(canvas,marker);viewport.append(chart);view.append(viewport);

    const toolbar=element('div','','mu-tracks-actions');
    const originalMode=button(lang('原曲','Original','原曲'),()=>chooseMode('original'),!scope.canPlayOriginal,mode==='original');
    const midiMode=button('MIDI',()=>chooseMode('mu-midi'),false,mode==='mu-midi');
    originalMode.dataset.muFocus='mode-original';midiMode.dataset.muFocus='mode-midi';
    playToggle=button('',()=>{if(starting||playing)stop(false);else play();});
    playToggle.dataset.muFocus='play';paintTransport();
    seekSlider=element('input');seekSlider.type='range';seekSlider.min=String(window.from);seekSlider.max=String(window.to);
    seekSlider.step='.01';seekSlider.value=String(cursor);seekSlider.setAttribute('aria-label',tr('卷帘试听位置','Piano roll playback position'));
    seekSlider.addEventListener('input',()=>{previewSeek=Number(seekSlider.value);updateCursor();});
    seekSlider.addEventListener('change',()=>{const position=Number(seekSlider.value);previewSeek=null;seek(position);});
    time=element('output');
    const speedLabel=element('label',lang('速度','Speed','速度'));
    speedSelect=element('select');speedSelect.dataset.muFocus='speed';
    for(const speed of [.25,.5,.75,1,1.25,1.5,2])speedSelect.add(new Option(speed+'×',String(speed)));
    setSpeed(getSpeed());
    speedSelect.addEventListener('change',()=>{
      const pending=starting&&!playing;
      onSpeed(Number(speedSelect.value));if(pending)play();
    });
    speedLabel.append(speedSelect);
    const zoomLabel=element('label',tr('缩放','Zoom'));
    const magnify=element('select');
    for(const level of [1,2,4,8,16])magnify.add(new Option(level+'×',String(level)));
    magnify.value=String(zoom);
    magnify.addEventListener('change',()=>{zoom=Number(magnify.value);draw();viewport.scrollLeft=Math.max(0,metrics.x(cursor)-viewport.clientWidth/2);});
    zoomLabel.append(magnify);
    const reset=button(tr('恢复全轨','Restore all tracks'),()=>{
      solo=null;muted.clear();render();refreshMix();
    },!solo&&!muted.size);
    toolbar.append(originalMode,midiMode,playToggle,seekSlider,time,speedLabel,zoomLabel,reset);
    view.append(toolbar);
    wrapper.append(list,view);host.append(wrapper);

    const tools=element('div','','mu-tracks-actions');
    const edit=button(lang('编辑音符','Edit notes','音符を編集'),()=>{
      editing=!editing;noteId=null;boxMode=false;selectedIds.clear();render();
    },false,editing);
    edit.dataset.muFocus='edit';tools.append(edit);
    const undo=button(lang('撤销','Undo','元に戻す'),()=>restore('undo'),!history?.undo.length);
    const redo=button(lang('重做','Redo','やり直す'),()=>restore('redo'),!history?.redo.length);
    undo.dataset.muFocus='undo';redo.dataset.muFocus='redo';
    if(editing){
      const mac=/Mac|iPhone|iPad/.test(navigator.userAgentData?.platform||navigator.platform||'');
      showRollShortcut(undo,mac?'Meta+Z':'Control+Z',mac?'⌘Z':'Ctrl+Z');
      showRollShortcut(redo,mac?'Meta+Shift+Z':'Control+Shift+Z',mac?'⌘⇧Z':'Ctrl+Shift+Z');
    }
    if(editing||correctionOpen||history?.undo.length||history?.redo.length)tools.append(undo,redo);
    if(editing){
      const picked=selectionNotes();
      const deleteLabel=picked.length>1?lang('删除所选','Delete selected','選択した音符を削除')+' · '+picked.length:lang('删除音符','Delete note','音符を削除');
      const del=button(deleteLabel,()=>removeNotes(picked),!picked.length);
      showRollShortcut(del,'Delete Backspace','Delete / Backspace');
      const box=button(lang('框选音符','Box select','範囲選択'),()=>{boxMode=!boxMode;selectedIds.clear();noteId=null;render();},false,boxMode);
      box.dataset.muFocus='box';del.dataset.muFocus='delete';
      const chosen=picked.filter(n=>n.instrument!==moveTarget);
      const move=button(lang('移到轨道','Move to track','トラックへ移動')+' · '+chosen.length,()=>migrate(chosen,moveTarget),!chosen.length);
      move.dataset.muFocus='move';
      tools.append(del,box,targetControl(moveTarget,name=>{moveTarget=name;},'move-target'),move);
      tools.append(element('span',boxMode?
        lang('拖动框选音符，按 Delete 删除所选。','Drag to select notes, then press Delete to remove them.','ドラッグで範囲を選択し、Delete キーで削除します。'):
        selected?
        lang('拖音符移动，拖右边缘改时长，在空白处拖动新增。','Drag notes to move them, drag the right edge to resize, or drag empty space to add.','音符をドラッグして移動、右端で長さ変更、空白をドラッグして追加。'):
        lang('先选择要编辑的乐器轨。','Select an instrument track to edit.','編集する楽器トラックを選んでください。'),'hint'));
    }
    const correction=button(lang('轨道纠错','Track corrections','トラックの修正'),()=>{
      correctionOpen=!correctionOpen;
      if(!correctionOpen){
        const resume=Boolean(preview||mode==='mu-vocals');
        resetScan();reference=null;
        if(mode==='mu-vocals')mode='mu-midi';
        if(resume)refreshMix();
      }
      render();
    },!window.tracks.size,correctionOpen);
    correction.dataset.muFocus='corrections';tools.append(correction);host.append(tools);
    if(correctionOpen&&window.tracks.size){
      const content=renderCorrection();host.append(content);
      const results=content.querySelector('.mu-correction-results');
      if(results)results.scrollTop=priorResultsScroll;
    }
    const controls=element('div','','mu-tracks-actions');
    controls.append(button(scoring?lang('正在整理候选…','Reprocessing candidate…','候補を整理中…'):
      tr('用此轨生成候选','Create candidate from this track'),async()=>{
      const task=new AbortController();
      scoring=task;render();
      try{
        const output=await onCreate(scope,analysis,window,selected,cursor,task.signal);
        if(scoring===task){stats=output;error='';}
      }catch(failure){
        if(scoring===task&&!task.signal.aborted){error=failure.message;stats=null;}
      }finally{if(scoring===task){scoring=null;render();}}
    },Boolean(scoring||scan||scope.busy)||!selected||selected==='drums'||!window.tracks.get(selected)?.length));
    if(solo)controls.append(element('span',tr('独听','Solo')+' · '+muInstrumentLabel(solo),'hint'));
    if(selected==='drums')controls.append(element('span',tr('鼓组可试听和导出 MIDI。','Drums are available for playback and MIDI export.'),'hint'));
    if(stats){
      const feedback=element('span',tr('保留音符 / 舍弃复音 / 网格冲突 / 超出音域','Kept / Polyphony omitted / Grid collisions / Out of range')
        +' · '+[stats.kept,stats.polyphony,stats.collision,stats.pitch].join(' / '),'hint');
      feedback.setAttribute('role','status');controls.append(feedback);
    }
    host.append(controls);
    observer.observe(viewport);draw();viewport.scrollLeft=priorScroll;
    if(focused)Array.from(host.querySelectorAll('[data-mu-focus]')).find(node=>node.dataset.muFocus===focused)?.focus({preventScroll:true});
  }
  panel.addEventListener('toggle',()=>{
    if(panel.open){if(analysis&&!window&&!request)load();else render();}
    else{stop(true);clearRequest();scan?.abort();scan=null;scoring?.abort();scoring=null;}
  });
  onLanguageChange(render);
  heading.textContent=tr('MuScriptor 乐器轨','MuScriptor instrument tracks');
  return {refresh,sync,setSpeed,close(){stop(true);clearRequest();scan?.abort();scan=null;scoring?.abort();scoring=null;}};
}
