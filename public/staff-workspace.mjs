import {onLanguageChange,tr} from './i18n.mjs';
import {editStaffNote,prepareStaffScore,staffPitch,staffPitchName} from './staff-score.mjs';
import {scoreMusicXML} from './score-musicxml.mjs';
import {exportName} from './export-name.mjs';
import {keyAt,workspaceMarkerSVG} from './music.mjs';

const labels={
  clef:['谱号','Clef','音部記号'],auto:['自动','Auto','自動'],treble:['高音谱号','Treble','ト音記号'],bass:['低音谱号','Bass','ヘ音記号'],
  zoom:['缩放','Zoom','拡大率'],print:['打印／PDF','Print / PDF','印刷／PDF'],xml:['导出 MusicXML','Export MusicXML','MusicXMLを書き出す'],
  down:['降半音','Down a semitone','半音下げる'],up:['升半音','Up a semitone','半音上げる'],value:['常用时值','Note value','音価'],
  choose:['选择时值','Choose a value','音価を選択'],beats:['时值（拍）','Duration (beats)','音価（拍）'],apply:['应用时值','Apply duration','音価を適用'],
  hint:['点音符定位和试听。Ctrl 点击多选，Shift 点击选择连续音符。','Click a note to seek and audition. Ctrl-click to select multiple notes or Shift-click to select a range.','音符をクリックすると位置へ移動して試聴できます。Ctrl+クリックで複数選択、Shift+クリックで範囲選択します。'],
  load:['正在排五线谱…','Preparing staff notation…','五線譜を組版中…'],empty:['工作区还没有音符。','The workspace has no notes yet.','ワークスペースに音符がありません。'],
  pending:['请先生成并采用候选谱，或查看上一份谱子。','Adopt a candidate or show the previous score first.','候補譜を採用するか、前の楽譜を表示してください。'],
  failed:['五线谱加载失败。','Staff notation could not be loaded.','五線譜を読み込めませんでした。'],
  pickup:['工程中的弱起长度超出当前拍号，已按完整首小节显示。','The saved pickup is too long for this meter. The first measure is displayed in full.','保存された弱起が現在の拍子に収まらないため、完全な小節として表示します。'],
  retry:['重试','Retry','再試行'],
};
const rhythms=[
  [4,'全音符','Whole note','全音符'],[3,'附点二分音符','Dotted half','付点二分音符'],[2,'二分音符','Half note','二分音符'],
  [1.5,'附点四分音符','Dotted quarter','付点四分音符'],[1,'四分音符','Quarter note','四分音符'],
  [.75,'附点八分音符','Dotted eighth','付点八分音符'],[.5,'八分音符','Eighth note','八分音符'],
  [.375,'附点十六分音符','Dotted sixteenth','付点十六分音符'],[.25,'十六分音符','Sixteenth note','十六分音符'],
  [.1875,'附点三十二分音符','Dotted thirty-second','付点三十二分音符'],[.125,'三十二分音符','Thirty-second note','三十二分音符'],
  [.0625,'六十四分音符','Sixty-fourth note','六十四分音符'],
];
const label=id=>tr(...labels[id]);

