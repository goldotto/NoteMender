import {getLanguage} from './i18n.mjs';
export const SHORTCUTS=[
 ['播放与定位','空格','播放 / 暂停'],['播放与定位','Alt + ← / →','后退 / 前进 3 秒'],['播放与定位','− / =','试听速度减 / 加 0.05 倍'],['播放与定位','R','循环所选音符'],['播放与定位','B','标记当前播放位置'],
 ['选择','F','开启 / 关闭框选'],['选择','← / →','选择上一个 / 下一个音符'],['选择','Ctrl + A','全选音符；选中歌词时全选歌词'],['选择','Esc','清除选择'],['选择','Ctrl 点击 / Shift 点击','自由多选 / 连续范围（鼠标操作始终可用）'],
 ['修改音符','↑ / ↓','所选音符升 / 降半音'],['修改音符','Shift + ↑ / ↓','所选音符升 / 降八度'],['修改音符','[ / ]','单音时长减 / 加 1/16 拍'],['修改音符','S','在播放位置切开音符'],['修改音符','Shift + S','在所选单音中点切开'],['修改音符','M','合并所选；单音合并后音'],['修改音符','L','按歌词切分所选长音'],['修改音符','V','所选音符标为已校对'],['修改音符','I','打开插入音符工具'],
 ['通用编辑','Ctrl + C / X / V','复制 / 剪切 / 粘贴音符或歌词'],['通用编辑','Delete','删除所选音符或歌词'],['通用编辑','Ctrl + Z','撤销'],['通用编辑','Ctrl + Y / Ctrl + Shift + Z','重做'],['通用编辑','Ctrl + S','保存工程并自定义名称'],
 ['设置','?（Shift + /）','打开快捷键面板'],['设置','Ctrl + Alt + K','开启 / 关闭快捷键（关闭后仍可用）']
];
export function shortcutAction(event,{enabled=true,editing=false,dialog=false,busy=false}={}){
  if(event.isComposing||event.keyCode===229)return null;
  const key=String(event.key||''),lower=key.toLowerCase(),ctrl=event.ctrlKey||event.metaKey;
  if(ctrl&&event.altKey&&lower==='k')return event.repeat?null:'toggle';
  if(!enabled||editing||dialog||busy||event.defaultPrevented)return null;
  let action=null;
  if(ctrl&&!event.altKey){
    action=event.shiftKey?null:({a:'selectAll',c:'copy',x:'cut',v:'paste',y:'redo',s:'save'})[lower]||null;
    if(lower==='z')action=event.shiftKey?'redo':'undo';
  }else if(event.altKey&&!ctrl){
    action=key==='ArrowLeft'?'backThree':key==='ArrowRight'?'forwardThree':null;
  }else if(!ctrl&&!event.altKey){
    action=({ArrowLeft:'previous',ArrowRight:'next',Escape:'clear',Delete:'delete','[':'shorter',']':'longer','-':'slower','=':'faster','?':'help',' ':'play'})[key]||null;
    if(event.code==='Space')action='play';
    if(key==='ArrowUp')action=event.shiftKey?'upOctave':'up';
    if(key==='ArrowDown')action=event.shiftKey?'downOctave':'down';
    action ||= ({f:'marquee',b:'marker',r:'loop',m:'merge',l:'lyricSplit',v:'review',i:'insert',s:event.shiftKey?'splitMiddle':'splitPlayhead'})[lower]||null;
  }
  if(event.repeat&&!['previous','next','up','down','upOctave','downOctave','shorter','longer','backThree','forwardThree'].includes(action))return null;
  return action;
}

