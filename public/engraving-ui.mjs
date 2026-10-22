import {KEYS,escapeXML} from './music.mjs';
import {engravingSettings} from './engraving-settings.mjs';
import {prepareEngraving,renderEngraving} from './engraving.mjs';
import {exportName} from './export-name.mjs';

export function installEngraving({getProject,canOpen,saveSettings,download,onError}){
  const dialog=document.createElement('dialog');dialog.id='engravingDialog';dialog.className='engraving-dialog';dialog.setAttribute('aria-label','正式简谱排版');
  dialog.innerHTML=`<div class="engraving-head"><h2>正式简谱排版</h2><span>工作区副本 · 预览后导出</span><button data-close aria-label="关闭排版">关闭</button></div><div class="engraving-body"><aside class="engraving-options"><button data-reload>重新读取工作区</button><label>导出范围<select data-section></select></label><label>曲名<input data-title maxlength="120"></label><label>导出文件名<input data-name maxlength="100"></label><div class="engraving-fields"><label>拍号<select data-meter>${['2/4','3/4','4/4','6/8'].map(v=>`<option>${v}</option>`).join('')}</select></label><label>速度 ♩<input data-bpm type="number" min="30" max="300"></label></div><label>记谱调号<select data-key><option value="">跟随工程（含段落调号）</option>${KEYS.map((k,i)=>`<option value="${i}">全谱 1=${k}</option>`).join('')}</select></label><label>节奏整理精度<select data-step><option value="0.25">¼ 拍 · 默认</option><option value="0.5">½ 拍</option><option value="0.125">⅛ 拍</option><option value="0.0625">¹⁄₁₆ 拍</option><option value="0">保留原时值</option></select></label><div class="engraving-fields"><label>字号<input data-fontSize type="number" min="16" max="32"></label><label>每行最多小节<input data-barsPerRow type="number" min="1" max="8"></label></div><label>页边距 / 毫米<input data-margin type="number" min="8" max="25"></label><label><input data-lyrics type="checkbox"> 显示已关联歌词</label><label><input data-flats type="checkbox"> 偏好降号</label><p class="hint">A4 竖向。密集小节自动减少每行数量，过长小节按音符换行。整理只影响此副本。</p><button data-save>保存排版设置到工程</button><p data-difference role="status"></p><details><summary>查看节奏变化</summary><div data-changes class="engraving-changes"></div></details><details><summary>歌词与范围检查</summary><div data-checks></div></details></aside><section class="engraving-preview"><div class="engraving-preview-head"><label>对照 <select data-view><option value="prepared">整理后</option><option value="original">原时值</option></select></label><span data-pages></span></div><p data-error role="alert" hidden></p><div data-paper class="engraving-paper"></div></section></div><footer class="engraving-footer"><span data-status>预览与导出使用同一份排版。</span><button data-svg>下载整谱 SVG</button><button data-print class="primary">打印 / 另存 PDF</button></footer>`;
  document.body.append(dialog);const $=name=>dialog.querySelector(`[data-${name}]`);let snapshot=null,result=null,settings=null,debounce;
  const fields=['section','title','meter','key','bpm','step','fontSize','barsPerRow','margin','lyrics','flats'];
  function read(){const v=Object.fromEntries(fields.map(k=>[k==='section'?'sectionId':k,$(k).type==='checkbox'?$(k).checked:$(k).value]));v.key=v.key===''?null:Number(v.key);return engravingSettings(v);}
  function render(){clearTimeout(debounce);result=null;$('error').hidden=true;$('paper').replaceChildren();$('svg').disabled=$('print').disabled=true;
    try{
      settings=read();const prepared=prepareEngraving(snapshot,settings);
      $('difference').textContent=`${prepared.changes.length} / ${prepared.project.notes.length} 个音符时值有调整；最大边界偏移 ${prepared.maxBeatShift.toFixed(4)} 拍（约 ${(prepared.maxSecondShift*1000).toFixed(0)} 毫秒）。`;
      $('changes').replaceChildren(...prepared.changes.map(c=>{const p=document.createElement('p');p.textContent=`音符 ${c.id.slice(0,8)}：${c.before.map(v=>+(v+1).toFixed(4)).join('–')} → ${c.after.map(v=>+(v+1).toFixed(4)).join('–')} 拍`;return p;}));
      $('checks').textContent=`未对应歌词 ${prepared.orphans.length} 条${prepared.orphans.length?'：'+prepared.orphans.join(' / '):''}。${settings.sectionId?'仅导出区块内音符；边界处音符按范围截取。':''}`;
      const shown=$('view').value==='original'?prepareEngraving(snapshot,{...settings,step:0}):prepared;result=renderEngraving(shown);
      $('paper').innerHTML=result.pages.map(svg=>`<div class="engraving-page">${svg}</div>`).join('');$('pages').textContent=`${result.pages.length} 页 · ${$('view').value==='original'?'原时值':'整理后'}`;
      $('status').textContent=`当前导出：${$('view').value==='original'?'原时值':'整理后'} · 预览与导出一致`;$('svg').disabled=$('print').disabled=false;
    }catch(error){$('pages').textContent='';$('error').textContent=error.message;$('error').hidden=false;$('status').textContent='请调整设置后再导出。';}
  }
  function load(){snapshot=structuredClone(getProject());settings=engravingSettings(snapshot.engraving||{});
    $('section').replaceChildren(new Option('整首工作区',''),...(snapshot.sections||[]).map(s=>new Option(s.name,s.id)));
    for(const k of fields){const value=k==='section'?settings.sectionId:k==='title'?settings.title??snapshot.title:k==='meter'?settings.meter??snapshot.meter:k==='bpm'?settings.bpm??snapshot.bpm:settings[k];if($(k).type==='checkbox')$(k).checked=value;else $(k).value=value??'';}
    if(!$('section').value)$('section').value='';$('name').value=(snapshot.title||'未命名')+' - 简谱';$('view').value='prepared';render();
  }
  $('close').onclick=()=>dialog.close();$('reload').onclick=()=>{if(confirm('重新读取当前工作区，并重置本窗口尚未保存的排版设置？'))load();};
  for(const k of fields)$(k).addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(render,180);});$('view').onchange=render;
  $('save').onclick=()=>{try{saveSettings(read());$('status').textContent='排版设置已写入工程，可撤销；正式音符未改变。';}catch(e){onError(e);}};
  $('svg').onclick=async()=>{try{render();if(result)await download(result.svg,exportName($('name').value,'svg'),'image/svg+xml');}catch(e){onError(e);}};
  $('print').onclick=()=>{try{render();if(!result)return;const win=window.open('','_blank');if(!win)throw Error('请允许弹出打印窗口后重试。');win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeXML($('name').value||snapshot.title)}</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0}section{width:210mm;height:297mm;break-after:page;overflow:hidden}section:last-child{break-after:auto}svg{width:210mm;height:297mm;display:block}</style></head><body>${result.pages.map(svg=>`<section>${svg}</section>`).join('')}</body></html>`);win.document.close();win.document.fonts.ready.then(()=>{win.focus();win.print();});}catch(e){onError(e);}};
  document.getElementById('exportEngraving').onclick=()=>{if(!canOpen())return;document.getElementById('exportDialog').close();load();dialog.showModal();};
  return {open:()=>{if(canOpen()){load();dialog.showModal();}}};
}

export function installNotationModes(){
  const picker=document.getElementById('notationMode'),dialog=document.createElement('dialog');dialog.className='staff-framework';dialog.setAttribute('aria-label','五线谱模式框架');
  dialog.innerHTML='<h2>五线谱模式</h2><p class="staff-state">框架建设中</p><p>这里预留五线谱的独立制作界面。当前先收集记谱方式和操作建议。</p><ol><li>读取现有单旋律音符、歌词和段落调号。</li><li>补充谱号、调式、节奏拼写、连线及分页规则。</li><li>设计音符选择、修改、试听及简谱之间的对应。</li></ol><p>欢迎提供示例谱面和制作方法，帮助确定后续实现。</p><div class="actions"><a href="https://github.com/goldotto/NoteMender/issues/new" target="_blank" rel="noopener noreferrer" class="text-btn">提交五线谱建议 ↗</a><button data-return class="primary">返回简谱工作区</button></div>';
  document.body.append(dialog);picker.onchange=()=>{if(picker.value==='staff')dialog.showModal();};dialog.querySelector('[data-return]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{picker.value='jianpu';picker.focus();});
}
