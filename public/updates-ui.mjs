import {releaseNotesHTML} from './release-notes.mjs';
export function installUpdates({saveSession,restoreSession,onError=()=>{}}){
  let id=sessionStorage.getItem('notemender-update-client')||crypto.randomUUID();sessionStorage.setItem('notemender-update-client',id);
  async function claimTab(){if(!navigator.locks)throw Error('浏览器不支持安全的多标签页更新，请使用新版 Chrome 或 Edge');const attempted=id;await new Promise((resolve,reject)=>navigator.locks.request('notemender-tab-'+attempted,{ifAvailable:true},async lock=>{if(!lock){id=crypto.randomUUID();sessionStorage.setItem('notemender-update-client',id);resolve();return;}resolve();await new Promise(()=>{});}).catch(reject));if(id!==attempted)await claimTab();}
  let token,status,preparing=false,locked=false,restarting=false,restored=false,lastChallenge=null,pollBusy=false,downloadPoll=null,serverChanged=false,initialToken=null,brokenConnection=false,awaitingResult=false,successBanner=null;
  const dialog=document.createElement('dialog');dialog.id='updatesDialog';dialog.className='updates-dialog';dialog.setAttribute('aria-label','版本与更新');
  dialog.innerHTML='<form method="dialog"><div class="dialog-head"><h2>版本与更新</h2><button aria-label="关闭版本与更新">×</button></div></form><p data-current></p><label class="checkbox"><input type="checkbox" data-automatic>启动及每6小时检查更新</label><p class="hint">只检查版本；下载和安装均由你确认。更新保留模型、组件和个人资料。</p><div class="updates-actions"><label>更新源 <select data-source><option value="auto">自动（国内优先）</option><option value="domestic">国内源</option><option value="github">GitHub 备用</option></select></label><button data-check>检查更新</button><button data-download disabled>下载更新</button><button data-cancel disabled>取消下载</button><button data-apply disabled class="primary">安装并重启</button><a data-manual href="https://cnb.cool/goldotto/NoteMender/-/releases/tag/v2.5.0-demo.7" target="_blank" rel="noopener noreferrer">手动下载 ↗</a></div><p data-status role="status"></p><progress data-progress max="1" value="0" hidden></progress><p data-progress-text class="hint"></p><p data-latest></p><details><summary>更新来源</summary><p data-sources></p><p class="hint">默认使用 CNB 国内源，失败时尝试 GitHub；所有来源必须通过相同签名和 SHA-256 校验。旧包缺少安装凭据时请先手动迁移。</p></details><details open><summary>版本说明</summary><h3>本机版本</h3><div data-local-notes class="release-notes"></div><h3>可用版本 / 上次获取的说明</h3><div data-notes class="release-notes"></div></details><details><summary>本机更新记录</summary><pre data-history></pre></details>';
  document.body.append(dialog);const $=s=>dialog.querySelector('[data-'+s+']'),entry=document.getElementById('updatesTop');
  const overlay=document.createElement('dialog');overlay.className='update-freeze';overlay.hidden=true;overlay.innerHTML='<div><strong>正在保存工作并准备更新</strong><p data-freeze-message>此页面暂时停止编辑；完成后将恢复到原位置。</p><button type="button">取消准备并返回编辑</button></div>';document.body.append(overlay);
  overlay.addEventListener('cancel',e=>e.preventDefault());
  function freeze(value){locked=value;overlay.hidden=!value;if(value&&!overlay.open)overlay.showModal();if(!value&&overlay.open)overlay.close();document.documentElement.classList.toggle('update-locked',value);}
  const keyGuard=e=>{if(locked&&!overlay.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();}};document.addEventListener('keydown',keyGuard,true);document.addEventListener('beforeinput',keyGuard,true);
  async function request(route,body){
    const fresh=async()=>{const r=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('本机服务未连接');token=(await r.json()).token;if(initialToken&&initialToken!==token)serverChanged=true;initialToken??=token;};if(!token)await fresh();
    const call=()=>fetch('/api/updates/'+route,{cache:'no-store',headers:{'X-Studio-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),signal:AbortSignal.timeout(route==='session'?120000:route==='check'?60000:15000)});
    let r=await call();if(r.status===403){await fresh();r=await call();}const value=await r.json();if(!r.ok)throw Error(value.error||'更新请求失败');return value;
  }
  function announceResult(s){const last=s.history.at(-1);if(last?.to?.build!==s.current.build||last.result!=='success')return;awaitingResult=false;if(localStorage.getItem('notemender-update-seen')===String(last.to.build))return;localStorage.setItem('notemender-update-seen',String(last.to.build));successBanner=document.createElement('aside');successBanner.className='update-success-banner';successBanner.setAttribute('role','status');const text=document.createElement('span');text.textContent=`已更新至 ${s.current.version}（构建 ${s.current.build}），工作已恢复。`;const details=document.createElement('button');details.textContent='查看更新说明';details.onclick=()=>entry.click();const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>{successBanner.remove();successBanner=null;};successBanner.append(text,details,close);document.body.append(successBanner);}
  function render(s){status=s;announceResult(s);const c=s.current,d=s.download,l=s.latest; $('manual').href=s.sources?.domesticPage||'https://cnb.cool/goldotto/NoteMender/-/releases/tag/v2.5.0-demo.7'; $('current').textContent=`NoteMender ${c.version} · 构建 ${c.build||'未核实'} · ${c.distribution==='development'?'源码开发目录':'便携分发版'} · ${c.releasedAt?new Date(c.releasedAt).toLocaleDateString('zh-CN'):''}`;$('automatic').checked=s.automatic;$('source').value=s.source||'auto';$('sources').textContent='国内索引：'+(s.sources?.domesticIndex||'尚未配置，未上线')+'；GitHub 索引：'+(s.sources?.githubIndex||'')+(s.checkedSource?'；最近成功来源：'+s.checkedSource:'');
    const text={unchecked:'尚未检查更新',checking:'正在检查更新…',latest:'检查成功，当前已是最新版本',available:'发现可用更新',failed:'检查更新失败',unavailable:'自动更新尚未开放'};
    $('status').textContent=(text[s.state]||s.state)+(s.error?'：'+s.error:'')+(s.checkedAt?' · 最近成功检查 '+new Date(s.checkedAt).toLocaleString('zh-CN'):'');
    $('check').disabled=s.state==='checking'||s.applying;$('download').disabled=!l?.available||['downloading','verifying'].includes(d?.state)||s.applying;$('cancel').disabled=!['downloading','verifying'].includes(d?.state);$('apply').disabled=d?.state!=='ready'||s.applying||c.distribution!=='portable';$('apply').title=c.distribution!=='portable'?'源码开发目录受到保护，请另存新版或手动更新':'保存所有打开页面后安装并重启';
    $('latest').textContent=l?`可用信息：${l.version} · 构建 ${l.build} · ${(l.size/1024/1024).toFixed(1)} MB${s.state==='failed'?'（缓存信息）':''}`:'尚未取得可信的更新信息';$('notes').innerHTML=releaseNotesHTML(l?.notes||'暂无');$('history').textContent=s.history.map(h=>`${new Date(h.at).toLocaleString('zh-CN')} · ${h.from?.build||'?'} → ${h.to?.build||'?'} · ${{success:'成功','rolled-back':'已回退',failed:'失败'}[h.result]||h.result}${h.reason?'\n'+h.reason:''}`).join('\n\n')||'暂无更新记录';
    $('progress').hidden=!d;$('progress').value=d?Math.min(1,d.bytes/d.total):0;$('progress-text').textContent=d?`${d.stage}${d.source?' · '+(d.source==='domestic'?'国内源':'GitHub'):''} · ${(d.bytes/1024/1024).toFixed(1)} / ${(d.total/1024/1024).toFixed(1)} MB${d.speed?' · '+(d.speed/1024/1024).toFixed(2)+' MB/s':''}${d.error?' · '+d.error:''}`:'';entry.textContent=l?.available?'版本与更新 · 有更新':'版本与更新';
    if(d&&['downloading','verifying'].includes(d.state)&&!downloadPoll)downloadPoll=setInterval(()=>refresh().catch(()=>{}),700);else if(!['downloading','verifying'].includes(d?.state)&&downloadPoll){clearInterval(downloadPoll);downloadPoll=null;}
  }
  async function refresh(){render(await request('status'));}
  async function act(fn){try{await fn();}catch(e){$('status').textContent=e.message;onError(e);}}
  async function heartbeat(){
    if(pollBusy)return;pollBusy=true;try{
      const r=await request('client',{id,restored});
      if(r.applying){restarting=true;overlay.querySelector('[data-freeze-message]').textContent='更新正在安装，页面会自动恢复；请勿关闭此标签页。';overlay.querySelector('button').disabled=true;freeze(true);}
      if(restarting&&(serverChanged||(brokenConnection&&!r.applying)||status?.current&&r.current.build!==status.current.build)){location.reload();return;}
      const challenge=r.challenge;
      if(!challenge&&!restarting){freeze(false);lastChallenge=null;}
      if(challenge&&Date.now()>challenge.expiresAt&&!restarting){freeze(false);return;}
      if(challenge&&lastChallenge!==challenge.id&&!preparing){lastChallenge=challenge.id;preparing=true;freeze(true);try{const data=await saveSession();await request('session',{id,challenge:challenge.id,data});}catch(e){await request('client',{id,error:e.message});freeze(false);onError(e);}finally{preparing=false;}}
      if(awaitingResult&&Date.now()-awaitingResult>180000)awaitingResult=false;
      if(dialog.open||awaitingResult)await refresh();
    }catch(e){token=null;if(locked){brokenConnection=true;restarting=true;overlay.querySelector('[data-freeze-message]').textContent='正在等待程序重新启动。若长时间未恢复，请重新运行启动程序；已保存的恢复副本仍保留。';}}finally{pollBusy=false;}
  }
  overlay.querySelector('button').onclick=()=>act(async()=>{await request('abort-prepare',{});freeze(false);lastChallenge=null;});
  entry.addEventListener('click',()=>act(async()=>{dialog.showModal();await refresh();$('local-notes').innerHTML=releaseNotesHTML((await request('notes')).notes);}));
  $('check').onclick=()=>act(async()=>{render({...status,state:'checking'});render(await request('check',{}));});
  $('source').onchange=()=>act(async()=>render(await request('settings',{source:$('source').value})));
  $('automatic').onchange=()=>act(async()=>render(await request('settings',{automatic:$('automatic').checked})));
  $('download').onclick=()=>act(async()=>render(await request('download',{})));$('cancel').onclick=()=>act(async()=>{await request('cancel',{});await refresh();});
  $('apply').onclick=()=>act(async()=>{
    try{if(!confirm('保存所有打开页面的工作后安装更新并重启？未提交的连续写入等内容请先处理；程序目录会保留回退副本。'))return;
    const s=await request('prepare',{id:status.download.id});render(s);await heartbeat();
    for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,500));await refresh();if(!status.challenge)throw Error('更新准备已取消');if(status.challenge.clients.some(c=>c.error))throw Error('其他页面保存失败：'+status.challenge.clients.filter(c=>c.error).map(c=>c.error).join('；'));if(status.challenge.ready){await request('apply',{id:status.download.id});restarting=true;overlay.querySelector('button').disabled=true;return;}}
    throw Error('有页面未完成保存；请关闭或处理其他标签页后重试');}finally{if(!restarting){await request('abort-prepare',{}).catch(()=>{});freeze(false);}}
  });
  window.addEventListener('pagehide',()=>{if(!locked&&token)fetch('/api/updates/client',{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:JSON.stringify({id,close:true}),keepalive:true}).catch(()=>{});});
  const ready=(async()=>{
    await claimTab();await request('client',{id});await refresh();if(status.applying){restarting=true;freeze(true);overlay.querySelector('button').disabled=true;}const r=await request('session?id='+id);if(r.session&&sessionStorage.getItem('notemender-restored-task')!==r.task){freeze(true);await restoreSession(r.session);sessionStorage.setItem('notemender-restored-task',r.task);restored=true;await request('client',{id,restored:true});freeze(false);}
    if(r.session&&!restored){restored=true;await request('client',{id,restored:true});}
    awaitingResult=!!r.session&&Date.now();await refresh();
  })().catch(e=>{onError(e);if(locked)overlay.querySelector('[data-freeze-message]').textContent='工作恢复失败，程序将保留恢复副本并等待回退。请勿继续编辑。';});
  ready.then(()=>{setTimeout(()=>request('check',{automatic:true}).then(render).catch(()=>{}),2500);setInterval(()=>request('check',{automatic:true}).then(render).catch(()=>{}),6*3600000);setInterval(heartbeat,1500);});return {ready};
}