const EN_SHORTCUTS=[
  [
    "Playback and navigation",
    "Space",
    "Play / pause"
  ],
  [
    "Playback and navigation",
    "Alt + Left / Right",
    "Back / forward 3 seconds"
  ],
  [
    "Playback and navigation",
    "- / =",
    "Decrease / increase playback speed by 0.05x"
  ],
  [
    "Playback and navigation",
    "R",
    "Loop selected notes"
  ],
  ["Playback and navigation","B","Mark the current playback position"],
  [
    "Selection",
    "F",
    "Toggle box selection"
  ],
  [
    "Selection",
    "Left / Right",
    "Select previous / next note"
  ],
  [
    "Selection",
    "Ctrl + A",
    "Select all notes, or all lyrics when lyrics are selected"
  ],
  [
    "Selection",
    "Esc",
    "Clear selection"
  ],
  [
    "Selection",
    "Ctrl-click / Shift-click",
    "Toggle individual items / select a range (mouse controls always available)"
  ],
  [
    "Note editing",
    "Up / Down",
    "Raise / lower selected pitches by a semitone"
  ],
  [
    "Note editing",
    "Shift + Up / Down",
    "Raise / lower selected pitches by an octave"
  ],
  [
    "Note editing",
    "[ / ]",
    "Shorten / lengthen one note by 1/16 beat"
  ],
  [
    "Note editing",
    "S",
    "Split a note at the playhead"
  ],
  [
    "Note editing",
    "Shift + S",
    "Split one selected note at its midpoint"
  ],
  [
    "Note editing",
    "M",
    "Merge selection, or merge one note with the next"
  ],
  [
    "Note editing",
    "L",
    "Split selected sustained notes using lyric timings"
  ],
  [
    "Note editing",
    "V",
    "Mark selected notes reviewed"
  ],
  [
    "Note editing",
    "I",
    "Open note insertion"
  ],
  [
    "General editing",
    "Ctrl + C / X / V",
    "Copy / cut / paste notes or lyrics"
  ],
  [
    "General editing",
    "Delete",
    "Delete selected notes or lyrics"
  ],
  [
    "General editing",
    "Ctrl + Z",
    "Undo"
  ],
  [
    "General editing",
    "Ctrl + Y / Ctrl + Shift + Z",
    "Redo"
  ],
  [
    "General editing",
    "Ctrl + S",
    "Save project with a chosen filename"
  ],
  [
    "Settings",
    "? (Shift + /)",
    "Open shortcut panel"
  ],
  [
    "Settings",
    "Ctrl + Alt + K",
    "Toggle shortcuts (also works while shortcuts are disabled)"
  ]
];
// Japanese shortcut list. Order and key column must stay in step with SHORTCUTS.
const JA_SHORTCUTS=[
  ['再生と位置指定','スペース','再生／一時停止'],
  ['再生と位置指定','Alt + ← / →','3秒戻る／3秒進む'],
  ['再生と位置指定','− / =','試聴速度を0.05倍ずつ減／増'],
  ['再生と位置指定','R','選択した音符をループ再生'],
  ['再生と位置指定','B','現在の再生位置にマーカーを追加'],
  ['選択','F','範囲選択のオン／オフ'],
  ['選択','← / →','前／次の音符を選択'],
  ['選択','Ctrl + A','音符を全選択。歌詞を選択中は歌詞を全選択'],
  ['選択','Esc','選択を解除'],
  ['選択','Ctrl クリック / Shift クリック','自由に複数選択／連続範囲（マウス操作は常に有効）'],
  ['音符の編集','↑ / ↓','選択した音符を半音上げ／下げ'],
  ['音符の編集','Shift + ↑ / ↓','選択した音符をオクターブ上げ／下げ'],
  ['音符の編集','[ / ]','音の長さを1/16拍ずつ減／増'],
  ['音符の編集','S','再生位置で音符を分割'],
  ['音符の編集','Shift + S','選択した音の中央で分割'],
  ['音符の編集','M','選択範囲を結合。単音は後ろの音と結合'],
  ['音符の編集','L','歌詞に合わせて選択した長い音を分割'],
  ['音符の編集','V','選択した音符を校正済みにする'],
  ['音符の編集','I','音符の挿入ツールを開く'],
  ['共通編集','Ctrl + C / X / V','音符または歌詞をコピー／切り取り／貼り付け'],
  ['共通編集','Delete','選択した音符または歌詞を削除'],
  ['共通編集','Ctrl + Z','元に戻す'],
  ['共通編集','Ctrl + Y / Ctrl + Shift + Z','やり直す'],
  ['共通編集','Ctrl + S','プロジェクトを保存し、名前を指定'],
  ['設定','?（Shift + /）','ショートカット一覧を開く'],
  ['設定','Ctrl + Alt + K','ショートカットのオン／オフ（オフでも再度有効にできます）']
];
export function localizedShortcuts(){
  const current=getLanguage();
  if(current==='ja')return JA_SHORTCUTS;
  return current==='en'?EN_SHORTCUTS:SHORTCUTS;
}

const BUTTON_SHORTCUTS={
  play:['Space'],backThree:['Alt+ArrowLeft'],forwardThree:['Alt+ArrowRight'],
  addWorkspaceMarker:['B'],loopSelection:['R'],marqueeMode:['F'],clearSelection:['Escape'],
  toolbarCopy:['Mod+C'],toolbarCut:['Mod+X'],toolbarPaste:['Mod+V'],
  toolbarDelete:['Delete'],toolbarSplit:['S'],toolbarMerge:['M'],toolbarLyricSplit:['L'],
  undo:['Mod+Z'],redo:['Mod+Y','Mod+Shift+Z'],saveProject:['Mod+S'],shortcutsBtn:['?'],
  prevNote:['ArrowLeft'],nextNote:['ArrowRight'],pitchDown:['ArrowDown'],pitchUp:['ArrowUp'],
  durationDown:['['],durationUp:[']'],splitNote:['Shift+S'],
  markReviewed:['V'],batchReviewed:['V']
};

export function setShortcutCaption(button,text){
  button.querySelector('.shortcut-caption').textContent=text;
}

export function installShortcutHints(document){
  const mac=/Mac|iPhone|iPad/.test(navigator.userAgentData?.platform||navigator.platform||'');
  const modifier=mac?'Meta':'Control';
  const glyphs={Mod:mac?'⌘':'Ctrl',Alt:mac?'⌥':'Alt',Shift:mac?'⇧':'Shift',ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',Escape:'Esc'};
  const bindings=Object.entries(BUTTON_SHORTCUTS).map(([id,keys])=>{
    const button=document.getElementById(id),caption=document.createElement('span'),hint=document.createElement('kbd');
    caption.className='shortcut-caption';
    caption.append(...button.childNodes);
    if(button.dataset.i18n){
      caption.dataset.i18n=button.dataset.i18n;
      delete button.dataset.i18n;
    }
    hint.className='button-shortcut';
    hint.setAttribute('aria-hidden','true');
    button.classList.add('has-shortcut');
    button.append(caption,hint);
    return {button,keys,hint};
  });
  return enabled=>{
    glyphs.Space={ja:'スペース','zh-CN':'空格'}[getLanguage()]||'Space';
    for(const {button,keys,hint} of bindings){
      hint.textContent=keys.map(key=>key.split('+').map(part=>glyphs[part]||part).join(mac?'':'+')).join(' / ');
      hint.hidden=!enabled;
      if(enabled&&!button.classList.contains('shortcut-inapplicable'))button.setAttribute('aria-keyshortcuts',keys.map(key=>key.replace(/^Mod/,modifier)).join(' '));
      else button.removeAttribute('aria-keyshortcuts');
    }
  };
}

export function keepNativeClipboard(action,{textSelected,scoreContext,scoreSelected,canDispatch}){
  return textSelected||!scoreContext||!canDispatch||(action!=='paste'&&!scoreSelected);
}
