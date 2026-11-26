import test from 'node:test';
import assert from 'node:assert/strict';
import {EN_UI} from '../public/locales/en-ui.mjs';

let serial=0;
async function fresh(storage){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
  try{return await import(`../public/i18n.mjs?isolated=${++serial}`);}
  finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
}
function withStorage(storage,fn){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
  try{return fn();}finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
}

test('language preference defaults to Chinese and rejects unknown saved preferences',async()=>{
  assert.equal((await fresh(undefined)).getLanguage(),'zh-CN');
  assert.equal((await fresh({getItem:()=>null})).getLanguage(),'zh-CN');
  assert.equal((await fresh({getItem:()=>'<script>invalid</script>'})).getLanguage(),'zh-CN');
  assert.equal((await fresh({getItem:key=>key==='notemender-ui-language'?'en':null})).getLanguage(),'en');
});

test('unavailable preference storage cannot prevent starting or switching the editor',async()=>{
  const denied={getItem(){throw Error('Storage denied');},setItem(){throw Error('Storage denied');}};
  const locale=await fresh(denied);assert.equal(locale.getLanguage(),'zh-CN');
  withStorage(denied,()=>assert.equal(locale.setLanguage('en'),true));
  assert.equal(locale.getLanguage(),'en');assert.equal(locale.tr('中文','English'),'English');
});

test('language changes validate values, persist locally and notify only subscribed listeners',async()=>{
  const locale=await fresh(undefined),writes=[],events=[];
  const unsubscribe=locale.onLanguageChange(value=>events.push(value));
  withStorage({setItem:(...args)=>writes.push(args)},()=>{
    assert.equal(locale.setLanguage('fr'),false);assert.equal(locale.getLanguage(),'zh-CN');
    assert.equal(locale.setLanguage('en'),true);assert.equal(locale.setLanguage('en'),true);
  });
  assert.deepEqual(writes,[['notemender-ui-language','en']]);assert.deepEqual(events,['en']);
  unsubscribe();locale.setLanguage('zh-CN');assert.deepEqual(events,['en']);
  assert.equal(locale.tr('中文','English'),'中文');
});

class Label {
  constructor(text,attributes={}){this.textContent=text;this.attributes=new Map(Object.entries(attributes));}
  getAttribute(name){return this.attributes.get(name)??null;}
  setAttribute(name,value){this.attributes.set(name,value);}
  removeAttribute(name){this.attributes.delete(name);}
}

