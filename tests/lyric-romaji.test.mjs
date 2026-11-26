import test from 'node:test';
import assert from 'node:assert/strict';
import {japaneseLyricLines} from '../public/lyric-romaji.mjs';

test('Japanese reading groups adjacent tokens and keeps unrelated languages out',()=>{
  const lyrics=[
    {text:'蜘蛛',language:'ja',start:0,end:.5},
    {text:'の',language:'ja',start:.5,end:.7},
    {text:'糸',language:'ja',start:.7,end:1},
    {text:'歌う。',language:'ja',start:2,end:3},
    {text:'中文',language:'zh',start:null,end:null},
    {text:'みんな\nありがとう',language:'auto',start:null,end:null},
    {text:'Hello',language:'en',start:null,end:null}
  ];
  const before=structuredClone(lyrics);
  assert.deepEqual(japaneseLyricLines(lyrics),['蜘蛛の糸','歌う。','みんな','ありがとう']);
  assert.deepEqual(lyrics,before);
});
