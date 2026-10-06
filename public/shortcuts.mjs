export const SHORTCUTS=[
 ['播放与定位','空格','播放 / 暂停'],['播放与定位','Alt + ← / →','后退 / 前进 3 秒'],['播放与定位','− / =','试听速度减 / 加 0.05 倍'],['播放与定位','R','循环所选音符'],
 ['选择','← / →','选择上一个 / 下一个音符'],['选择','Ctrl + A','全选音符；选中歌词时全选歌词'],['选择','F','开启 / 关闭框选模式'],['选择','Esc','清除选择'],['选择','Ctrl 点击 / Shift 点击','自由多选 / 连续范围（鼠标操作始终可用）'],
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
    action ||= ({f:'marquee',r:'loop',m:'merge',l:'lyricSplit',v:'review',i:'insert',s:event.shiftKey?'splitMiddle':'splitPlayhead'})[lower]||null;
  }
  if(event.repeat&&!['previous','next','up','down','upOctave','downOctave','shorter','longer','backThree','forwardThree'].includes(action))return null;
  return action;
}
