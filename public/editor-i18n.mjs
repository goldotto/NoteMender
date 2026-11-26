import {bindPanelLanguage} from './panel-i18n.mjs';
import {EN_UI,UI_SOURCE} from './locales/en-ui.mjs';

const EN={...Object.fromEntries(Object.entries(UI_SOURCE).map(([key,value])=>[value,EN_UI[key]])),
  '专业音高选择':'Advanced pitch selection','按当前调号选择此数字，保留当前高低音组':'Choose this degree in the current key, keeping the current octave','选择休止符':'Choose a rest',
  '低一点':'Semitone down','高一点':'Semitone up','低一组':'Octave down','高一组':'Octave up','试听此音':'Preview note','试听当前选择的实际音高，不写入工程':'Preview this pitch without changing the project',
  '音符与歌词一起粘贴':'Paste notes and lyrics together','覆盖目标音符与歌词（可撤销）':'Overwrite target notes and lyrics (undoable)',
  '时值检查与批量处理':'Duration review and batch tools','音符与歌词混合选择':'Mixed note and lyric selection','复制所选':'Copy selection','删除所选':'Delete selection','编辑所选歌词':'Edit selected lyrics',
  '这里只按时长筛选。可连续查找、全选结果后编辑，或主动合并相邻同音短片段；长音可在播放处切开。':'Filter by duration, step through matches or select all matches to edit. You can also merge adjacent short notes of the same pitch, or split a long note at the playhead.',
  '选择全部符合条件的音符':'Select all matching notes','合并相邻同音短片段':'Merge adjacent short notes of the same pitch','插入新音符':'Insert a note','粘贴位置与覆盖方式':'Paste location and overwrite options','整体升降音':'Transpose all notes',
  '输入 / 批量修改歌词':'Enter / batch edit lyrics','保存歌词':'Save lyrics','编辑歌词对应':'Edit lyric associations','回车或点保存；多个音共用同一字词时修改整项文字':'Press Enter or Save. If several notes share a word, the whole word is changed.',
  '选择对应音符':'Select associated notes','关联所选音符':'Associate selected notes','先点击一个字词，再点谱面音符；Ctrl点击追加或取消，Shift点击选连续范围。最后点“关联所选音符”。谱面上的绿色边框表示已选中。':'Select a word, then notes on the score. Ctrl-click toggles notes; Shift-click selects a range. Click “Associate selected notes” to apply. Green outlines mark the selection.',
  '同时改歌词时间为所选音符起止（可选）':'Also match the lyric timing to the selected notes (optional)',
  '手工输入 / 批量修改歌词':'Enter / batch edit lyrics','填入方式':'Assignment mode','一音一字词（按谱面顺序）':'One word per note (score order)','所选音符共用一项文字':'One text item shared by selected notes','输入文字':'Text',
  '天 气 很 好；每项用空格或换行分隔':'one word per item; separate items with spaces or new lines','填入所选音符':'Assign to selected notes','填入会替换所选音符的既有对应，可一次撤销。空内容可清除所选音符的对应。':'Replaces existing associations for the selected notes in one undo step. Empty text clears their associations.',
  '替换范围':'Replacement scope','所选音符对应的文字':'Text associated with selected notes','整份歌词':'All lyrics','查找':'Find','替换为':'Replace with','批量替换文字':'Replace text',
  '连续写音符':'Compose a sequence','先排一串、试听预览，最后一次写入；未写入前不改变谱子。':'Build a sequence, preview it, then insert it in one step. The score stays unchanged until insertion.',
  '从第几拍开始':'Start at beat','取播放位置':'Use playhead','取选中起点':'Use selection start','高低音组':'Octave','低三组':'Three octaves down','低两组':'Two octaves down','低音':'Lower octave','中音':'Middle octave','高音':'Upper octave','高两组':'Two octaves up','高三组':'Three octaves up',
  '升降号':'Accidental','原音':'Natural','升半音 ♯':'Sharp ♯','降半音 ♭':'Flat ♭','持续拍数':'Duration in beats','半拍':'½ beat','1拍':'1 beat','2拍':'2 beats','4拍':'4 beats','待写入音符':'Queued notes','继续添加':'Add more','删除所选项':'Delete item','移除末项':'Remove last','清空队列':'Clear queue',
  '整串试听':'Preview sequence','停止试听':'Stop preview','一次写入':'Insert sequence','休止项在对应范围留空。已有音符需要确认覆盖，不推走后续音符；可一次撤销。':'Rests leave gaps. Overwriting existing notes requires confirmation; later notes are not shifted. The insertion can be undone in one step.',
  '高级：文本输入':'Advanced: text entry','还有未写入的音符':'Uncommitted notes','继续将放弃连续输入队列。已写入的谱子不受影响。':'Continuing discards the queued sequence. Notes already inserted are unaffected.','放弃并继续':'Discard and continue',
  '普通点击单选；Ctrl 点击添加或取消；Shift 点击选择连续范围；开启框选后拖动选择音符与歌词；拖动已选块可整组移动':'Click to select; Ctrl-click toggles; Shift-click selects a range. Enable box selection to select notes and lyrics together. Drag a selected item to move the group.'
};

// Call only while constructing application-authored UI, before project data.
export const bindEditorLanguage=root=>bindPanelLanguage(root,EN);
