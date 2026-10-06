import {CONTROL_HELP,SELECT_HELP,selectExplanation,parseManual,searchManual} from './help-content.mjs';
function labelFor(el){
  if(el.matches('button,summary'))return el.textContent.trim().replace(/\s+/g,' ');
  if(el.getAttribute('aria-label'))return el.getAttribute('aria-label');
  const label=el.labels?.[0]||el.closest('label');if(!label)return el.placeholder||'';
  const clone=label.cloneNode(true);clone.querySelectorAll('input,select,textarea,button,small').forEach(n=>n.remove());return clone.textContent.trim().replace(/\s+/g,' ');
}
export function installHelp(){
  const dialog=document.getElementById('helpDialog');
  dialog.classList.add('manual-dialog');dialog.setAttribute('aria-label','使用说明书');
  dialog.innerHTML='<form method="dialog"><div class="dialog-head"><h2>使用说明书</h2><button aria-label="关闭说明书">×</button></div></form><div class="manual-search-row"><label for="manualSearch">查询用法</label><input id="manualSearch" type="search" placeholder="搜索功能、模型、快捷键，例如 pYIN / 粘贴 / 歌词"><button id="manualClear" type="button">清空</button><a href="/manual.txt" download="听谱说明书.txt">下载 TXT</a></div><p id="manualSearchStatus" class="hint" role="status"></p><div class="manual-layout"><nav id="manualNav" aria-label="说明书章节"></nav><article id="manualArticle" tabindex="0" aria-label="章节内容"></article></div>';
  const search=document.getElementById('manualSearch'),nav=document.getElementById('manualNav'),article=document.getElementById('manualArticle'),status=document.getElementById('manualSearchStatus');
  let chapters=[],selectedId='',loading=null;
  function highlighted(node,text,query){const terms=query.trim().split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);if(!terms.length){node.textContent=text;return;}const escaped=terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),re=new RegExp(escaped.join('|'),'gi');let last=0;for(const m of text.matchAll(re)){node.append(document.createTextNode(text.slice(last,m.index)));const mark=document.createElement('mark');mark.textContent=m[0];node.append(mark);last=m.index+m[0].length;}node.append(document.createTextNode(text.slice(last)));}
  function render(){
    const query=search.value,results=searchManual(chapters,query);if(!results.some(c=>c.id===selectedId))selectedId=results[0]?.id||'';
    nav.replaceChildren();article.replaceChildren();status.textContent=query?`找到 ${results.length} 个相关章节`:`共 ${chapters.length} 个章节；可搜索功能名称或快捷键`;
    for(const c of results){const button=document.createElement('button');button.type='button';button.textContent=c.title;button.dataset.uiHelp='打开此章节的用法说明。';button.setAttribute('aria-current',String(c.id===selectedId));button.addEventListener('click',()=>{selectedId=c.id;render();});nav.append(button);}
    const chapter=results.find(c=>c.id===selectedId);if(!chapter){article.textContent='没有找到。可换成功能名称，例如“复制”“歌词”“高性能”。';return;}
    const heading=document.createElement('h3'),body=document.createElement('div');body.className='manual-body';highlighted(heading,chapter.title,query);highlighted(body,chapter.body,query);article.append(heading,body);article.scrollTop=0;
  }
  async function load(){
    if(chapters.length)return;if(loading)return loading;
    loading=(async()=>{const response=await fetch('/manual.txt');if(!response.ok)throw Error('说明书暂时无法读取，请刷新页面重试。');chapters=parseManual(await response.text());const lines=Object.entries(CONTROL_HELP).map(([id,help])=>{const el=document.getElementById(id);return `${el?labelFor(el)||id:id}：${help}`;});chapters.push({id:'controls',title:'功能速查：控件与参数',body:[...new Set(lines)].join('\n\n')});})();
    try{await loading;}finally{loading=null;}
  }
  async function open(){if(!dialog.open)dialog.showModal();article.textContent='正在打开说明书…';try{await load();render();search.focus();}catch(error){status.textContent=error.message;article.textContent='关闭后重新打开可重试，也可下载 TXT。';}}
  for(const id of ['helpBtn','helpTop'])document.getElementById(id).addEventListener('click',open);
  search.addEventListener('input',render);document.getElementById('manualClear').addEventListener('click',()=>{search.value='';render();search.focus();});
  const selector='button,input:not([type=file]):not([type=hidden]),select,textarea,summary,canvas';
  function attach(el){
    if(!(el instanceof HTMLElement))return;
    if(el.closest('[data-note],[data-lyric],[data-free-start],[data-resize],[data-lyric-resize]')){el.removeAttribute('title');delete el.dataset.uiHelp;return;}
    if(el.closest('#score,.manual-body'))return;
    const mapped=CONTROL_HELP[el.id],label=labelFor(el),existing=el.getAttribute('title');
    let help=mapped||existing||el.dataset.uiHelp;
    if(el.tagName==='SUMMARY')help ||= `展开或收起“${label}”，查看相应工具与设置。`;
    else if(el.tagName==='BUTTON')help ||= el.getAttribute('aria-label')||`执行“${label}”；功能用法可在顶部说明书中查询。`;
    else help ||= label?`设置${label}。${el.closest('details,section')?.querySelector('.hint')?.textContent.trim()||'具体用法可查询顶部说明书。'}`:'';
    if(el.tagName==='SELECT'&&SELECT_HELP[el.id]){for(const option of el.options)option.title=selectExplanation(el.id,option.value);help=`${label||el.id}\n当前：${el.selectedOptions[0]?.textContent||''}\n${selectExplanation(el.id,el.value)}`;}
    if(!help)return;el.dataset.uiHelp=help;el.title=help;
    if(el.matches('input[type=checkbox],input[type=range]')&&el.closest('label')){el.closest('label').dataset.uiHelp=help;el.closest('label').title=help;}
  }
  function scan(root){if(root.matches?.(selector))attach(root);root.querySelectorAll?.(selector).forEach(attach);}
  scan(document);new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node.nodeType===1)scan(node);}).observe(document.body,{childList:true,subtree:true});
  const profile=document.getElementById('recognitionProfile'),profileHelp=document.getElementById('recognitionProfileHelp');
  function updateProfile(){profileHelp.textContent=selectExplanation('recognitionProfile',profile.value);}
  // Use native title tooltips for the browser's standard appearance and timing.
  updateProfile();document.addEventListener('change',e=>{if(e.target.matches?.('select'))attach(e.target);if(e.target===profile)updateProfile();});
}
