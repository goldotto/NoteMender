import {installDownbeatPreview} from './downbeat-preview.mjs';
import {tr,onLanguageChange} from './i18n.mjs';
import {prepareEngraving} from './engraving.mjs';
import {renderDolceScore,scoreExport} from './dolce-score.mjs';
import {scoreMusicXML} from './score-musicxml.mjs';
import {barLength,escapeXML} from './music.mjs';
import {exportName} from './export-name.mjs';

export function fitPreviewRect(rect,width,height){
  const w=Math.min(Math.max(360,rect.width),Math.max(1,width-16));
  const h=Math.min(Math.max(280,rect.height),Math.max(1,height-16));
  return {width:w,height:h,left:Math.max(8,Math.min(rect.left,width-w-8)),top:Math.max(8,Math.min(rect.top,height-h-8))};
}

export function installWorkspacePreview({getProject,isBusy,download,onError,getAudio,detectBars,auditionBars,onBarMarkers,audioBarSuggestions=false}){
  const button=document.getElementById('scorePreviewToggle');
  const panel=document.createElement('section');
  panel.id='formattedScoreViewport';panel.hidden=true;panel.tabIndex=-1;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','scorePreviewTitle');
  panel.innerHTML=`<header class="workspace-preview-titlebar"><strong id="scorePreviewTitle"></strong><span data-window-hint></span><button data-maximize></button><button data-close></button></header>
    <div class="preview-controls"><div class="workspace-preview-tools"><label><span data-label-step></span> <select data-step><option value="0"></option><option value="0.25">¼</option><option value="0.125">⅛</option><option value="0.0625">¹⁄₁₆</option></select></label><button data-auto></button><label><span data-label-view></span><select data-view><option value="original"></option><option value="tidy"></option><option value="grid"></option></select></label><label><input data-close-gaps type="checkbox"><span data-label-gaps></span></label><label><span data-label-pickup></span><input data-pickup type="number" min="0" max="3.9375" step="0.0625" value="0" style="width:75px"></label><button data-musicxml></button><button data-svg>SVG</button><button data-print></button></div>
    <details class="workspace-bar-tools" data-beats-section><summary data-beats-heading></summary>
    <div class="workspace-preview-tools"><button data-beats-scan></button></div>
    <div class="workspace-preview-tools" data-beats-tools hidden><label><span data-beats-label-source></span><select data-beats-source><option value="current"></option><option value="detected"></option><option value="manual"></option></select></label><label><span data-beats-label-meter></span><select data-beats-meter><option>2/4</option><option>3/4</option><option>4/4</option><option>6/8</option></select></label><label><span data-beats-label-phase></span><select data-beats-phase><option value=""></option></select></label><label><span data-beats-label-at></span><select data-beats-at></select></label><button data-beats-listen></button><button data-beats-apply class="primary" hidden></button></div>
    <p data-beats-info role="status"></p></details><p data-beats-review-status role="status"></p><p data-error role="alert" hidden></p><p data-status role="status"></p></div>
    <div class="workspace-preview-body"><div data-paper class="workspace-preview-paper" tabindex="0"></div></div>`;
  document.body.append(panel);
  const $=name=>panel.querySelector(`[data-${name}]`);
  let active=false,maximized=false,restoreRect=null,result=null,preparedScore=null,reviewingBars=false,lastProject=null,generation=0,timer,force=false,positioned=false;

  let pickupOverride=null;
  const markersToggle=document.getElementById('scoreBarMarkers');
  let marks=[],showMarkers=true;
  function updateMarkers(){
    markersToggle.setAttribute('aria-pressed',String(showMarkers));
    markersToggle.classList.toggle('active',showMarkers);
    onBarMarkers(showMarkers?marks:[],showMarkers);
  }
  const bars=installDownbeatPreview($,{audioSuggestions:audioBarSuggestions,getAudio,getProject,detect:detectBars,audition:auditionBars,
    onChange:()=>{force=true;render();},
    onMarkers:next=>{marks=next;updateMarkers();}
  });
  markersToggle.onclick=()=>{showMarkers=!showMarkers;updateMarkers();};
  function labels(){
    markersToggle.setAttribute('aria-pressed',String(showMarkers));
    markersToggle.textContent=tr('小节标记','Bar markers','小節マーカー');
    markersToggle.title=tr('显示或隐藏工作区的蓝色小节标记。','Show or hide blue bar markers in the workspace.','作業エリアの青い小節マーカーを表示または非表示にします。');
    bars.labels();
    button.textContent=tr('简谱预览','Score preview');
    button.title=tr('打开可移动、缩放的只读简谱预览窗','Open the movable, resizable read-only score preview');
    panel.querySelector('strong').textContent=tr('简谱预览','Score preview');
    $('window-hint').textContent=tr('拖动标题移动 · 拖右下角缩放','Drag title to move · Resize from bottom right');
    for(const [name,zh,en]of [
      ['auto','自动整理成谱','Auto tidy'],['label-view','对照','Compare'],['label-gaps','合并 ≤⅛ 拍音间空隙','Close gaps ≤⅛ beat'],['label-pickup','首小节拍数','Pickup beats'],['close','关闭','Close'],['label-step','预览精度','Preview grid'],
      ['musicxml','导出到 Dolce（MusicXML）','Export for Dolce (MusicXML)'],['print','打印 / PDF','Print / PDF']
    ])$(name).textContent=tr(zh,en);
    for(const [name,zh,en]of [
      ['auto','在每个边界最多移动⅛拍的范围内简化节奏，保留全部音符；可切换原时值对照。','Simplify rhythm with at most ⅛ beat of movement per boundary. Keep every note and compare with original timing.'],
      ['step','仅整理预览和导出副本的节奏，工作区保持原时值。','Adjust the rhythm in the preview and export copy. Workspace timing is retained.'],
      ['musicxml','下载当前预览的 MusicXML 文件，在 Dolce 中导入继续编辑。','Download the preview as MusicXML to import and edit in Dolce.'],
      ['svg','下载全部谱页，合成一个 SVG 文件。','Download all score pages as one SVG file.'],
      ['print','打开系统打印窗口，可打印或另存为 PDF。','Open system printing to print or save as PDF.'],
      ['close','收起预览窗。','Hide the preview window.']
    ]){$(name).dataset.controlHelp=tr(zh,en);$(name).title=tr(zh,en);}
    $('maximize').textContent=maximized?tr('还原','Restore'):tr('最大化','Maximize');
    $('step').options[0].textContent=tr('原时值','Original timing');
    $('view').options[0].textContent=tr('原时值','Original timing');
    $('view').options[1].textContent=tr('自动整理','Auto tidy');
    $('view').options[2].textContent=tr('按精度整理','Grid cleanup');
    $('pickup').title=tr('第一小节含几拍；0 为完整小节。改变此值校正小节线位置。','Beats in the pickup measure. Use 0 for a full first bar.');
  }
  function exportState(){
    for(const name of ['svg','print','musicxml'])$(name).disabled=!result||reviewingBars;
  }
  async function render(){
    if(!active)return;
    $('close-gaps').disabled=$('view').value!=='tidy';
    const project=getProject();
    if(project===lastProject&&!force)return;
    const version=++generation;force=false;result=null;preparedScore=null;reviewingBars=false;exportState();$('error').hidden=true;
    $('beats-review-status').textContent='';
    const top=$('paper').scrollTop;
    try{
      const adjusted=bars.copy(project),score=adjusted?.project||project;
      reviewingBars=Boolean(adjusted?.reviewing);
      $('beats-review-status').textContent=reviewingBars?tr('正在对照原曲建议。使用建议或切回当前排版后即可导出。','Comparing suggested bars. Apply them or return to the current layout to export.','原曲に沿った小節を比較中です。適用するか元のレイアウトへ戻すと出力できます。')
        :adjusted?.applied?tr('已使用原曲建议。','Suggested bars applied.','提案した小節線を適用しました。'):'';
      const savedPickup=project.engraving?.pickup||0;
      const pickup=pickupOverride??(savedPickup<barLength(project.meter)?savedPickup:0);
      $('pickup').value=String(pickup);
      $('pickup').disabled=Boolean(adjusted);
      if(!project.notes.length){
        $('paper').textContent=tr('工作区还没有音符，请先编辑或采用候选谱。','The workspace is empty. Edit notes or adopt a candidate first.');
        lastProject=project;$('status').textContent='';return;
      }
      const prepared=prepareEngraving(score,{...(project.engraving||{}),title:score.title,meter:score.meter,bpm:score.bpm,key:null,sectionId:'',step:$('view').value==='original'?0:Number($('step').value),tidy:$('view').value==='tidy',closeGaps:$('close-gaps').checked,groupBeats:$('view').value!=='original',pickup:adjusted?.pickup??pickup});
      const next=await renderDolceScore(prepared);
      if(version!==generation||!active)return;
      $('paper').replaceChildren(...next.pages.map(page=>{const sheet=document.createElement('article');sheet.append(page.svg);return sheet;}));
      // Leave interactive overlays unmounted. This window only displays the score.
      result=next;preparedScore=prepared;lastProject=project;$('paper').scrollTop=top;
      $('status').textContent=tr(`${next.pages.length} 页 · 预览整理 ${prepared.changes.length} 音 · 合并 ${prepared.closedGaps} 处空隙 · 最大调整 ${prepared.maxBeatShift.toFixed(3)} 拍。`,`${next.pages.length} pages · ${prepared.changes.length} notes adjusted for preview · ${prepared.closedGaps} gaps closed · Maximum shift ${prepared.maxBeatShift.toFixed(3)} beats.`,`${next.pages.length}ページ · プレビュー整理で${prepared.changes.length}音を調整 · ${prepared.closedGaps}か所の空隙を結合 · 最大調整${prepared.maxBeatShift.toFixed(3)}拍。`);
    }catch(error){
      if(version!==generation||!active)return;
      $('paper').replaceChildren();$('error').hidden=false;$('error').textContent=error.message;lastProject=null;
      $('status').textContent=tr('可选择更细精度，或保留原时值。','Choose a finer grid or keep the original timing.');
    }
    exportState();
  }
  function refresh(){if(active){clearTimeout(timer);timer=setTimeout(render,100);}}
  function setRect(rect){
    const fitted=fitPreviewRect(rect,window.innerWidth,window.innerHeight);
    Object.assign(panel.style,Object.fromEntries(Object.entries(fitted).map(([key,value])=>[key,`${value}px`])));
  }
  function toggle(){
    if(!active&&isBusy()){onError(Error(tr('请先显示正式工作区。','Open the adopted workspace first.')));return;}
    active=!active;generation++;panel.hidden=!active;
    button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);
    if(active){
      if(!positioned){const width=Math.min(1180,window.innerWidth-40);setRect({width,height:window.innerHeight*.84,left:(window.innerWidth-width)/2,top:window.innerHeight*.08});positioned=true;}
      pickupOverride=null;force=true;render();panel.focus({preventScroll:true});
    }else {bars.close();button.focus({preventScroll:true});}
  }
  function maximize(){
    if(maximized){maximized=false;setRect(restoreRect);}else{restoreRect=panel.getBoundingClientRect();maximized=true;setRect({left:8,top:8,width:window.innerWidth-16,height:window.innerHeight-16});}
    panel.classList.toggle('preview-maximized',maximized);labels();
  }
  const titlebar=panel.querySelector('header');let drag=null;
  titlebar.onpointerdown=event=>{
    if(event.button!==0||event.target.closest('button')||maximized)return;
    event.preventDefault();drag={x:event.clientX,y:event.clientY,rect:panel.getBoundingClientRect()};titlebar.setPointerCapture(event.pointerId);
  };
  titlebar.onpointermove=event=>{if(drag)setRect({width:drag.rect.width,height:drag.rect.height,left:drag.rect.left+event.clientX-drag.x,top:drag.rect.top+event.clientY-drag.y});};
  titlebar.onpointerup=titlebar.onpointercancel=titlebar.onlostpointercapture=()=>{drag=null;};
  titlebar.ondblclick=event=>{if(!event.target.closest('button'))maximize();};
  window.addEventListener('resize',()=>{if(active)setRect(maximized?{left:8,top:8,width:window.innerWidth-16,height:window.innerHeight-16}:panel.getBoundingClientRect());});
  window.addEventListener('pointerup',()=>{if(active&&!drag)setRect(panel.getBoundingClientRect());});
  // Workspace shortcuts must not edit notes while the preview has focus.
  panel.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();toggle();}});
  button.onclick=toggle;$('close').onclick=toggle;$('maximize').onclick=maximize;
  $('step').onchange=()=>{$('view').value='grid';force=true;render();};
  $('auto').onclick=()=>{$('view').value='tidy';force=true;render();};
  for(const name of ['view','close-gaps'])$(name).onchange=()=>{force=true;render();};
  $('pickup').onchange=()=>{pickupOverride=Number($('pickup').value);force=true;render();};
  $('musicxml').onclick=async()=>{try{if(preparedScore&&!reviewingBars)await download(scoreMusicXML(preparedScore),exportName(preparedScore.project.title,'musicxml'),'application/vnd.recordare.musicxml+xml');}catch(error){onError(error);}};
  $('svg').onclick=async()=>{
    if(!result||reviewingBars)return;const snapshot=result,title=preparedScore.project.title;
    try{const output=await scoreExport(snapshot);await download(output.svg,exportName(title+' - '+tr('简谱','score'),'svg'),'image/svg+xml');}catch(error){onError(error);}
  };
  $('print').onclick=async()=>{
    if(!result||reviewingBars)return;const snapshot=result,title=preparedScore.project.title,win=window.open('','_blank');
    if(!win){onError(Error(tr('请允许打印弹窗。','Allow the print window.')));return;}
    try{const output=await scoreExport(snapshot);win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeXML(title)}</title><style>${output.font}@page{size:A4;margin:0}body{margin:0;background:white}section{width:210mm;height:297mm;break-after:page}section:last-child{break-after:auto}svg{width:100%;height:100%}</style></head><body>${output.pages.map(svg=>`<section>${svg}</section>`).join('')}</body></html>`);win.document.close();await win.document.fonts.ready;win.focus();win.print();}catch(error){win.close();onError(error);}
  };
  onLanguageChange(()=>{labels();force=true;refresh();});labels();exportState();
  return {refresh,stopAudio:()=>bars.stopAudio(),audioChanged:()=>{pickupOverride=null;bars.sync();force=true;refresh();},
    setManualBars:(grid,meter)=>{
      if(grid&&!showMarkers){showMarkers=true;updateMarkers();}
      bars.setManual(grid,meter);
    }};
}
