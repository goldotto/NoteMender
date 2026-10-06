import test from 'node:test';
import assert from 'node:assert/strict';
import {alignmentLanguage,textLanguage} from '../public/lyric-language.mjs';
import {validateLyricRequest} from '../src/lyrics-service.mjs';
import {assignNoteLyrics} from '../public/manual-lyrics.mjs';

test('Japanese and Korean overrides survive the API and selected-token realignment',()=>{
  for(const language of ['en','ja','ko']) {
    const request=validateLyricRequest({resourceId:'a'.repeat(64),from:0,to:3,language});
    assert.equal(request.language,language);
    assert.equal(alignmentLanguage('auto',{language}),language);
  }
  assert.equal(alignmentLanguage('en',{language:'ja'}),'en');
  assert.equal(alignmentLanguage('auto',{language:'auto'}),'auto');
});
test('manual text keeps language; Japanese Han is not split as Chinese characters',()=>{
  assert.equal(textLanguage('こころ'),'ja');assert.equal(textLanguage('노래'),'ko');
  assert.equal(textLanguage('心','auto',[{language:'ja'}]),'ja');
  assert.equal(textLanguage('song','auto',[{language:'zh'}]),'en');
  assert.equal(textLanguage('歌词','auto',[{language:'en'}]),'zh');
  const notes=[{id:'a',start:0,duration:1,midi:60},{id:'b',start:1,duration:1,midi:62}];
  const project={bpm:120,offset:0,notes};
  const japanese=assignNoteLyrics(project,['a','b'],'心 歌',{language:'ja'});
  assert.deepEqual(japanese.lyrics.map(t=>t.language),['ja','ja']);
  const korean=assignNoteLyrics(project,['a','b'],'노래',{mode:'shared',language:'ko'});
  assert.equal(korean.lyrics[0].language,'ko');
  assert.equal(korean.lyrics[0].text,'노래');
  const chinese=assignNoteLyrics(project,['a','b'],'歌词');
  assert.deepEqual(chinese.lyrics.map(t=>t.text),['歌','词']);
});
