import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {JA_TEXT} from '../public/locales/ja-text.mjs';

// Japanese is resolved from a single table keyed by the original Chinese text, so
// every Chinese string that can reach the interface must have an entry. Without
// this guard a missing entry silently falls back to English and nobody notices
// until a Japanese user opens that panel — that is exactly what happened to the
// editor panel in November 2026.
const read=file=>readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const hasChinese=value=>/[\u4e00-\u9fff]/.test(value);
function unescapeJs(value){return value.replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/\\'/g,"'").replace(/\\"/g,'"').replace(/\\\\/g,'\\').replace(/\\u([0-9a-fA-F]{4})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));}
function dictionaryPairs(source){
  const pairs=[],pattern=/(["'])((?:\\.|(?!\1).)*)\1\s*:\s*(["'])((?:\\.|(?!\3).)*)\3/g;
  let match;
  while((match=pattern.exec(source)))pairs.push([unescapeJs(match[2]),unescapeJs(match[4])]);
  return pairs;
}
function missing(keys){
  return [...new Set(keys)].filter(key=>hasChinese(key)&&JA_TEXT[key]===undefined);
}

test('every dictionary-driven interface string has Japanese text',()=>{
  const enUi=read('locales/en-ui.mjs');
  const uiSource=dictionaryPairs(enUi.slice(enUi.indexOf('export const UI_SOURCE')));
  const html=read('index.html');
  const usedKeys=new Set([...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(match=>match[1]));
  const uiStrings=uiSource.filter(([key])=>usedKeys.has(key)).map(([,value])=>value);

  const panelSource=read('panel-i18n.mjs');
  const panelStrings=dictionaryPairs(panelSource.slice(0,panelSource.indexOf('export function panelText'))).map(([key])=>key);

  // The editor panel keeps its own dictionary; it was the surface that shipped
  // untranslated, so it is asserted explicitly here.
  const editorStrings=dictionaryPairs(read('editor-i18n.mjs')).map(([key])=>key);
  const engravingStrings=dictionaryPairs(read('engraving-i18n.mjs')).map(([key])=>key);

  assert.deepEqual(missing(uiStrings),[],'index.html labels without Japanese');
  assert.deepEqual(missing(panelStrings),[],'PANEL_EN entries without Japanese');
  assert.deepEqual(missing(editorStrings),[],'editor-i18n entries without Japanese');
  assert.deepEqual(missing(engravingStrings),[],'ENGRAVING_EN entries without Japanese');
});

test('every literal passed to tr() and every dynamic app-text key has Japanese text',()=>{
  const keys=[];
  for(const name of readdirSync(new URL('../public/',import.meta.url))){
    if(!name.endsWith('.mjs'))continue;
    const source=read(name);
    for(const match of source.matchAll(/\btr\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3/g)){
      keys.push(unescapeJs(match[2]));
    }
  }
  const app=read('app-i18n.mjs');
  const dictStart=app.indexOf('for(const [source,english] of Object.entries({');
  for(const [key] of dictionaryPairs(app.slice(dictStart,app.indexOf('const patterns=['))))keys.push(key);
  for(const match of app.matchAll(/known\.set\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*,/g))keys.push(unescapeJs(match[2]));

  assert.deepEqual(missing(keys),[],'tr()/appText strings without Japanese');
});

test('Japanese formatters mirror every dynamic English formatter',()=>{
  const app=read('app-i18n.mjs');
  const blockOf=name=>{
    const start=app.indexOf(name);
    return start<0?'':app.slice(start,app.indexOf('\n];',start));
  };
  const englishPatterns=[...blockOf('const patterns=[').matchAll(/\[\s*\/\^/g)].length;
  const japanesePatterns=[...blockOf('const patternsJa=[').matchAll(/\[\s*\/\^/g)].length;
  assert.ok(englishPatterns>0,'English dynamic formatters not found');
  assert.equal(japanesePatterns,englishPatterns,'patternsJa must mirror patterns one to one');
});
