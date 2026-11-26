import {EN_UI,UI_SOURCE} from './locales/en-ui.mjs';
import {JA_TEXT} from './locales/ja-text.mjs';

// Supported interface languages. Adding one means adding a table below plus the
// matching <option> in index.html; tests/i18n.test.mjs pins this list.
export const LANGUAGE_KEY='notemender-ui-language';
export const LANGUAGES=Object.freeze(['zh-CN','en','ja']);
let language='zh-CN';
try{const saved=globalThis.localStorage?.getItem(LANGUAGE_KEY);if(LANGUAGES.includes(saved))language=saved;}catch{}
const listeners=new Set();
export const getLanguage=()=>language;

// Translate one string. Chinese stays the source of truth: English is passed
// explicitly at each call site, while Japanese is resolved from the shared
// Chinese-keyed table, so adding a language does not touch 150+ call sites.
// The optional third argument overrides the table for a specific call.
export const tr=(chinese,english,japanese)=>{
  if(language==='ja')return japanese??JA_TEXT[chinese]??english??chinese;
  return language==='en'?english:chinese;
};

// Declarative [data-i18n] markers use stable hashes of the Chinese text as keys,
// so resolve Japanese through UI_SOURCE first. An untranslated label falls back
// to English rather than Chinese, which stays readable for a Japanese user.
const jaUi=(key,fallback)=>JA_TEXT[UI_SOURCE[key]]??EN_UI[key]??fallback;

export function onLanguageChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
export function setLanguage(value){
  if(!LANGUAGES.includes(value))return false;
  if(value===language)return true;
  language=value;try{globalThis.localStorage?.setItem(LANGUAGE_KEY,value);}catch{}
  for(const listener of [...listeners]){try{listener(value);}catch(error){globalThis.console?.error('Language view refresh failed',error);}}
  return true;
}

// Only explicitly marked interface labels are translated. Project text, lyrics,
// editable field values and API/log content never pass through this binding.
export function installI18n(root=globalThis.document){
  if(!root)return ()=>{};
  const originals=new WeakMap(),selector='[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]';
  function apply(node){
    let original=originals.get(node);if(!original){original={last:{}};originals.set(node,original);}
    for(const attribute of ['text','title','placeholder','aria-label']){
      const marker=attribute==='text'?'data-i18n':`data-i18n-${attribute}`,key=node.getAttribute(marker);
      if(!key)continue;
      const current=attribute==='text'?node.textContent:node.getAttribute(attribute);
      if(!(attribute in original))original[attribute]=current;
      // A renderer may have replaced an initial placeholder with live state.
      // Do not restore that placeholder when the language changes.
      if(attribute in original.last&&current!==original.last[attribute]&&current!==original[attribute])continue;
      const value=language==='en'?(EN_UI[key]??original[attribute])
        :language==='ja'?jaUi(key,original[attribute])
        :original[attribute];
      if(attribute==='text'){if(node.textContent!==value)node.textContent=value;}
      else if(value===null)node.removeAttribute(attribute);else if(node.getAttribute(attribute)!==value)node.setAttribute(attribute,value);
      original.last[attribute]=value;
    }
  }
  function scan(node){if(node.matches?.(selector))apply(node);node.querySelectorAll?.(selector).forEach(apply);}
  function refresh(){if(root.documentElement)root.documentElement.lang=language;scan(root);const select=root.querySelector?.('#uiLanguage');if(select)select.value=language;}
  const select=root.querySelector?.('#uiLanguage'),change=()=>setLanguage(select.value);
  select?.addEventListener('change',change);const unsubscribe=onLanguageChange(refresh);refresh();
  const Observer=globalThis.MutationObserver,observer=Observer?new Observer(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)scan(n);}):null;
  observer?.observe(root.body||root,{childList:true,subtree:true});
  return ()=>{observer?.disconnect();unsubscribe();select?.removeEventListener('change',change);};
}
