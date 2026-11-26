import {tr} from './i18n.mjs';
import {escapeXML,EDIT_STEP,snap} from './music.mjs';
import {markerPoint,MARKER_NAME_LIMIT} from './project-markers.mjs';

const labels={
  add:['加标记','Add marker','マーカーを追加'],
  help:['记录当前播放位置（B）','Mark the current playback position (B)','現在の再生位置を記録（B）'],
  loop:['循环 A–B','Loop A–B','A–B をループ'],
  stop:['退出循环','Exit loop','ループを解除'],
  locate:['定位','Go to','移動'],
  write:['用作写入拍位','Use as entry beat','入力位置に設定'],
  rename:['改名','Rename','名前を変更'],
  move:['移到光标','Move to playhead','カーソル位置へ移動'],
  remove:['删除','Delete','削除'],
  save:['保存','Save','保存'],
  cancel:['取消','Cancel','キャンセル'],
  empty:['点击「加标记」记住当前播放位置。','Use Add marker to keep the current playback position.','「マーカーを追加」で現在の再生位置を記録できます。'],
  missing:['选两个标记即可循环。','Select two markers to loop.','ループするにはマーカーを2つ選択します。'],
  same:['请选两个不同的位置。','Select two different positions.','異なる位置を2つ選択してください。'],
  outside:['标记超出当前音源的可播放范围。','A marker is outside the current source’s playable range.','現在の音源の再生範囲外にマーカーがあります。'],
  unavailable:['这个位置超出当前播放时间轴。','Outside the current playback timeline.','現在の再生タイムラインの範囲外です。'],
  offScore:['谱面范围外','Outside the score','譜面範囲外'],
};
const label=id=>tr(...labels[id]);
const number=value=>+value.toFixed(4);
const time=value=>{
  const ms=Math.round(value*1000);
  return String(Math.floor(ms/60000)).padStart(2,'0')+':'+(ms%60000/1000).toFixed(3).padStart(6,'0');
};

export function markerEntryBeat(beat){
  const target=snap(beat,EDIT_STEP);
  return beat>=0&&target<=14399?target:null;
}

