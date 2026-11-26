import {tr,getLanguage,onLanguageChange} from './i18n.mjs';
import {bindPanelLanguage} from './panel-i18n.mjs';
import {ENGRAVING_EN} from './engraving-i18n.mjs';
const et=text=>tr(text,ENGRAVING_EN[text]??text);
import {KEYS,escapeXML} from './music.mjs';
import {engravingSettings} from './engraving-settings.mjs';
import {prepareEngraving} from './engraving.mjs';
import {renderDolceScore,scoreExport} from './dolce-score.mjs';
import {exportName} from './export-name.mjs';

export function installEngraving({getProject,canOpen,saveSettings,download,onError}){
  const dialog=document.createElement('dialog');dialog.id='engravingDialog';dialog.className='engraving-dialog';dialog.setAttribute('aria-label','正式简谱排版');
  dialog.innerHTML=`<div class="engraving-head"><h2>正式简谱排版</h2><span>工作区副本 · 预览后导出</span><button data-close aria-label="关闭排版">关闭</button></div><div class="engraving-body"><aside class="engraving-options"><button data-reload>重新读取工作区</button><button data-auto>自动整理成谱</button><label><input data-tidy type="checkbox"> 自动节奏整理</label><label><input data-closeGaps type="checkbox"> 合并 ≤⅛ 拍音间空隙</label><label><input data-groupBeats type="checkbox"> 按拍分组</label><label>首小节拍数<input data-pickup type="number" min="0" max="3.9375" step="0.0625"><small>0 为完整小节；弱起请填首小节实际拍数。</small></label><label>导出范围<select data-section></select></label><label>曲名<input data-title maxlength="120"></label><label>导出文件名<input data-name maxlength="100"></label><div class="engraving-fields"><label>拍号<select data-meter>${['2/4','3/4','4/4','6/8'].map(v=>`<option>${v}</option>`).join('')}</select></label><label>速度 ♩<input data-bpm type="number" min="30" max="300"></label></div><label>记谱调号<select data-key><option value="">跟随工程（含段落调号）</option>${KEYS.map((k,i)=>`<option value="${i}">${tr('全谱','All notes')} 1=${k}</option>`).join('')}</select></label><label>节奏整理精度<select data-step><option value="0.25">¼ 拍 · 默认</option><option value="0.5">½ 拍</option><option value="0.125">⅛ 拍</option><option value="0.0625">¹⁄₁₆ 拍</option><option value="0">保留原时值</option></select></label><div class="engraving-fields"><label>字号<input data-fontSize type="number" min="16" max="32"></label><label>每行最多小节<input data-barsPerRow type="number" min="1" max="8"></label></div><label>页边距 / 毫米<input data-margin type="number" min="8" max="25"></label><label><input data-lyrics type="checkbox"> 显示已关联歌词</label><label><input data-flats type="checkbox"> 偏好降号</label><p class="hint">A4 竖向。密集小节自动减少每行数量，过长小节按音符换行。整理只影响此副本。</p><button data-save>保存排版设置到工程</button><p data-difference role="status"></p><details><summary>查看节奏变化</summary><div data-changes class="engraving-changes"></div></details><details><summary>歌词与范围检查</summary><div data-checks></div></details></aside><section class="engraving-preview"><div class="engraving-preview-head"><label>对照 <select data-view><option value="prepared">整理后</option><option value="original">原时值</option></select></label><span data-pages></span></div><p data-error role="alert" hidden></p><div data-paper class="engraving-paper"></div></section></div><footer class="engraving-footer"><span data-status>预览与导出使用同一份排版。</span><button data-svg>下载整谱 SVG</button><button data-print class="primary">打印 / 另存 PDF</button></footer>`;
  bindPanelLanguage(dialog,ENGRAVING_EN);document.body.append(dialog);const $=name=>dialog.querySelector(`[data-${name}]`);let snapshot=null,result=null,settings=null,debounce,generation=0;
  const fields=['section','title','meter','key','bpm','step','fontSize','barsPerRow','margin','lyrics','flats','tidy','closeGaps','groupBeats','pickup'];
  function read(){const v=Object.fromEntries(fields.map(k=>[k==='section'?'sectionId':k,$(k).type==='checkbox'?$(k).checked:$(k).value]));v.key=v.key===''?null:Number(v.key);return engravingSettings(v);}
  async function render(){const version=++generation;clearTimeout(debounce);result=null;$('error').hidden=true;$('paper').replaceChildren();$('svg').disabled=$('print').disabled=true;
    try{
      settings=read();const prepared=prepareEngraving(snapshot,settings);
      $('difference').textContent=tr(`${prepared.changes.length} / ${prepared.project.notes.length} 个音符时值有调整，合并 ${prepared.closedGaps} 处空隙；最大边界偏移 ${prepared.maxBeatShift.toFixed(4)} 拍（约 ${(prepared.maxSecondShift*1000).toFixed(0)} 毫秒）。`,`${prepared.changes.length} / ${prepared.project.notes.length} notes adjusted, ${prepared.closedGaps} gaps closed; maximum boundary shift ${prepared.maxBeatShift.toFixed(4)} beats (about ${(prepared.maxSecondShift*1000).toFixed(0)} ms).`,`${prepared.changes.length} / ${prepared.project.notes.length}個の音符の音価を調整し、${prepared.closedGaps}か所の隙間を結合しました。最大の境界ずれは${prepared.maxBeatShift.toFixed(4)}拍（約${(prepared.maxSecondShift*1000).toFixed(0)}ミリ秒）です。`);
      $('changes').replaceChildren(...prepared.changes.map(c=>{const p=document.createElement('p');p.textContent=`${tr('音符','Note')} ${c.id.slice(0,8)}: ${c.before.map(v=>+(v+1).toFixed(4)).join('–')} → ${c.after.map(v=>+(v+1).toFixed(4)).join('–')} ${tr('拍','beats')}`;return p;}));
      $('checks').textContent=tr('未对应歌词 ','Unlinked lyrics: ')+prepared.orphans.length+(prepared.orphans.length?': '+prepared.orphans.join(' / '):'')+'. '+(settings.sectionId?tr('仅导出区块内音符；边界处音符按范围截取。','Only notes within the section are exported; boundary notes are clipped to the range.'):'');
      const shown=$('view').value==='original'?prepareEngraving(snapshot,{...settings,step:0,tidy:false,closeGaps:false,groupBeats:false}):prepared;const next=await renderDolceScore(shown);if(version!==generation)return;result=next;
      $('paper').replaceChildren(...result.pages.map(page=>{const sheet=document.createElement('div');sheet.className='engraving-page';sheet.append(page.svg);return sheet;}));$('pages').textContent=`${result.pages.length} ${tr('页','pages')} · ${$('view').value==='original'?et('原时值'):et('整理后')}`;
      $('status').textContent=`${tr('当前导出：','Export: ')}${$('view').value==='original'?et('原时值'):et('整理后')} · ${tr('预览与导出一致','Preview matches export')}`;$('svg').disabled=$('print').disabled=false;
    }catch(error){if(version!==generation)return;$('pages').textContent='';$('error').textContent=error.message;$('error').hidden=false;$('status').textContent=et('请调整设置后再导出。');}
  }
  function load(){snapshot=structuredClone(getProject());settings=engravingSettings(snapshot.engraving||{});
    $('section').replaceChildren(new Option(et('整首工作区'),''),...(snapshot.sections||[]).map(s=>new Option(s.name,s.id)));
    for(const k of fields){const value=k==='section'?settings.sectionId:k==='title'?settings.title??snapshot.title:k==='meter'?settings.meter??snapshot.meter:k==='bpm'?settings.bpm??snapshot.bpm:settings[k];if($(k).type==='checkbox')$(k).checked=value;else $(k).value=value??'';}
    if(!$('section').value)$('section').value='';$('name').value=(snapshot.title||et('未命名'))+et(' - 简谱');$('view').value='prepared';render();
  }
  onLanguageChange(()=>{for(const option of $('key').options)if(option.value!=='')option.textContent=tr('全谱','All notes')+' 1='+KEYS[Number(option.value)];const all=$('section').querySelector('option[value=""]');if(all)all.textContent=et('整首工作区');if(snapshot)render();});
  $('auto').onclick=()=>{$('tidy').checked=true;$('groupBeats').checked=true;$('view').value='prepared';render();};
  $('close').onclick=()=>dialog.close();$('reload').onclick=()=>{if(confirm(et('重新读取当前工作区，并重置本窗口尚未保存的排版设置？')))load();};
  for(const k of fields)$(k).addEventListener('input',()=>{generation++;result=null;$('svg').disabled=$('print').disabled=true;clearTimeout(debounce);debounce=setTimeout(render,180);});$('view').onchange=render;
  $('save').onclick=()=>{try{saveSettings(read());$('status').textContent=et('排版设置已写入工程，可撤销；正式音符未改变。');}catch(e){onError(e);}};
  $('svg').onclick=async()=>{try{if(result){const output=await scoreExport(result);await download(output.svg,exportName($('name').value,'svg'),'image/svg+xml');}}catch(e){onError(e);}};
  $('print').onclick=async()=>{
    if(!result)return;const win=window.open('','_blank');
    if(!win){onError(Error(et('请允许弹出打印窗口后重试。')));return;}
    try{const output=await scoreExport(result);win.document.write(`<!doctype html><html lang="${getLanguage()}"><head><meta charset="utf-8"><title>${escapeXML($('name').value||snapshot.title)}</title><style>${output.font}@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0}section{width:210mm;height:297mm;break-after:page}section:last-child{break-after:auto}svg{width:210mm;height:297mm;display:block}</style></head><body>${output.pages.map(svg=>`<section>${svg}</section>`).join('')}</body></html>`);win.document.close();await win.document.fonts.ready;win.focus();win.print();}catch(e){win.close();onError(e);}
  };
  document.getElementById('exportEngraving').onclick=()=>{if(!canOpen())return;document.getElementById('exportDialog').close();load();dialog.showModal();};
  return {open:()=>{if(canOpen()){load();dialog.showModal();}}};
}
