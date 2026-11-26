import {tr,onLanguageChange} from './i18n.mjs';
import {bindEditorLanguage} from './editor-i18n.mjs';
import {EDIT_STEP,KEYS,keyAt,pitchName} from './music.mjs';
import {degreeMidi,describePitch,sequencePlan,SOLFEGE} from './entry-notes.mjs';

export function createSequenceEntry({getProject,getStart,getSelectedStart,isBusy,write,audition,stopAudition,onError}){
  const host=document.createElement('details');host.id='sequenceEntry';host.className='sequence-entry';
  host.innerHTML=`<summary>连续写音符</summary><p class="hint">先排一串、试听预览，最后一次写入；未写入前不改变谱子。</p>
  <label class="field">从第几拍开始<input id="sequenceStart" type="number" min="1" max="14400" step=".0625" value="1"></label>
  <div class="stepper"><button id="sequenceAtPlayhead">取播放位置</button><button id="sequenceAtSelection">取选中起点</button></div>
  <p id="sequenceKey" class="hint"></p><div class="field-row"><label class="field">高低音组<select id="sequenceOctave"><option value="-3">低三组</option><option value="-2">低两组</option><option value="-1">低音</option><option value="0" selected>中音</option><option value="1">高音</option><option value="2">高两组</option><option value="3">高三组</option></select></label><label class="field">升降号<select id="sequenceAccidental"><option value="0">原音</option><option value="1">升半音 ♯</option><option value="-1">降半音 ♭</option></select></label></div>
  <label class="field">持续拍数<input id="sequenceDuration" type="number" min=".0625" max="64" step=".0625" value="1"></label>
  <div class="duration-presets">${[[.0625,'1/16'],[.125,'1/8'],[.25,'1/4'],[.5,'半拍'],[1,'1拍'],[2,'2拍'],[4,'4拍']].map(([v,label])=>`<button data-duration="${v}" title="${tr(`选择 ${v} 拍时长`,`Choose a duration of ${v} beats`,`長さ ${v}拍を選択`)}">${label}</button>`).join('')}</div>
  <div class="pitch-digits sequence-digits">${[1,2,3,4,5,6,7,0].map(d=>`<button data-degree="${d}" title="${tr(d?'加入'+d+' '+SOLFEGE[d]:'加入空拍',d?'Add '+d+' '+SOLFEGE[d]:'Add a rest',d?d+' '+SOLFEGE[d]+'を追加':'休符を追加')}${tr('；选中队列项时改此项','; changes the selected queue item when editing','。キュー項目を選択中はその項目を変更します')}"><b>${d}</b><small>${tr(SOLFEGE[d],d?SOLFEGE[d]:'Rest')}</small></button>`).join('')}</div>
  <p id="sequenceEditing" class="hint"></p><div id="sequenceQueue" class="sequence-queue" aria-label="待写入音符"></div>
  <div class="stepper"><button id="sequenceNext">继续添加</button><button id="sequenceDelete">删除所选项</button></div><div class="stepper"><button id="sequenceRemoveLast">移除末项</button><button id="sequenceClear">清空队列</button></div>
  <p id="sequenceSummary" role="status"></p><div class="stepper"><button id="sequenceListen">整串试听</button><button id="sequenceStop">停止试听</button></div><button id="sequenceWrite" class="primary wide">一次写入</button><p class="hint">休止项在对应范围留空。已有音符需要确认覆盖，不推走后续音符；可一次撤销。</p>
  <details id="sequenceAdvanced"><summary>高级：文本输入</summary></details>`;
  bindEditorLanguage(host);document.querySelector('.project-title-field').after(host);
  const textTool=document.querySelector('.free-write-tools');textTool.querySelector('summary').remove();document.getElementById('sequenceAdvanced').append(...textTool.childNodes);textTool.remove();
  const $=id=>document.getElementById(id);let items=[],editing=-1,fixedStart=0,sounding=false,manualAnchor=false;
  const key=()=>keyAt(getProject(),fixedStart+(editing>=0?items.slice(0,editing):items).reduce((n,x)=>n+x.duration,0));
  function handler(node,event,action){node.addEventListener(event,async()=>{try{if(isBusy())throw Error(tr("当前任务结束后可继续输入","Wait for the current task to finish before entering notes"));await action();refresh();}catch(e){onError(e);refresh();}});}
  function setStart(value){const start=Number(value)-1;if(!Number.isFinite(start)||start<0||start>14400||Math.abs(start/EDIT_STEP-Math.round(start/EDIT_STEP))>1e-6)throw Error(tr("起点须为 1/16 拍的倍数","The start must be a multiple of 1/16 beat"));if(items.length)sequencePlan(getProject(),start,items);fixedStart=start;manualAnchor=true;stop();}
  function stop(){stopAudition();sounding=false;}
  function validate(next){if(next.length)sequencePlan(getProject(),fixedStart,next);}
  handler($('sequenceStart'),'change',()=>setStart($('sequenceStart').value));
  $('sequenceStart').addEventListener('input',()=>{const value=Number($('sequenceStart').value);if(!isBusy()&&$('sequenceStart').value.trim()&&value>=1&&Math.abs((value-1)/EDIT_STEP-Math.round((value-1)/EDIT_STEP))<1e-6){try{setStart(value);refresh();}catch(e){onError(e);}}});
  handler($('sequenceAtPlayhead'),'click',()=>setStart(getStart()+1));
  handler($('sequenceAtSelection'),'click',()=>{const start=getSelectedStart();if(start===null)throw Error(tr("先选择一个音符","Select a note first"));setStart(start+1);});
  for(const button of host.querySelectorAll('[data-degree]'))handler(button,'click',()=>{
    const midi=degreeMidi(+button.dataset.degree,{key:key(),octave:+$('sequenceOctave').value,accidental:+$('sequenceAccidental').value}),item={midi,duration:+$('sequenceDuration').value};
    const next=items.map(x=>({...x}));if(editing>=0)next[editing]=item;else next.push(item);validate(next);stop();items=next;
  });
  function changeDuration(){if(editing<0)return;const next=items.map((x,i)=>i===editing?{...x,duration:+$('sequenceDuration').value}:x);validate(next);stop();items=next;}
  for(const button of host.querySelectorAll('[data-duration]'))handler(button,'click',()=>{$('sequenceDuration').value=button.dataset.duration;changeDuration();});
  handler($('sequenceDuration'),'change',changeDuration);
  for(const id of ['sequenceOctave','sequenceAccidental'])handler($(id),'change',()=>{});
  handler($('sequenceNext'),'click',()=>{editing=-1;});
  handler($('sequenceDelete'),'click',()=>{if(editing>=0)items.splice(editing,1);editing=-1;stop();});
  handler($('sequenceRemoveLast'),'click',()=>{items.pop();editing=-1;stop();});
  handler($('sequenceClear'),'click',()=>{items=[];editing=-1;stop();});
  handler($('sequenceListen'),'click',async()=>{stop();await audition(sequencePlan(getProject(),fixedStart,items));sounding=true;});
  handler($('sequenceStop'),'click',stop);
  handler($('sequenceWrite'),'click',()=>{const plan=sequencePlan(getProject(),fixedStart,items);stop();const snapshot=items;write(plan,()=>{if(items===snapshot){items=[];editing=-1;fixedStart=plan.end;manualAnchor=true;refresh();}});});
  function refresh(){
    const busy=isBusy();if(!items.length&&!manualAnchor&&editing<0&&document.activeElement!==$('sequenceStart'))fixedStart=Math.max(0,getStart());
    if(document.activeElement!==$('sequenceStart'))$('sequenceStart').value=fixedStart+1;$('sequenceKey').textContent=tr(`下一项按当前位置调号：1=${KEYS[key()]}。队列中的实际音高不会随起点变化。`,`Next note uses the key at this position: 1=${KEYS[key()]}. Changing the start does not transpose queued notes.`,`次の音符はこの位置のキーで決まります：1=${KEYS[key()]}。開始位置を変えてもキューのピッチは変わりません。`);
    for(const node of host.querySelectorAll('input,select,button'))if(!node.closest('#sequenceAdvanced'))node.disabled=busy;
    for(const b of host.querySelectorAll('[data-degree]')){
      const degree=+b.dataset.degree;
      b.querySelector('small').textContent=degree?SOLFEGE[degree]:tr('休止','Rest');
      b.title=tr(degree?'加入'+degree+' '+SOLFEGE[degree]:'加入空拍',degree?'Add '+degree+' '+SOLFEGE[degree]:'Add a rest',degree?degree+' '+SOLFEGE[degree]+'を追加':'休符を追加')+tr('；选中队列项时改此项','; changes the selected queue item when editing','。キュー項目を選択中はその項目を変更します');
      try{degreeMidi(degree,{key:key(),octave:+$('sequenceOctave').value,accidental:+$('sequenceAccidental').value});}catch{b.disabled=true;}
    }
    for(const b of host.querySelectorAll('[data-duration]'))b.title=tr(`选择 ${b.dataset.duration} 拍时长`,`Choose a duration of ${b.dataset.duration} beats`,`長さ ${b.dataset.duration}拍を選択`);
    const queue=$('sequenceQueue');queue.replaceChildren();let cursor=fixedStart;
    items.forEach((n,i)=>{const p=describePitch(n.midi,keyAt(getProject(),cursor)),b=document.createElement('button');b.type='button';b.dataset.entryIndex=i;b.textContent=`${p.notation} · ${n.duration} ${tr('拍','beats')}`;b.title=tr(`修改第 ${i+1} 项：${p.label}（${pitchName(n.midi)}）`,`Edit item ${i+1}: ${p.label} (${pitchName(n.midi)})`,`第 ${i+1} 項を変更：${p.label}（${pitchName(n.midi)}）`);b.setAttribute('aria-pressed',String(i===editing));b.disabled=busy;handler(b,'click',()=>{editing=i;$('sequenceDuration').value=n.duration;$('sequenceOctave').value=Math.max(-3,Math.min(3,p.octave));$('sequenceAccidental').value=p.accidental==='♯'?1:p.accidental==='♭'?-1:0;});queue.append(b);cursor+=n.duration;});
    $('sequenceEditing').textContent=editing>=0?tr(`正在改第 ${editing+1} 项；点数字替换音高，调时长改变后续队列位置。`,`Editing item ${editing+1}. Click a number to change pitch; changing duration shifts later queued notes.`,`第 ${editing+1} 項を編集中です。数字を押すとピッチが変わり、長さを変えると後続のキュー位置がずれます。`):tr('点击数字添加；点击队列中的小块修改。','Click a number to add a note; click a queued item to edit it.');
    $('sequenceSummary').textContent=items.length?(()=>{const p=sequencePlan(getProject(),fixedStart,items);return tr(`${items.length} 项 · 共 ${p.beats} 拍 · 第 ${+(p.start+1).toFixed(4)}–${+(p.end+1).toFixed(4)} 拍 · 约 ${p.seconds.toFixed(2)} 秒`,`${items.length} items · ${p.beats} beats · beats ${+(p.start+1).toFixed(4)}–${+(p.end+1).toFixed(4)} · about ${p.seconds.toFixed(2)} s`,`${items.length}件 · 全${p.beats}拍 · 第${+(p.start+1).toFixed(4)}–${+(p.end+1).toFixed(4)}拍 · 約${p.seconds.toFixed(2)}秒`);})():tr("队列为空","Queue is empty");
    for(const id of ['sequenceRemoveLast','sequenceClear','sequenceListen','sequenceWrite'])$(id).disabled=busy||!items.length;
    $('sequenceDelete').disabled=busy||editing<0;$('sequenceStop').disabled=!sounding;$('sequenceAtSelection').disabled=busy||getSelectedStart()===null;
  }
  const dialog=document.createElement('dialog');dialog.id='sequenceDiscardDialog';dialog.innerHTML='<form method="dialog"><h2>还有未写入的音符</h2><p>继续将放弃连续输入队列。已写入的谱子不受影响。</p><div class="actions"><button value="cancel">取消</button><button value="discard" class="danger">放弃并继续</button></div></form>';bindEditorLanguage(dialog);document.body.append(dialog);
  let pendingDiscard=null;
  async function confirmDiscard(){if(!items.length){manualAnchor=false;return true;}if(pendingDiscard)return pendingDiscard;dialog.returnValue='cancel';dialog.showModal();pendingDiscard=new Promise(resolve=>dialog.addEventListener('close',()=>{const discard=dialog.returnValue==='discard';if(discard){items=[];editing=-1;manualAnchor=false;stop();refresh();}pendingDiscard=null;resolve(discard);},{once:true}));return pendingDiscard;}
  onLanguageChange(refresh);refresh();return {refresh,confirmDiscard,hasPending:()=>items.length>0,stop};
}