export function installWorkspaceMarkers({getState,locate,write,rename,move,remove,changeEndpoints,toggleLoop}){
  const add=document.getElementById('addWorkspaceMarker'),panel=document.getElementById('workspaceMarkerPanel');
  const summary=panel.querySelector('summary'),list=panel.querySelector('[data-marker-list]');
  const start=panel.querySelector('[data-marker-a]'),end=panel.querySelector('[data-marker-b]'),loop=panel.querySelector('[data-marker-loop]');
  const message=panel.querySelector('[data-marker-message]'),wave=document.getElementById('workspaceWaveMarkers');
  let editing=null;
  function points(){
    const {project,waiting,endpoints}=getState();
    if(waiting)return [];
    return (project.markers||[]).map(marker=>({...marker,...markerPoint(project,marker)})).sort((a,b)=>a.beat-b.beat).map((point,i)=>{
      const n=i+1,beat=point.beat>=0&&point.beat<=14400;
      const name=point.name||tr('标记 '+n,'Marker '+n,'マーカー '+n);
      const position=[point.anchor==='audio'?time(point.audioSecond):null,beat?tr(`第 ${number(point.beat+1)} 拍`,`Beat ${number(point.beat+1)}`,`第${number(point.beat+1)}拍`):label('offScore')].filter(Boolean).join(' · ');
      const endpoint=endpoints.a===point.id?'A':endpoints.b===point.id?'B':'';
      return {...point,displayName:name,position,description:name+' · '+position,label:endpoint?endpoint+'·'+n:String(n)};
    });
  }
  function render(items=points()){
    const {waiting,busy,endpoints,range,looping,canLocate}=getState();
    add.textContent=label('add');add.title=label('help');add.disabled=waiting||busy;
    panel.hidden=waiting;
    summary.textContent=tr(`标记（${items.length}）`,`Markers (${items.length})`,`マーカー（${items.length}）`);
    for(const [select,letter,id] of [[start,'A',endpoints.a],[end,'B',endpoints.b]]){
      select.setAttribute('aria-label',tr('循环端点 '+letter,'Loop point '+letter,'ループ端点 '+letter));
      select.replaceChildren(new Option('—',''),...items.map(p=>new Option(p.displayName+' · '+p.position,p.id)));
      select.value=id||'';select.disabled=!items.length||busy;
    }
    loop.textContent=label(looping?'stop':'loop');
    loop.disabled=busy||(!looping&&Boolean(range.error));
    loop.setAttribute('aria-pressed',String(looping));
    message.textContent=items.length&&range.error?label(range.error):'';
    if(!items.length){list.textContent=label('empty');return;}
    if(!items.some(p=>p.id===editing))editing=null;
    list.innerHTML=items.map(point=>{
      const entry=markerEntryBeat(point.beat),target=entry!==null?tr(`写入第 ${number(entry+1)} 拍`,`Entry beat ${number(entry+1)}`,`入力位置 第${number(entry+1)}拍`):'';
      const button=(action,disabled=false,title='')=>`<button type="button" data-marker-action="${action}"${disabled?' disabled':''}${title?` title="${escapeXML(title)}"`:''}>${label(action)}</button>`;
      const name=editing===point.id?`<form class="workspace-marker-editor"><input aria-label="${label('rename')}" maxlength="${MARKER_NAME_LIMIT}" value="${escapeXML(point.name)}" placeholder="${escapeXML(point.displayName)}"><button type="submit">${label('save')}</button>${button('cancel')}</form>`:`<strong>${escapeXML(point.displayName)}</strong>`;
      return `<div class="workspace-marker-row" data-marker-row="${point.id}"><div>${name}<span class="hint">${escapeXML([point.position,target].filter(Boolean).join(' · '))}</span></div><div class="workspace-marker-actions">${button('locate',!canLocate(point),!canLocate(point)?label('unavailable'):'')}${button('write',busy||entry===null,target)}${editing===point.id?'':button('rename',busy)}${button('move',busy)}${button('remove',busy)}</div></div>`;
    }).join('');
  }

  list.addEventListener('click',event=>{
    const action=event.target.closest('[data-marker-action]')?.dataset.markerAction,id=event.target.closest('[data-marker-row]')?.dataset.markerRow;
    if(!id||!action)return;
    if(action==='rename'||action==='cancel'){
      editing=action==='rename'?id:null;render();
      const focus=list.querySelector(`[data-marker-row="${id}"] ${editing?'input':'[data-marker-action="rename"]'}`);
      focus?.focus();if(editing)focus?.select();
      return;
    }
    const handlers={locate,write,move,remove};
    handlers[action]?.(id);
  });
  list.addEventListener('submit',event=>{
    event.preventDefault();
    const id=event.target.closest('[data-marker-row]').dataset.markerRow;
    editing=null;rename(id,event.target.querySelector('input').value);
  });
  list.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!editing)return;
    event.preventDefault();event.stopPropagation();
    list.querySelector(`[data-marker-row="${editing}"] [data-marker-action="cancel"]`)?.click();
  });
  start.addEventListener('change',()=>changeEndpoints('a',start.value));
  end.addEventListener('change',()=>changeEndpoints('b',end.value));
  loop.addEventListener('click',toggleLoop);
  wave.addEventListener('click',event=>{
    const id=event.target.closest('[data-workspace-marker]')?.dataset.workspaceMarker;
    if(id)locate(id);
  });

  return {points,render,drawWave(items,from,length,range,offset){
    const to=from+length,percent=second=>(second-from)/length*100;
    const a=range?Math.max(from,range.start+offset):null,b=range?Math.min(to,range.end+offset):null;
    const shade=b>a?`<div class="workspace-marker-range" style="left:${percent(a)}%;width:${percent(b)-percent(a)}%"></div>`:'';
    const pins=items.filter(p=>p.audioSecond>=from&&p.audioSecond<=to).map(p=>
      `<div class="workspace-wave-pin" data-edge="${p.audioSecond===from?'start':p.audioSecond===to?'end':''}" style="left:${percent(p.audioSecond)}%"><button type="button" data-workspace-marker="${p.id}" title="${escapeXML(p.description)}" aria-label="${escapeXML(p.description)}">${escapeXML(p.label)}</button></div>`).join('');
    const markup=shade+pins;
    if(wave.innerHTML!==markup)wave.innerHTML=markup;
  }};
}
