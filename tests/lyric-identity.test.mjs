import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLyrics,stableWordsFromSegments} from '../public/lyrics.mjs';
import {makeDemo,validateProject} from '../public/music.mjs';
import {linkRawLyrics,lyricsAfterQuantization} from '../public/lyric-assist.mjs';
const resource='a'.repeat(64);

test('repeated unlocated words in one segment and across vocal sections retain distinct stable IDs',async()=>{
  const first=[{start:1.75,end:22.75,language:'ja',words:[{word:'て'},{word:'も',start:3,end:4}]}];
  const second=[{start:27.25,end:63.25,language:'ja',words:[{word:'て'},{word:'だけ'},{word:'だけ'}]}];
  const a=await stableWordsFromSegments(first,'ja',resource),b=await stableWordsFromSegments(second,'ja',resource);
  assert.equal(new Set([...a,...b].map(w=>w.id)).size,5);
  assert.deepEqual(await stableWordsFromSegments(second,'ja',resource),b);
  const words=normalizeLyrics([...a,...b]);assert.equal(words.length,5);assert.equal(words.filter(w=>w.start===null).length,4);
  // Mirrors candidate assembly after two completed sections and quantization.
  const linked=linkRawLyrics([],words),lyrics=lyricsAfterQuantization(linked,[],[]);
  const project=validateProject({...makeDemo(),lyrics,alternates:[{id:'voice',sectionId:'s',notes:[],lyrics:b}]});
  assert.equal(project.lyrics.length,5);assert.equal(project.alternates[0].lyrics.length,3);
});

test('invalid equal timestamps and repeated Chinese characters do not erase text',async()=>{
  const segments=[{start:0,end:30,language:'zh',chars:[{char:'我',start:2,end:2},{char:'我'},{char:'我',start:5,end:6},{char:'我',start:5,end:6}]}];
  const words=await stableWordsFromSegments(segments,'zh',resource);
  assert.equal(new Set(words.map(w=>w.id)).size,4);assert.equal(normalizeLyrics(words).length,4);
  assert.deepEqual(words.map(w=>w.text),['我','我','我','我']);
  assert.deepEqual(words.slice(0,2).map(w=>w.start),[null,null]);
});

test('untimed responses without segment bounds use the requested range; timed identities remain compatible',async()=>{
  const segments=[{language:'en',words:[{word:'again'},{word:'sing',start:10,end:11}]}];
  const a=await stableWordsFromSegments(segments,'en',resource,{from:0,to:20}),b=await stableWordsFromSegments(segments,'en',resource,{from:20,to:40});
  assert.notEqual(a[0].id,b[0].id);assert.equal(a[1].id,b[1].id);
  assert.throws(()=>normalizeLyrics([a[0],a[0]]),/歌词 ID 重复/);
});