test('explicit UI bindings preserve user text, input values, lyric data and missing translations',async()=>{
  const locale=await fresh(undefined),[key,english]=Object.entries(EN_UI)[0];
  const label=new Label('原始界面标签',{'data-i18n':key});
  const input=new Label('',{'data-i18n-placeholder':key,placeholder:'原始提示'});input.value='版本与更新：我自己的工程名';
  const missing=new Label('未翻译的标签',{'data-i18n':'missing.translation'});
  const user=new Label('原始界面标签'),project={title:'原始界面标签',lyrics:[{text:'用户歌词'}]};
  const saved=JSON.stringify(project),listeners=new Map(),picker={value:'zh-CN',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const root={documentElement:{lang:'zh-CN'},querySelectorAll:()=>[label,input,missing],querySelector:selector=>selector==='#uiLanguage'?picker:null};
  const stop=locale.installI18n(root);
  locale.setLanguage('en');assert.equal(label.textContent,english);assert.equal(input.getAttribute('placeholder'),english);
  assert.equal(root.documentElement.lang,'en');assert.equal(picker.value,'en');assert.equal(missing.textContent,'未翻译的标签');
  assert.equal(input.value,'版本与更新：我自己的工程名');assert.equal(user.textContent,'原始界面标签');assert.equal(JSON.stringify(project),saved);
  picker.value='zh-CN';listeners.get('change')();assert.equal(label.textContent,'原始界面标签');assert.equal(input.getAttribute('placeholder'),'原始提示');
  stop();assert.equal(listeners.has('change'),false);locale.setLanguage('en');assert.equal(label.textContent,'原始界面标签');
});

test('trusted skeleton bindings preserve live statuses, input state and unsubscribe correctly',async()=>{
  const {setLanguage}=await import('../public/i18n.mjs');
  const {bindPanelLanguage}=await import('../public/panel-i18n.mjs');
  setLanguage('zh-CN');
  const text={nodeType:3,nodeValue:'版本与更新'},status={nodeType:3,nodeValue:'关闭'};
  const input={nodeType:1,childNodes:[],value:'私人输入',attributes:new Map([['placeholder','已有环境目录']]),hasAttribute(name){return this.attributes.has(name);},getAttribute(name){return this.attributes.get(name);},setAttribute(name,value){this.attributes.set(name,value);}};
  const root={nodeType:1,childNodes:[text,status,input],hasAttribute:()=>false};
  const stop=bindPanelLanguage(root);
  try{
    setLanguage('en');assert.equal(text.nodeValue,'Version and updates');assert.equal(input.value,'私人输入');assert.equal(input.getAttribute('placeholder'),'Existing environment folder');
    status.nodeValue='服务提供的实时错误，不能被旧标签覆盖';
    setLanguage('zh-CN');assert.equal(text.nodeValue,'版本与更新');assert.equal(status.nodeValue,'服务提供的实时错误，不能被旧标签覆盖');assert.equal(input.getAttribute('placeholder'),'已有环境目录');
    stop();setLanguage('en');assert.equal(text.nodeValue,'版本与更新');
  }finally{stop();setLanguage('zh-CN');}
});

test('English feedback headings leave descriptions, steps, error messages and paths intact',async()=>{
  const {setLanguage}=await import('../public/i18n.mjs');
  const {reportText}=await import('../public/diagnostics-ui.mjs');
  const report={reportId:'test',feedback:{description:'版本与更新',steps:'打开“组件管理”',expected:'保留全部歌词'},events:[{time:'t',level:'error',message:'原始错误文本 C:/用户/私人目录'}]};
  setLanguage('en');
  try{const output=reportText(report);assert.match(output,/NoteMender feedback report/);for(const text of [...Object.values(report.feedback),report.events[0].message])assert.ok(output.includes(text));}
  finally{setLanguage('zh-CN');}
});

test('Japanese is a supported language and tr() resolves through the Chinese-keyed table',async()=>{
  const locale=await fresh(undefined);
  const {JA_TEXT}=await import('../public/locales/ja-text.mjs');
  assert.ok(locale.LANGUAGES.includes('ja'));
  const writes=[];
  withStorage({setItem:(...args)=>writes.push(args)},()=>assert.equal(locale.setLanguage('ja'),true));
  assert.equal(locale.getLanguage(),'ja');
  assert.deepEqual(writes,[['notemender-ui-language','ja']]);
  const source=Object.keys(JA_TEXT)[0];
  assert.equal(locale.tr(source,'English placeholder'),JA_TEXT[source]);
  // An explicit third argument wins over the shared table.
  assert.equal(locale.tr(source,'English placeholder','明示的な訳'),'明示的な訳');
  // A string the table does not know falls back to English rather than Chinese.
  assert.equal(locale.tr('表里没有的句子','Fallback'),'Fallback');
  locale.setLanguage('zh-CN');
});

test('Japanese interface bindings translate marked labels and leave user text alone',async()=>{
  const locale=await fresh(undefined);
  const {JA_TEXT}=await import('../public/locales/ja-text.mjs');
  const {UI_SOURCE}=await import('../public/locales/en-ui.mjs');
  const key=Object.keys(UI_SOURCE).find(candidate=>JA_TEXT[UI_SOURCE[candidate]]!==undefined);
  const label=new Label('原始界面标签',{'data-i18n':key});
  const userText=new Label('用户自己的文字');
  const picker={value:'zh-CN',addEventListener(){},removeEventListener(){}};
  const root={documentElement:{lang:'zh-CN'},querySelectorAll:()=>[label,userText],querySelector:selector=>selector==='#uiLanguage'?picker:null};
  const stop=locale.installI18n(root);
  try{
    withStorage({setItem(){}},()=>locale.setLanguage('ja'));
    assert.equal(label.textContent,JA_TEXT[UI_SOURCE[key]]);
    assert.equal(userText.textContent,'用户自己的文字');
    assert.equal(root.documentElement.lang,'ja');
    assert.equal(picker.value,'ja');
  }finally{stop();locale.setLanguage('zh-CN');}
});

test('Japanese panel text uses the shared table and keeps unknown text verbatim',async()=>{
  const {setLanguage}=await import('../public/i18n.mjs');
  const {panelText}=await import('../public/panel-i18n.mjs');
  const {JA_TEXT}=await import('../public/locales/ja-text.mjs');
  setLanguage('ja');
  try{
    const known=Object.keys(JA_TEXT).find(candidate=>/[\u4e00-\u9fff]/.test(candidate));
    assert.equal(panelText(known),JA_TEXT[known]);
    assert.equal(panelText('完全に存在しない画面用語'),'完全に存在しない画面用語');
  }finally{setLanguage('zh-CN');}
});

test('Japanese dynamic app text follows the shared formatters and never emits Chinese commas',async()=>{
  const {setLanguage}=await import('../public/i18n.mjs');
  const {appText}=await import('../public/app-i18n.mjs');
  setLanguage('ja');
  try{
    assert.equal(appText('已选 3 音'),'音符3個を選択');
    assert.equal(appText('插入第 2.5 拍'),'第2.5拍に挿入');
    assert.equal(appText('已导入 我的歌.mp3'),'我的歌.mp3を読み込みました');
    assert.ok(!appText('已选 4 音、2 条歌词').includes('，'));
  }finally{setLanguage('zh-CN');}
});

test('Japanese help text exists for every control id so no help panel goes blank',async()=>{
  const {setLanguage}=await import('../public/i18n.mjs');
  const help=await import('../public/help-content.mjs');
  setLanguage('ja');
  try{
    const missing=Object.keys(help.CONTROL_HELP).filter(id=>!help.localizedControlHelp(id));
    assert.deepEqual(missing,[]);
  }finally{setLanguage('zh-CN');}
});
