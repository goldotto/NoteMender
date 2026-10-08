// Pure UI construction. Existing element IDs remain the same for all editors.
export function compactInspector(){
  const actions=document.querySelector('.score-toolbar>.actions'),view=document.createElement('div'),edit=document.createElement('div');view.className='score-view-tools';edit.className='score-edit-tools';
  for(const node of [...actions.children]){if(node.tagName==='LABEL')view.append(node);else edit.append(node);}actions.append(view,edit);edit.prepend(document.getElementById('marqueeMode'));document.getElementById('marqueeMode').textContent='框选 · F';
  document.getElementById('selectionCount').title='普通点击单选；Ctrl 点击添加或取消；Shift 点击选择连续范围；空白处拖动框选';
  const extra=document.querySelector('.workspace-edit'),more=document.createElement('details');more.id='moreEditTools';more.className='more-edit-tools';more.innerHTML='<summary>更多编辑工具：批量输入 / 分小节 / 区块轨道</summary>';extra.before(more);more.append(extra);
  const root=document.getElementById('contextEditor'),single=document.getElementById('singleEditor'),batch=document.getElementById('batchEditor');
  const title=document.getElementById('title').closest('label');title.classList.add('project-title-field');root.closest('aside').prepend(title);
  root.prepend(batch);root.prepend(single);
  const timing=root.querySelector('.timing-tools'),details=document.createElement('details');details.className='timing-disclosure';details.innerHTML='<summary>时值检查与批量处理</summary>';root.prepend(details);details.append(timing);
  [...timing.querySelectorAll('.hint')].at(-1).textContent='这里只按时长筛选。可连续查找、全选结果后编辑，或主动合并相邻同音短片段；长音可在播放处切开。';
  timing.insertAdjacentHTML('beforeend','<button id="durationSelectAll" class="wide">选择全部符合条件的音符</button><p id="durationMergeSummary" class="hint"></p><button id="durationMergeShort" class="wide">合并相邻同音短片段</button>');
  const insert=root.querySelector('.insert-tool'),insertDetails=document.createElement('details');insertDetails.id='insertDisclosure';insertDetails.className='insert-disclosure';insertDetails.innerHTML='<summary>插入新音符</summary>';insert.before(insertDetails);insertDetails.append(insert);insert.querySelector('strong').hidden=true;
  const clipboard=root.querySelector('.clipboard-tool'),clip=document.createElement('details');clip.className='clipboard-disclosure';clip.innerHTML='<summary>粘贴位置与覆盖方式</summary>';clipboard.before(clip);clip.append(clipboard);
  const global=root.querySelector('.global-pitch'),globalDetails=document.createElement('details');globalDetails.innerHTML='<summary>整体升降音</summary>';global.before(globalDetails);globalDetails.append(global);
  for(const node of [...root.querySelectorAll('.sidebar-divider')])node.remove();
  for(const node of [...root.children])if(node.classList.contains('section-title')||node.tagName==='P')node.hidden=true;
  const batchLink=document.createElement('button');batchLink.id='batchLyrics';batchLink.className='wide';batchLink.textContent='输入 / 批量修改歌词';batch.append(batchLink);
  const noteActions=document.createElement('div');noteActions.className='stepper';noteActions.innerHTML='<button id="noteLyricSave">保存歌词</button><button id="noteLyrics">编辑歌词对应</button>';document.getElementById('noteLyric').closest('label').after(noteActions);document.getElementById('noteLyric').title='回车或点保存；多个音共用同一字词时修改整项文字';
  const panel=document.getElementById('lyricsPanel');panel.querySelector('.panel-title').insertAdjacentHTML('afterend','<div class="lyric-selection-tools"><p id="lyricSelectionStatus" role="status"></p><button id="lyricsChooseNotes">选择对应音符</button><button id="lyricsLinkSelection">关联所选音符</button><p class="hint">先点击一个字词，再点谱面音符；Ctrl点击追加或取消，Shift点击选连续范围。最后点“关联所选音符”。谱面上的绿色边框表示已选中。</p></div>');
  panel.querySelector('.lyric-selection-tools').insertAdjacentHTML('beforeend','<label class="checkbox"><input id="lyricLinkFollowTime" type="checkbox">同时改歌词时间为所选音符起止（可选）</label>');
  const bulk=document.createElement('details');bulk.id='lyricManualTools';bulk.innerHTML='<summary>手工输入 / 批量修改歌词</summary><p id="lyricBatchCount" class="hint"></p><label class="field">填入方式<select id="lyricBatchMode"><option value="per-note">一音一字词（按谱面顺序）</option><option value="shared">所选音符共用一项文字</option></select></label><label class="field">输入文字<textarea id="lyricBatchText" rows="3" placeholder="天 气 很 好；每项用空格或换行分隔"></textarea></label><button id="lyricBatchAssign" class="wide">填入所选音符</button><p class="hint">填入会替换所选音符的既有对应，可一次撤销。空内容可清除所选音符的对应。</p><label class="field">替换范围<select id="lyricReplaceScope"><option value="selected">所选音符对应的文字</option><option value="all">整份歌词</option></select></label><div class="field-row"><label class="field">查找<input id="lyricBatchFind"></label><label class="field">替换为<input id="lyricBatchReplacement"></label></div><button id="lyricBatchReplace" class="wide">批量替换文字</button>';
  panel.querySelector('.lyric-selection-tools').after(bulk);
  const lyricEditor=document.getElementById('lyricEditor');lyricEditor.classList.add('manual-word-editor');bulk.after(lyricEditor);
  const list=document.getElementById('lyricsList');panel.querySelector('.lyric-selection-tools').after(list);
  const inline=document.getElementById('inlineLyricLink');inline.insertAdjacentHTML('beforebegin','<button id="inlineLyricChoose">选择对应音符</button>');
}
