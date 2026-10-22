import {FEEDBACK_EMAIL,feedbackMail} from './feedback-mail.mjs';
import {redact} from './diagnostics-data.mjs';
export function offlineReport(input,events,snapshot){
  return {reportId:crypto.randomUUID(),createdAt:new Date().toISOString(),version:snapshot?.version||'服务未连接，版本未核实',build:snapshot?.build||null,session:snapshot?.session||'浏览器临时记录',environment:snapshot?.environment||{},events:[...events,{time:new Date().toISOString(),source:'browser',level:'warn',event:'service.disconnected',message:'无法读取服务器日志；此报告仅含当前页面记录。'}],feedback:Object.fromEntries(['description','steps','expected'].map(key=>[key,redact(input[key])])),browser:input.browser,view:input.view};
}
export function reportText(report,{includeLogs=true}={}){
  const feedback=report.feedback||{},env=report.environment||{};
  const updates=includeLogs?(report.updates||[]).map(h=>`${h.at} · ${h.from} → ${h.to} · ${h.result} · ${h.phase||''} ${h.reason||''}`):[];
  const events=(includeLogs?report.events||[]:[]).map(e=>`${e.time} [${e.level}] ${e.source}/${e.event}${e.operation?' 操作='+e.operation:''}${e.component?' 组件='+e.component:''}${e.state?' 状态='+e.state:''}${e.backend?' 后端='+e.backend:''}${e.method?' '+e.method:''}${e.status?' HTTP='+e.status:''}${e.elapsedMs!==undefined?' 耗时='+e.elapsedMs+'ms':''}${e.line?' 行='+e.line:''}${e.column?' 列='+e.column:''}${e.message?'\n'+e.message:''}${e.stack?'\n'+e.stack:''}`);
  return ['NoteMender 问题反馈报告',`报告编号：${report.reportId}`,`生成时间：${report.createdAt}`,`程序版本：${report.version}`,`构建编号：${report.build||'未核实'}`,`本次服务编号：${report.session}`,`系统：${env.platform} ${env.architecture} · ${env.osRelease}`,`Node：${env.node} · 逻辑核心 ${env.logicalCores} · 内存 ${env.memoryGiB} GiB`,`浏览器：${report.browser||'未提供'}`,`窗口：${report.view||'未提供'}`,report.storageError?'注意：日志文件写入失败；以下保留本次内存记录。':'日志保存在本机，无自动上传。', '', '【问题描述】',feedback.description||'未填写','', '【复现步骤】',feedback.steps||'未填写','', '【预期结果】',feedback.expected||'未填写','', '【最近更新记录】',...updates,'','【最近运行记录】',...events,'','报告不含音频、工程文件及设置文件。发送前请检查预览；截图或复现工程由你自行决定是否另附。'].join('\n');
}
export function installDiagnostics({getContext=()=>({})}={}){
  let token=null,sequence=Promise.resolve(),last=null,reportValue=null,previewUrl=null,count=0,windowAt=0,serverSnapshot=null;const localEvents=[];
  const dialog=document.createElement('dialog');dialog.id='feedbackDialog';dialog.className='feedback-dialog';dialog.setAttribute('aria-label','问题反馈与运行日志');
  dialog.innerHTML='<form method="dialog"><div class="dialog-head"><h2>问题反馈与运行日志</h2><button aria-label="关闭问题反馈">×</button></div></form><p class="hint">自动记录操作阶段、耗时和错误，仅保存在本机。不会自动发送，也不会读取歌曲、工程正文或歌词内容。</p><div class="feedback-fields"><label>遇到了什么问题？<textarea data-description maxlength="6000" placeholder="例如：安装原生 CPU 组件失败"></textarea></label><label>怎样重现？<textarea data-steps maxlength="6000" placeholder="按顺序描述点击了哪些功能"></textarea></label><label>希望得到什么结果？<textarea data-expected maxlength="6000"></textarea></label></div><label class="checkbox"><input type="checkbox" data-include-logs checked>报告包含经过处理的诊断日志（可取消）</label><div class="feedback-actions"><button type="button" data-preview>生成 / 更新报告预览</button><button type="button" data-export class="primary" disabled>下载反馈报告 TXT</button><button type="button" data-refresh>刷新日志</button><button type="button" data-clear>清空运行日志</button></div><div class="feedback-mail"><button type="button" data-mail disabled>打开邮件发送</button><button type="button" data-copy disabled>复制完整报告</button><button type="button" data-copy-email>复制邮箱</button><span>收件人：goldotto@proton.me</span></div><p class="hint">由你在邮件软件中确认发送。完整报告请复制到正文或下载 TXT 后附加；没有邮件软件时可使用网页邮箱。</p><p data-status class="hint" role="status"></p><details open><summary>最近运行记录</summary><pre data-logs></pre></details><details data-report hidden open><summary>即将导出的内容（可直接修改）</summary><p class="hint">个人路径与常见凭据已过滤。请检查错误文字及自己填写的内容，删除不想分享的信息后再下载。</p><textarea data-report-text aria-label="反馈报告预览" spellcheck="false"></textarea></details>';
  document.body.append(dialog);const get=id=>dialog.querySelector('[data-'+id+']');
  async function request(route,body){
    const fresh=async()=>{const r=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('本机服务未连接');token=(await r.json()).token;};
    if(!token)await fresh();
    const call=()=>fetch('/api/diagnostics/'+route,{signal:AbortSignal.timeout(5000),headers:{'X-Studio-Token':token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{} )});
    let r=await call();if(r.status===403){await fresh();r=await call();}const value=await r.json();if(!r.ok)throw Error(value.error||'日志请求失败');return value;
  }
  function record(input){
    // Avoid log storms, and never intercept fetch bodies or input text.
    const now=Date.now();if(now-windowAt>60000){windowAt=now;count=0;}if(++count>90||(count>75&&input.level!=='error'))return;
    const event={...input,source:'browser',time:new Date().toISOString()};for(const key of ['message','stack'])if(event[key])event[key]=redact(event[key]);localEvents.push(event);if(localEvents.length>100)localEvents.shift();
    sequence=sequence.then(()=>request('event',event)).catch(()=>{});
  }
  function error(error,operation='unknown'){
    if(error?.name==='AbortError')return;
    const message=String(error?.message||error||'未知错误');if(last?.message===message&&Date.now()-last.time<1000)return;last={message,time:Date.now()};
    record({level:'error',event:'operation.error',operation,message,stack:error?.stack});
  }
  window.addEventListener('error',event=>{if(event.error||event.message)record({level:'error',event:'script.error',message:event.message,stack:event.error?.stack,line:event.lineno,column:event.colno});});
  window.addEventListener('unhandledrejection',event=>error(event.reason,'unhandled-promise'));
  async function act(fn){get('status').textContent='正在读取…';try{await fn();}catch(e){get('status').textContent=e.message;}}
  async function refresh(){let result;try{result=serverSnapshot=await request('status');}catch{result={events:localEvents};get('status').textContent='本机服务未连接；仍可填写反馈并导出本页浏览器记录。';}get('logs').textContent=result.events.map(e=>`${e.time} [${e.level||'info'}] ${e.event}${e.message?' · '+e.message:''}${e.elapsedMs!==undefined?' · '+e.elapsedMs+'ms':''}`).join('\n')||'当前没有运行记录';if(result===serverSnapshot)get('status').textContent=`最近 ${result.events.length} 条记录${result.storageError?'；文件写入失败，当前使用内存记录':''}。日志自动轮换，最多约 3 MB。`;}
  async function preview(){
    let context={};try{context=getContext()||{};}catch(reason){error(reason,'feedback-context');}
    // Only known technical fields; never copy the project or component configuration.
    for(const c of context.components||[])record({event:'component.snapshot',component:c.id,state:c.checking?'checking':c.ready?'ready':'missing'});
    for(const [operation,backend] of Object.entries(context.backends||{}))record({event:'backend.snapshot',operation,backend});
    const input={description:get('description').value,steps:get('steps').value,expected:get('expected').value,browser:navigator.userAgent,view:`${innerWidth} × ${innerHeight} · 像素比 ${devicePixelRatio}`};
    try{await Promise.race([sequence,new Promise(resolve=>setTimeout(resolve,1000))]);reportValue=await request('report',input);}
    catch{reportValue=offlineReport(input,localEvents,serverSnapshot);}
    get('report').hidden=false;get('report-text').value=reportText(reportValue,{includeLogs:get('include-logs').checked});for(const name of ['export','mail','copy'])get(name).disabled=false;get('status').textContent='报告已生成。检查并修改下面的预览后，可打开邮件发送或复制、下载报告。';
  }
  get('preview').addEventListener('click',()=>act(preview));get('refresh').addEventListener('click',()=>act(refresh));
  get('export').addEventListener('click',()=>{
    if(!reportValue)return;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(new Blob(['\ufeff'+get('report-text').value],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=previewUrl;a.download='NoteMender-问题反馈-'+reportValue.createdAt.slice(0,19).replaceAll(':','-')+'.txt';a.click();
  });
  get('mail').onclick=()=>{if(!reportValue||get('mail').disabled)return;const link=document.createElement('a');link.href=feedbackMail(reportValue,get('report-text').value);link.click();get('status').textContent='已请求打开邮件软件，尚未确认发送；如无反应，请复制报告并发送到 '+FEEDBACK_EMAIL;};
  get('copy').onclick=()=>act(async()=>{await navigator.clipboard.writeText(get('report-text').value);get('status').textContent='完整报告已复制；请在自己的邮件中粘贴并发送。';});
  get('copy-email').onclick=()=>act(async()=>{await navigator.clipboard.writeText(FEEDBACK_EMAIL);get('status').textContent='反馈邮箱已复制。';});
  get('include-logs').onchange=()=>{for(const name of ['export','mail','copy'])get(name).disabled=true;get('status').textContent='日志选项已改变，请重新生成报告预览。';};
  get('clear').addEventListener('click',()=>{if(confirm('清空本机运行日志？已下载的报告仍会保留，歌曲和工程不会受到影响。'))act(async()=>{await sequence;await request('clear',{});localEvents.length=0;serverSnapshot=null;reportValue=null;for(const name of ['export','mail','copy'])get(name).disabled=true;get('report').hidden=true;await refresh();});});
  for(const name of ['description','steps','expected'])get(name).addEventListener('input',()=>{for(const name of ['export','mail','copy'])get(name).disabled=true;});
  const entry=document.getElementById('feedbackTop');entry?.addEventListener('click',()=>{dialog.showModal();act(refresh);});
  record({event:'editor.ready'});
  return {record,error};
}
