import {panelText,bindPanelLanguage} from './panel-i18n.mjs';
import {tr,getLanguage,onLanguageChange} from './i18n.mjs';
import {COMPONENTS,orderedComponents} from './component-catalog.mjs';
import {MU_MODEL_IDS,MU_MODELS,defaultMuVariant} from './muscriptor-spec.mjs';
const active=job=>job&&['running','cancelling'].includes(job.state);
export function componentInstallState(status,ids,{refreshing=false,job=null}={}){
  const expanded=ids.length?orderedComponents(ids):[],chosen=(status?.components||COMPONENTS).filter(c=>expanded.includes(c.id)&&!c.ready);
  const busy=refreshing||active(job)||Boolean(status?.busy);
  const reason=busy?panelText('请等待当前检查、安装或分析完成'):!chosen.length?panelText('请勾选需要安装的组件'):panelText('安装所选组件；未主动允许扫描时只使用程序内环境，不扫描电脑');
  return {chosen,disabled:busy||!chosen.length,reason};
}
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
export async function createComponentManager(host,{onChanged=()=>{},onUseMu=()=>{},standalone=false}={}){
  let token=null,status={components:COMPONENTS.map(item=>({...item,ready:item.id==='base',checking:item.id!=='base'})),busy:true},job=null,timer=null,choice=null,refreshing=false,scannedCandidates=[];const selected=new Set(),requested=standalone?(new URLSearchParams(location.search).get('selected')||'').split(','):[];
  for(const id of requested)if(id!=='muscriptor'&&COMPONENTS.some(c=>c.id===id&&!c.required))selected.add(id);
  let muVariant=null,muForm=null,submitting=false;
  host.classList.add('component-shell');host.innerHTML=`<div class="component-heading"><h2>组件管理与安装</h2>${standalone?'<a href="/">进入工作台 →</a>':'<button type="button" data-close aria-label="关闭组件管理">×</button>'}</div><p class="component-subtitle">基础版即可扒谱和改谱。四种乐器采样音色已内置；歌词、显卡等大型组件可按需添加。</p><section class="component-scan"><h3>先检查电脑上是否已有环境？</h3><p>经你允许后，只检查常用 Python 环境和模型缓存。已有组件验证通过后可直接复用。</p><div class="component-row"><button type="button" data-scan class="primary">允许扫描已有环境</button><button type="button" data-skip>暂不扫描</button><span data-choice class="component-info"></span></div><details><summary>指定已有程序或环境目录</summary><div class="component-row"><input type="text" data-folder placeholder="已有 NoteMender、Python 或虚拟环境目录" aria-label="已有环境目录"><button type="button" data-folder-scan>允许检查此目录</button></div></details></section><section data-found class="component-found" hidden><h3>找到可复用组件</h3><ul data-results></ul></section><p data-error class="component-error" role="alert" hidden></p><div data-grid class="component-grid" aria-label="可安装组件"></div><section data-muscriptor class="component-card component-mu">
  <header><h3>MuScriptor 多乐器转谱</h3><button type="button" data-mu-guide-toggle aria-expanded="false">配置教程</button></header>
  <p>把录音转成多乐器 MIDI 和旋律候选。请选择适合电脑的模型。权重限非商用，首次下载需在 Hugging Face 接受对应模型的条款。</p>
  <fieldset class="component-mu-models"><legend>MuScriptor 模型</legend>
    <label><input name="mu-component-model" type="radio" value="small"><span>Small<small>约 412 MB · 适合主要用 CPU 的电脑</small><span data-mu-badge="small" class="component-badge"></span></span></label>
    <label><input name="mu-component-model" type="radio" value="medium" checked><span>Medium<small>约 1.23 GB · 首次配置推荐</small><span data-mu-badge="medium" class="component-badge"></span></span></label>
    <label><input name="mu-component-model" type="radio" value="large"><span>Large<small>约 5.47 GB · 适合显存较充足的显卡</small><span data-mu-badge="large" class="component-badge"></span></span></label>
  </fieldset>
  <div class="component-row">
    <a data-mu-official target="_blank" rel="noopener noreferrer">官方模型页 ↗</a>
    <a data-mu-weights target="_blank" rel="noopener noreferrer">官方权重下载页 ↗</a>
    <button type="button" data-mu-import>导入本机权重</button>
    <button type="button" data-mu-download>在 NoteMender 内下载</button>
    <button type="button" data-mu-use class="primary" hidden>去识谱</button>
  </div>
  <p data-mu-status class="component-info" aria-live="polite"></p>
  <div data-mu-guide class="component-scan" hidden>
    <ol>
      <li>用「官方模型页」登录 Hugging Face，阅读并接受该型号的非商用许可和附加条款。换型号时在新型号的页面确认授权。</li>
      <li>在「官方权重下载页」下载完整的 model.safetensors。各型号文件同名，建议分别放在 small、medium、large 文件夹。回到组件管理，点「导入本机权重」，用 Windows「复制文件地址」粘贴完整路径，再点「开始安装」。本机导入无需令牌。</li>
      <li>也可以点「在 NoteMender 内下载」，在密码框填入有该模型读取权限的 Hugging Face 令牌，再点「开始安装」。令牌仅用于本次任务。</li>
      <li>显示「已安装」后点「去识谱」。在「音频与识别」确认所选型号，导入约 5–10 秒的有旋律音频，点「生成简谱」。看到候选谱或乐器卷帘即可。</li>
    </ol>
    <p>出现 401／403 时，检查对应型号是否已授权、令牌是否有读取权限。下载中断可重试续传；校验失败先核对型号，再重新下载完整文件。</p>
    <p>缺少 CPU 音频环境时，按组件管理提示先安装或复用。首次配置依赖可能需要联网。显存不足时可手动选择 Small 或 Medium，再试一次。</p>
    <a href="https://www.bilibili.com/video/BV16Vnr6TEQa/" target="_blank" rel="noopener noreferrer">下载参考 · B 站视频 ↗</a>
  </div>
  <form data-mu-form class="component-scan" hidden>
    <h4 data-mu-form-title></h4>
    <p data-mu-form-error class="component-error" role="alert" hidden></p>
    <label><input type="checkbox" data-mu-terms>我已阅读并接受该权重的许可及附加使用条款</label>
    <p data-mu-local-row><label>本机权重的完整路径 <input type="text" data-mu-file placeholder="model.safetensors 的完整本机路径" autocomplete="off"></label></p>
    <p data-mu-token-row><label>Hugging Face 只读令牌（仅本次下载使用） <input type="password" data-mu-token autocomplete="off" spellcheck="false"></label></p>
    <div class="component-row"><button type="submit" data-mu-submit class="primary">开始安装</button><button type="button" data-mu-close>取消配置</button></div>
  </form>
</section><section data-progress class="component-progress" hidden><h3 data-stage role="status"></h3><progress data-bar max="1"></progress><button type="button" data-cancel>取消当前任务</button><details><summary>查看安装详情</summary><pre data-logs></pre></details></section><footer class="component-footer"><div class="component-row"><label>下载源 <select data-region aria-label="下载源优先顺序"><option value="auto">自动（国内源优先，失败切换）</option><option value="cn">中国大陆源优先</option><option value="global">官方源优先</option></select></label><button type="button" data-refresh>重新检查组件</button><button type="button" data-install class="primary">安装所选组件</button></div><p data-install-hint class="component-info" role="status"></p><p data-space class="component-info"></p><p class="component-info">只安装到当前程序目录；不会替换系统 Python、Torch 或显卡驱动。复用的外部环境需继续保留。</p></footer>`;
  const unbindLanguage=bindPanelLanguage(host);
  const get=name=>host.querySelector(`[data-${name}]`);
  const muRadios=[...host.querySelectorAll('[name="mu-component-model"]')];
  const muStates=()=>status.components?.find(item=>item.id==='muscriptor')?.variants;
  const selectedMu=()=>muVariant??defaultMuVariant(muStates());
  function resetMuForm(){
    muForm=null;muFormError('');get('mu-form').reset();get('mu-token').value='';get('mu-form').hidden=true;
  }
  function renderMu(busy){
    const variant=selectedMu(),spec=MU_MODELS[variant],states=muStates(),checked=states?.[variant];
    get('mu-official').href=spec.page;get('mu-weights').href=spec.files;
    for(const radio of muRadios){
      const model=states?.[radio.value],badge=host.querySelector('[data-mu-badge="'+radio.value+'"]');
      radio.checked=radio.value===variant;radio.disabled=submitting||active(job);
      badge.textContent=panelText(model?.ready?(model.external?'正在复用':'已安装'):states?'未安装':'待检查');
      badge.classList.toggle('ready',Boolean(model?.ready));
    }
    get('mu-status').textContent=job?.kind==='install'&&job.variant===variant&&job.state==='failed'?job.error||job.stage:'';
    for(const key of ['mu-import','mu-download']){
      get(key).hidden=Boolean(checked?.ready);
      get(key).disabled=busy;
    }
    get('mu-use').hidden=!checked?.ready;get('mu-use').disabled=busy;
    get('mu-submit').disabled=busy;
    get('mu-form-title').textContent=spec.name+' · '+panelText(muForm==='download'?'在 NoteMender 内下载':'导入本机权重');
    if(checked?.ready&&muForm)resetMuForm();
  }
  function muFormError(value){const notice=get('mu-form-error');notice.textContent=value;notice.hidden=!value;}
  function openMuForm(mode){
    muVariant=selectedMu();resetMuForm();muForm=mode;error('');
    get('mu-form').hidden=false;
    get('mu-local-row').hidden=mode!=='import';get('mu-token-row').hidden=mode!=='download';
    render();get(mode==='import'?'mu-file':'mu-token').focus();
  }
  function focusMu(variant){
    if(MU_MODEL_IDS.includes(variant)&&variant!==selectedMu()){muVariant=variant;resetMuForm();render();}
    get('muscriptor').scrollIntoView({block:'start'});
  }
  for(const radio of muRadios)radio.addEventListener('change',()=>{muVariant=radio.value;resetMuForm();error('');render();});
  get('mu-guide-toggle').addEventListener('click',()=>{const guide=get('mu-guide');guide.hidden=!guide.hidden;get('mu-guide-toggle').setAttribute('aria-expanded',String(!guide.hidden));});
  get('mu-import').addEventListener('click',()=>openMuForm('import'));
  get('mu-download').addEventListener('click',()=>openMuForm('download'));
  get('mu-close').addEventListener('click',()=>{const key=muForm==='download'?'mu-download':'mu-import';resetMuForm();get(key).focus();});
  get('mu-use').addEventListener('click',()=>action(async()=>{
    const variant=selectedMu();
    if(standalone){await request('finish',{});location.href='/?muscriptor='+variant;}
    else onUseMu(variant);
  }));
  get('mu-form').addEventListener('submit',event=>{
    event.preventDefault();
    if(submitting||get('mu-submit').disabled||!muForm)return;
    action(async()=>{
      muFormError('');
      if(!get('mu-terms').checked)throw Error(panelText('请先接受所选 MuScriptor 模型的条款。'));
      const variant=selectedMu(),modelFile=muForm==='import'?get('mu-file').value.trim():'',accessToken=muForm==='download'?get('mu-token').value.trim():'';
      if(muForm==='import'&&!modelFile)throw Error(panelText('请选择已下载完成的 model.safetensors。'));
      if(muForm==='download'&&!accessToken)throw Error(panelText('请填写有该模型读取权限的 Hugging Face 令牌。'));
      muVariant=variant;submitting=true;render();get('mu-token').value='';
      try{
        const result=await request('install',{components:['muscriptor'],region:get('region').value,muscriptor:{variant,acceptTerms:true,modelFile,token:accessToken}});
        job=result.job;render();get('progress').scrollIntoView({block:'nearest'});poll();
      }finally{submitting=false;render();}
    },muFormError);
  });
  get('close')?.addEventListener('click',()=>host.closest('dialog')?.close());
  host.closest('dialog')?.addEventListener('close',()=>{clearTimeout(timer);resetMuForm();});
  host.querySelector('a[href="/"]')?.addEventListener('click',event=>{event.preventDefault();action(async()=>{await request('finish',{});location.href='/';});});
  async function request(action,body){if(!token){const response=await fetch('/api/status');if(!response.ok)throw Error(panelText('本机服务未连接'));token=(await response.json()).token;}const response=await fetch('/api/components/'+action,{headers:{'X-Studio-Token':token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||panelText('组件请求失败'));return result;}
  function error(value){get('error').hidden=!value;get('error').textContent=value||'';}
  async function action(fn,report=error){try{error('');await fn();}catch(reason){report(reason.message);}}
  function render(){
    const busy=submitting||refreshing||active(job)||Boolean(status?.busy),grid=get('grid');grid.replaceChildren();
    const expanded=selected.size?orderedComponents([...selected]):[];
    for(const item of (status?.components||COMPONENTS).filter(item=>item.category!=='sounds'&&item.id!=='muscriptor')){const card=element('article',undefined,'component-card'),header=element('header'),label=element('label'),input=element('input');card.dataset.componentId=item.id;input.type='checkbox';input.checked=Boolean(item.ready||item.required||expanded.includes(item.id));input.disabled=busy||item.required||item.ready||item.checking;input.addEventListener('change',()=>{if(input.checked)selected.add(item.id);else for(const id of selected)if(orderedComponents([id]).includes(item.id))selected.delete(id);render();});label.append(input,document.createTextNode(panelText(item.name)));header.append(label,element('span',item.checking?panelText('待检查'):item.ready?(item.sharedWith?panelText('随显卡组件可用'):item.external?panelText('正在复用'):panelText('已安装')):panelText('未安装'),'component-badge'+(item.ready?' ready':'')));card.append(header,element('p',panelText(item.description)),element('div',panelText(item.download),'component-size'));if(!item.ready&&item.reason)card.append(element('div',item.reason,'component-reason'));if(item.ready&&item.sharedWith)card.append(element('div',panelText('已包含在显卡组件中，无需单独下载。识别路径仍需通过一致性检查。'),'component-reason'));if(item.external){card.append(element('p',item.location,'component-location'));if(!item.sharedWith){const unlink=element('button',panelText('解除复用'));unlink.disabled=busy;unlink.addEventListener('click',()=>action(async()=>{await request('unlink',{component:item.id});await refresh();}));card.append(unlink);}}grid.append(card);}
    get('scan').disabled=busy;get('folder-scan').disabled=busy;get('refresh').disabled=refreshing||active(job);get('skip').disabled=busy;
    get('progress').hidden=!job;get('stage').textContent=job?job.stage:'';get('cancel').hidden=!active(job);get('cancel').disabled=job?.state==='cancelling';get('logs').textContent=(job?.logs||[]).join('\n');
    if(job&&(!active(job)||Number.isFinite(job.unitProgress)||job.kind==='scan')){get('bar').value=active(job)&&job.kind!=='scan'?job.unitProgress:job.progress||0;}else get('bar').removeAttribute('value');updateFooter();found();renderMu(busy);
  }
  function updateFooter(){const install=componentInstallState(status,[...selected],{refreshing:refreshing||submitting,job}),{chosen}=install,space=chosen.reduce((sum,c)=>sum+c.space,0),free=status?.freeBytes;get('space').textContent=tr('所选组件预留空间约 ','Estimated space: ')+space.toFixed(1)+' GB'+(Number.isFinite(free)?tr(' · 当前磁盘可用 ',' · Available disk space: ')+(free/1024**3).toFixed(1)+' GB':'')+(status?.installDirectory?tr(' · 安装位置：',' · Install folder: ')+status.installDirectory:'');get('install').disabled=install.disabled;get('install').title=install.reason;get('install-hint').textContent=install.reason;get('install').textContent=refreshing?panelText('检查组件中…'):active(job)?panelText('组件任务进行中…'):status?.busy?panelText('等待当前任务…'):panelText('安装所选组件');}
  function found(){if(job?.kind==='scan')scannedCandidates=job.candidates||[];const results=get('results');results.replaceChildren();get('found').hidden=!scannedCandidates.length;for(const candidate of scannedCandidates){const row=element('li'),button=element('button',panelText('校验并复用')),description=element('div',candidate.name+(candidate.gpuName?' · '+candidate.gpuName:''));description.append(element('small',candidate.location));button.disabled=active(job)||refreshing||Boolean(status?.busy);button.addEventListener('click',()=>action(async()=>{const result=await request('reuse',{candidateId:candidate.candidateId});job=result.job;render();poll();}));row.append(description,button);results.append(row);}}
  let appliedSignature=null;
  async function refresh(force=false){if(refreshing)return;refreshing=true;render();try{status=await request('status'+(force?'?refresh=1':''));job=status.job||null;if(job?.kind==='scan')choice='scan';for(const component of status.components)if(component.ready)selected.delete(component.id);const signature=JSON.stringify(status.components);if(!status.busy&&signature!==appliedSignature){await onChanged(status);appliedSignature=signature;}found();}catch(error){if(status?.busy)status={components:COMPONENTS.map(item=>({...item,ready:item.id==='base',checking:false,reason:item.id==='base'?'':panelText('未能检查；可重试或指定已有环境目录')})),busy:false};throw error;}finally{refreshing=false;render();}if(active(job))poll();else if(status?.refreshing===true&&(standalone||host.closest('dialog')?.open)){clearTimeout(timer);timer=setTimeout(()=>action(()=>refresh(false)),1200);}else if(status?.busy&&(standalone||host.closest('dialog')?.open)){clearTimeout(timer);timer=setTimeout(()=>action(()=>refresh(false)),1500);}}
  function poll(){clearTimeout(timer);timer=setTimeout(()=>action(async()=>{const result=await request('job');job=result.job;render();found();if(active(job))poll();else await refresh(true);}),650);}
  function scan(folder){choice='scan';get('choice').textContent=panelText('已允许此次扫描');return action(async()=>{const result=await request('scan',{consent:true,...(folder?{folder}:{})});job=result.job;render();poll();});}
  get('scan').addEventListener('click',()=>scan(null));get('folder-scan').addEventListener('click',()=>{const folder=get('folder').value.trim();if(!folder)return error(panelText('请先填写已有环境的完整目录'));scan(folder);});get('skip').addEventListener('click',()=>{choice='skip';get('choice').textContent=panelText('未扫描，使用程序内环境');render();});get('refresh').addEventListener('click',()=>action(()=>refresh(true)));get('cancel').addEventListener('click',()=>action(async()=>{await request('cancel',{});poll();}));get('install').addEventListener('click',()=>action(async()=>{if(!choice){choice='skip';get('choice').textContent=panelText('未扫描，使用程序内环境');}const result=await request('install',{components:[...selected],region:get('region').value});job=result.job;render();poll();}));
  const unrenderLanguage=onLanguageChange(()=>{render();get('choice').textContent=choice==='scan'?panelText('已允许此次扫描'):choice==='skip'?panelText('未扫描，使用程序内环境'):'';});
  await action(refresh);if(standalone){if(requested.includes('muscriptor'))focusMu();const q=new URLSearchParams(location.search),folder=q.get('folder');if(folder){get('folder').value=folder;await scan(folder);}else if(q.get('consent')==='1')await scan(null);}
  return {refresh,focus:(id,variant)=>{if(id==='muscriptor'){focusMu(variant);return;}host.querySelector(`[data-grid] .component-card[data-component-id="${id}"]`)?.scrollIntoView({block:'nearest'});},dispose:()=>{clearTimeout(timer);unbindLanguage();unrenderLanguage();}};
}

export function applyComponentAvailability(status,recognitionMode='traditional',muVariant){
  const map=new Map((status.components||[]).map(item=>[item.id,item]));
  const controls={audio:['autoSeparate','separate'],lyrics:['lyricsTranscribe','lyricsAlign','lyricAssist'],singing:['singingFine'],[recognitionMode==='muscriptor'?'muscriptor':'basic']:['transcribe']};
  for(const [id,ids] of Object.entries(controls)){const item=map.get(id),component=id==='muscriptor'&&muVariant?(item?.variants?.[muVariant]?{...item,...item.variants[muVariant]}:null):item;if(!component||component.checking)continue;for(const name of ids){const target=document.getElementById(name);if(!target)continue;
      const wasMissing=target.dataset.componentMissing==='true',missing=!component.ready,help=panelText(component.description)+(missing?panelText(' 需要安装：打开“组件管理”下载或复用。'):'');target.classList.toggle('component-unavailable',missing);target.setAttribute('aria-disabled',String(missing));target.dataset.component=id;target.dataset.componentMissing=String(missing);target.title=help;if(target.type==='checkbox'){target.closest('label')?.classList.toggle('component-unavailable-label',missing);if(missing){target.checked=false;if(!target.disabled)target.disabled=true;target.closest('label')?.setAttribute('title',help);}else if(wasMissing&&target.disabled&&!status.busy){target.disabled=false;target.closest('label')?.setAttribute('title',help);}}
      else if(missing&&!target.disabled)target.disabled=true;
  }}

  const device=document.getElementById('computeDevice'),gpu=map.get('gpu');if(device&&gpu&&!gpu.checking){const option=device.querySelector('option[value=cuda]');if(option){if(option.disabled===Boolean(gpu.ready))option.disabled=!gpu.ready;option.title=panelText(gpu.description)+(!gpu.ready?panelText(' 需要安装显卡组件。'):'');}if(!gpu.ready&&device.value==='cuda'){device.value='auto';device.dispatchEvent(new Event('change',{bubbles:true}));}}
  const profile=document.getElementById('recognitionProfile'),audio=map.get('audio');if(profile&&audio&&!audio.checking){for(const option of profile.options){let missing=null;if(option.value==='pyin')missing=!audio.ready;if(option.value==='crepe')missing=!(audio.crepe||gpu?.crepe);if(missing!==null){if(option.disabled!==missing)option.disabled=missing;option.title=missing?panelText('此识别方案所需的本机音高组件尚未就绪，请查看组件管理。'):'';if(missing&&profile.value===option.value){profile.value='legacy';profile.dispatchEvent(new Event('change',{bubbles:true}));}}}}
}
