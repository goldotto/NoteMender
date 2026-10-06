import test from 'node:test';
import assert from 'node:assert/strict';
import {wordsFromSegments,normalizeLyrics,matchLyrics} from '../public/lyrics.mjs';

test('Qwen Chinese character provenance and missing timings survive the lyric preview',()=>{
  const segments=[{text:'歌声',language:'zh',source:'qwen3-asr',chars:[{char:'歌',start:40.2,end:40.6,source:'qwen3-forced-aligner'},{char:'声',source:'qwen3-forced-aligner'}]}];
  const tokens=normalizeLyrics(wordsFromSegments(segments,'zh'),[]);assert.deepEqual(tokens.map(t=>[t.text,t.start,t.end,t.source]),[['歌',40.2,40.6,'qwen3-forced-aligner'],['声',null,null,'qwen3-forced-aligner']]);assert.ok(tokens.every(t=>!t.reviewed&&t.alignmentScore===undefined));
  const project={bpm:60,offset:40,notes:[{id:'n',midi:60,start:0,duration:1}],lyrics:[]},matched=matchLyrics(project,tokens);assert.deepEqual(matched[0].noteIds,['n']);assert.deepEqual(matched[1].noteIds,[]);
});

test('Qwen language detection works per segment and Cantonese uses character timings',()=>{
  const tokens=wordsFromSegments([{text:'你',language:'yue',source:'qwen3-asr',chars:[{char:'你',start:1,end:2}]},{text:'hello',language:'en',source:'qwen3-asr',words:[{word:'hello',start:2,end:3}]}],'zh');assert.deepEqual(tokens.map(t=>[t.text,t.language,t.source]),[['你','yue','qwen3-asr'],['hello','en','qwen3-asr']]);
  assert.deepEqual(wordsFromSegments([{text:' ',source:'qwen3-asr'}]),[]);
});