export function installStaffWorkspace({getState,getMarkers,locateMarker,select,edit,download,refresh,onError}){
  const picker=document.getElementById('notationMode');
  const numbered=document.getElementById('scoreViewport');
  const layout=document.createElement('section');
  layout.id='staffWorkspace';
  layout.hidden=true;
  layout.innerHTML=`<div class="staff-tools">
    <label><span data-label="clef"></span> <select data-clef><option value="auto" data-label="auto"></option><option value="treble" data-label="treble"></option><option value="bass" data-label="bass"></option></select></label>
    <label><span data-label="zoom"></span> <select data-zoom><option value=".75">75%</option><option value="1" selected>100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
    <button type="button" data-xml data-label="xml"></button><button type="button" data-print data-label="print"></button>
  </div>
  <div class="staff-tools staff-note-tools">
    <span data-hint data-label="hint"></span>
    <div class="staff-tools" data-editor hidden>
      <strong data-pitch></strong><button type="button" data-down data-label="down"></button><button type="button" data-up data-label="up"></button>
      <label><span data-label="value"></span> <select data-duration></select></label>
      <form class="staff-tools" data-form novalidate><label><span data-label="beats"></span> <input data-beats type="number" min=".0625" max="128" step=".0625" required></label>
        <button type="submit" data-label="apply"></button></form>
    </div>
    <span data-message role="status" hidden></span>
  </div>
  <div class="staff-viewport score-viewport" data-viewport tabindex="0"><article class="staff-paper" data-paper></article>
    <p class="staff-status" role="status" data-status></p><button type="button" data-retry data-label="retry" hidden></button>
  </div>`;
  numbered.after(layout);
  const panel=numbered.closest('.score-panel');
  const $=name=>layout.querySelector('[data-'+name+']');
  const viewport=$('viewport'),paper=$('paper'),beats=$('beats'),duration=$('duration');
  const previewToggle=()=>document.getElementById('scorePreviewToggle');
  let active=false,project=null,pitchFlats=false,clef='',width=0,result=null,score=null,renderModule,epoch=0;
  let numberedPosition={top:0,left:0},staffPosition={top:0,left:0},selectedNote=null,currentBeat=0,playing=false;
  let cursor=null,playingTarget=null,selectedTargets=[],lastSelection;
  let statusKey='',markerLayout='';
  function status(key){statusKey=key;$('status').textContent=key?label(key):'';$('status').hidden=!key;$('retry').hidden=key!=='failed';}
  function translate(){
    layout.querySelectorAll('[data-label]').forEach(el=>{el.textContent=label(el.dataset.label);});
    layout.setAttribute('aria-label',tr('五线谱工作区','Staff notation workspace','五線譜ワークスペース'));
    viewport.setAttribute('aria-label',layout.getAttribute('aria-label'));
    const choice=duration.value;
    duration.replaceChildren(new Option(label('choose'),''),...rhythms.map(([value,...names])=>new Option(tr(...names),value)));
    duration.value=choice;
    status(statusKey);
  }
  onLanguageChange(translate);
  translate();

  function markSelection(ids){
    const key=[...ids].sort().join(' ');
    if(lastSelection===key)return;
    for(const target of selectedTargets)target.removeAttribute('data-selected');
    selectedTargets=ids.size?[...paper.querySelectorAll('[data-staff-note]')].filter(target=>ids.has(target.dataset.staffNote)):[];
    for(const target of selectedTargets)target.setAttribute('data-selected','1');
    lastSelection=key;
  }
  function showNote(note,busy){
    const changed=selectedNote?.id!==note?.id||selectedNote?.duration!==note?.duration;
    selectedNote=note?.midi!=null?note:null;
    $('editor').hidden=!selectedNote;
    $('hint').hidden=!!selectedNote;
    if(!selectedNote)return;
    const spelling=staffPitch(note.midi,keyAt(getState().project,note.start),getState().flats);
    $('pitch').textContent=staffPitchName(spelling);
    $('down').disabled=busy||note.midi===21;
    $('up').disabled=busy||note.midi===108;
    $('form').querySelector('button').disabled=beats.disabled=duration.disabled=busy;
    if(changed){
      beats.value=note.duration;
      duration.value=rhythms.some(([value])=>value===note.duration)?String(note.duration):'';
      message('');
    }
  }
  function message(value){$('message').textContent=value;$('message').hidden=!value;}
  function editNote(patch){
    try{
      const state=getState();
      if(!selectedNote||state.busy||state.waiting)return;
      const next=editStaffNote(state.project,selectedNote.id,patch);
      if(next!==state.project)edit(next,patch.midi);
      else beats.value=selectedNote.duration;
      message('');
    }catch(error){message(error.message);beats.value=selectedNote.duration;duration.value=rhythms.some(([value])=>value===selectedNote.duration)?String(selectedNote.duration):'';}
  }

  function staffPoint(beat){
    if(!result)return null;
    const {positions,systems}=result;
    let lo=0,hi=positions.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(positions[mid].atom.start<=beat+1e-8)lo=mid+1;else hi=mid;}
    const position=positions[Math.max(0,lo-1)],next=positions[lo];
    if(!position)return null;
    const at=position.atom.start,end=at+position.atom.duration;
    const ratio=Math.max(0,Math.min(1,(beat-at)/(end-at)));
    const edge=next?.system===position.system?next.x:position.staveEnd;
    const x=position.x+(edge-position.x)*ratio;
    return {position,end,x,system:systems[position.system]};
  }
  function drawMarkers(){
    if(!result)return;
    const markers=getMarkers(),key=JSON.stringify(markers.map(({id,beat,label,description})=>[id,beat,label,description]));
    if(key===markerLayout)return;
    markerLayout=key;
    for(const pin of paper.querySelectorAll('[data-workspace-marker]'))pin.remove();
    for(const marker of markers){
      const point=staffPoint(marker.beat);
      if(!point||marker.beat<point.position.atom.start||marker.beat>point.end)continue;
      const {x,system}=point;
      system.svg.insertAdjacentHTML('beforeend',workspaceMarkerSVG(x,18,Number(system.cursor.getAttribute('y2')),marker));
    }
  }
  function updatePlayhead(beat,isPlaying){
    currentBeat=beat;playing=isPlaying;
    if(!active)return;
    const point=staffPoint(beat);
    if(!point)return;
    const {position,end,x,system}=point,newCursor=system.cursor;
    if(cursor!==newCursor){cursor?.setAttribute('visibility','hidden');cursor=newCursor;cursor.setAttribute('visibility','visible');}
    cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);
    const target=isPlaying&&beat<end?position.target:null;
    if(playingTarget!==target){playingTarget?.removeAttribute('data-playing');playingTarget=target;target?.setAttribute('data-playing','1');}
  }
  function setOutput(enabled){$('xml').disabled=$('print').disabled=!enabled;}
  function restoreScroll(position){viewport.scrollTop=position.top;viewport.scrollLeft=position.left;}
  function renderer(){return renderModule??=import('./staff-render.mjs').catch(error=>{renderModule=null;throw error;});}
  async function draw(){
    if(!active)return;
    const state=getState();
    showNote(state.waiting?null:state.selected,state.waiting||state.busy);
    markSelection(state.waiting?new Set():state.selectedIds);
    if(state.waiting||!state.project.notes.length){
      epoch++;result=score=project=null;
      paper.replaceChildren();setOutput(false);status(state.waiting?'pending':'empty');
      return;
    }
    const nextClef=$('clef').value,zoom=Number($('zoom').value);
    const nextWidth=Math.max(480,Math.round((viewport.clientWidth-24)/zoom));
    if(project===state.displayProject&&clef===nextClef&&width===nextWidth&&pitchFlats===state.flats){drawMarkers();return;}
    const pos=paper.childElementCount?{top:viewport.scrollTop,left:viewport.scrollLeft}:staffPosition;
    const tag=++epoch;
    if(!result)status('load');
    paper.inert=true;
    setOutput(false);
    const needsScore=project!==state.displayProject||clef!==nextClef||pitchFlats!==state.flats||!score;
    project=state.displayProject;clef=nextClef;width=nextWidth;pitchFlats=state.flats;
    try{
      const nextScore=needsScore?prepareStaffScore(project,{clef,preferFlats:pitchFlats}):score;
      const module=await renderer();
      if(tag!==epoch||!active)return;
      const next=await module.renderStaffScore(nextScore,width,{interactive:true});
      if(tag!==epoch||!active)return;
      score=nextScore;result=next;
      const title=document.createElement('h2');title.textContent=score.project.title;
      const tempo=document.createElement('p');tempo.className='staff-tempo';tempo.textContent='♩ = '+score.project.bpm;
      paper.style.width=(width*zoom)+'px';
      paper.replaceChildren(title,tempo,...result.systems.map(system=>system.svg));
      paper.inert=false;
      lastSelection=null;markSelection(getState().selectedIds);
      cursor=null;playingTarget=null;markerLayout='';drawMarkers();
      restoreScroll(pos);updatePlayhead(currentBeat,playing);
      status(score.invalidPickup?'pickup':'');setOutput(true);
    }catch(error){
      if(tag!==epoch)return;
      console.error('Staff notation render failed',error);
      result=score=project=null;paper.replaceChildren();status('failed');
    }
  }

  function changeMode(){
    const next=picker.value==='staff';
    if(next===active)return;
    if(next)numberedPosition={top:numbered.scrollTop,left:numbered.scrollLeft};
    else if(result)staffPosition={top:viewport.scrollTop,left:viewport.scrollLeft};
    active=next;
    layout.hidden=!active;
    numbered.classList.toggle('staff-numbered-hidden',active&&!getState().waiting);
    panel.classList.toggle('staff-mode',active);
    if(previewToggle())previewToggle().hidden=active;
    if(active&&result)restoreScroll(staffPosition);
    if(!active){epoch++;project=null;}
    refresh();
    if(!active){numbered.scrollTop=numberedPosition.top;numbered.scrollLeft=numberedPosition.left;}
  }
  picker.addEventListener('change',changeMode);
  $('clef').addEventListener('change',draw);
  $('zoom').addEventListener('change',()=>{width=0;draw();});
  $('retry').addEventListener('click',()=>{project=null;draw();});
  new ResizeObserver(()=>{if(active)draw();}).observe(viewport);
  $('down').addEventListener('click',()=>editNote({midi:selectedNote.midi-1}));
  $('up').addEventListener('click',()=>editNote({midi:selectedNote.midi+1}));
  duration.addEventListener('change',()=>{if(duration.value)editNote({duration:Number(duration.value)});});
  $('form').addEventListener('submit',event=>{event.preventDefault();editNote({duration:beats.valueAsNumber});});
  function activate(event){
    const marker=event.target.closest('[data-workspace-marker]');
    if(marker&&(event.type!=='keydown'||['Enter',' '].includes(event.key))){
      event.preventDefault();event.stopPropagation();locateMarker(marker.dataset.workspaceMarker);return;
    }
    const target=event.target.closest('[data-staff-note]');
    if(!target||!result||getState().waiting)return;
    if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    select(target.dataset.staffNote,Number(target.dataset.staffStart),event);
  }
  paper.addEventListener('click',activate);
  paper.addEventListener('keydown',activate);
  $('xml').addEventListener('click',async()=>{
    if(!score)return;
    try{await download(scoreMusicXML(score),exportName(score.project.title,'musicxml'),'application/vnd.recordare.musicxml+xml');}catch(error){onError(error);}
  });
  $('print').addEventListener('click',async()=>{
    if(!score)return;
    const preview=window.open('','_blank');
    if(!preview){onError(Error(tr('请允许弹出打印窗口后重试。','Allow the print window and try again.','ポップアップを許可して再試行してください。')));return;}
    const snapshot=score;
    try{
      const module=await renderer(),print=await module.renderStaffScore(snapshot,702),doc=preview.document;
      doc.title=snapshot.project.title;
      const style=doc.createElement('style');
      style.textContent=module.staffFontCSS+'@page{size:A4 portrait;margin:12mm}body{margin:0;color:black;background:white;font-family:Arial,sans-serif}h1{text-align:center;margin:0 0 .4em;overflow-wrap:anywhere}header{break-after:avoid}svg{width:100%;height:auto;display:block;break-inside:avoid}';
      doc.head.append(style);
      const heading=doc.createElement('h1');heading.textContent=snapshot.project.title;
      const header=doc.createElement('header');header.append(heading,'♩ = '+snapshot.project.bpm);
      doc.body.append(header,...print.systems.map(system=>doc.importNode(system.svg,true)));
      await doc.fonts.load('32px Bravura','\uE050');
      preview.focus();preview.print();
    }catch(error){preview.close();onError(error);}
  });
  return {
    get active(){return active;},
    refresh(){
      if(!active)return;
      const waiting=getState().waiting;
      numbered.classList.toggle('staff-numbered-hidden',!waiting);
      layout.hidden=waiting;
      draw();
    },
    updatePlayhead,
    focusBeat(beat){
      const point=staffPoint(beat);
      if(point&&beat>=point.position.atom.start&&beat<=point.end)point.system.cursor.scrollIntoView({block:'nearest',inline:'nearest'});
    },
    focusNote(id){
      const target=result?.positions.find(item=>item.atom.id===id&&item.atom.start+item.atom.duration>currentBeat)?.target;
      target?.scrollIntoView({block:'nearest',inline:'nearest'});
    },
  };
}
