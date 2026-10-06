import test from 'node:test';
import assert from 'node:assert/strict';
import {assistNoteBoundaries,linkRawLyrics,lyricsAfterQuantization,lyricPhrase,splitLyricWord,mergeLyricWords} from '../public/lyric-assist.mjs';
import {quantizeNotes,makeDemo,validateProject} from '../public/music.mjs';
import {quantizeTimed,timeAtBeat} from '../public/time-map.mjs';
import {replaceSectionCandidate} from '../public/local-candidates.mjs';
import {preservePrimary} from '../public/candidate-tools.mjs';
import {draftScoreWindow} from '../public/draft-preview.mjs';
const word=(id,start,end,text=id)=>({id,start,end,text,noteIds:[],language:'zh',source:'qwen3-forced-aligner',reviewed:false});
const event=(id,start,end,midi=60)=>({evidenceId:id,start,end,midi,confidence:.8});

test('lyrics split repeated same pitch only with an independent acoustic attack',()=>{
 const raw=[event('held',0,2)],words=[word('a',0,1),word('b',1,2)];
 const unsupported=assistNoteBoundaries(raw,words,{proposals:[{start:1,end:2,midi:60,confidence:1}]});assert.equal(unsupported.events.length,1);assert.equal(unsupported.changed,false);assert.deepEqual(unsupported.lyrics.map(t=>t.evidenceIds),[['held'],['held']]);
 const supported=assistNoteBoundaries(raw,words,{onsets:[{second:1.03,confidence:.9}]});assert.equal(supported.events.length,2);assert.equal(supported.events[1].start,1.03);assert.ok(supported.events.every(n=>n.midi===60));assert.equal(supported.changed,true);assert.equal(raw[0].end,2);
});
test('melisma is retained; a text gap or invalid timestamp cannot invent notes',()=>{
 const raw=[event('a',0,.5,60),event('b',.5,1,62),event('c',1,1.5,64)],words=[word('sing',0,1.5,'唱'),word('silence',2,3),word('bad',1,1)];
 const result=assistNoteBoundaries(raw,words);assert.deepEqual(result.events.map(n=>n.midi),[60,62,64]);assert.deepEqual(result.lyrics.find(t=>t.id==='sing').evidenceIds,['a','b','c']);assert.deepEqual(result.lyrics.find(t=>t.id==='silence').evidenceIds,[]);assert.match(result.lyrics.find(t=>t.id==='bad').alignmentIssue,/无效|重叠/);
});
test('a word ending does not shorten a held note without a sustained acoustic pause',()=>{
 const words=[word('a',0,1)],raw=[event('held',0,2)],frames=Array.from({length:130},(_,i)=>({second:.9+i*.01,voiced:i<10,rms:i<10?.06:.001}));
 assert.equal(assistNoteBoundaries(raw,words).events[0].end,2);const result=assistNoteBoundaries(raw,words,{pitchFrames:frames});assert.equal(result.changed,true);assert.ok(Math.abs(result.events[0].end-1)<1e-6);assert.equal(result.events[0].lyricBoundary,true);
});
test('quantization transports evidence links under nonlinear alignment instead of guessing by overlap',()=>{
 const p={...makeDemo(),notes:[],bpm:60,timeAnchors:[{beat:0,second:10},{beat:2,second:11},{beat:4,second:13}]},raw=[event('a',10.1,10.5),event('b',10.5,10.9,62)],words=[word('w',10.1,10.9,'啊')],trace=[];
 const notes=quantizeNotes(quantizeTimed(raw,p,.0625),60,0,.0625,trace),mapped=lyricsAfterQuantization(linkRawLyrics(raw,words),trace,notes);
 assert.deepEqual(mapped[0].noteIds,notes.map(n=>n.id));assert.equal(mapped[0].start,10.1);const removed=lyricsAfterQuantization(mapped,trace,[notes[1]]);assert.deepEqual(removed[0].noteIds,[notes[1].id]);
});
test('overlapping or unsupported text stays unassociated and weak onsets do not fragment vibrato',()=>{
 const result=assistNoteBoundaries([event('n',0,2)],[word('a',0,1.4),word('bad',1,2)],{onsets:Array.from({length:10},(_,i)=>({second:i*.2,confidence:.2}))});assert.equal(result.events.length,1);assert.deepEqual(result.lyrics.find(t=>t.id==='bad').evidenceIds,[]);
});
test('candidate switching remaps its own lyric IDs, protects human text and round trips independently',()=>{
 const p=validateProject({...makeDemo(),bpm:60,notes:[{id:'old',start:0,duration:2,midi:60},{id:'outside',start:3,duration:1,midi:64}],sections:[{id:'voice',audioStart:0,audioEnd:2,source:'vocals'}],lyrics:[{...word('manual',0,1,'手改'),reviewed:true,noteIds:['old']}]});
 const candidate={id:'candidate',sectionId:'voice',source:'vocals',method:'字词候选',notes:[{id:'new-a',start:0,duration:1,midi:60},{id:'new-b',start:1,duration:1,midi:62}],lyrics:[{...word('manual',0,1,'手改'),reviewed:true,noteIds:['new-a']},{...word('auto',1,2,'唱'),noteIds:['new-b']}]};
 const saved=validateProject({...p,alternates:[candidate]}),restored=validateProject(JSON.parse(JSON.stringify(saved)));assert.deepEqual(restored.alternates[0].lyrics,candidate.lyrics.map(t=>({...t})));assert.equal(restored.alternates[0].notes[0].id,'new-a');
 const switched=replaceSectionCandidate(saved,{start:0,end:2},saved.alternates[0]);assert.equal(switched.notes.find(n=>n.id==='outside').start,3);assert.equal(switched.lyrics.find(t=>t.id==='manual').text,'手改');assert.deepEqual(switched.lyrics.find(t=>t.id==='manual').noteIds,[switched.notes[0].id]);assert.deepEqual(switched.lyrics.find(t=>t.id==='auto').noteIds,[switched.notes[1].id]);assert.equal(p.notes.length,2);
 const primary=preservePrimary(switched,switched.sections,[])[0];assert.equal(primary.lyrics.length,2);const preview=draftScoreWindow(switched,0,2,'候选');assert.equal(preview.lyrics.length,2);assert.equal(timeAtBeat(preview,preview.notes[0].start),0);
});
test('phrase edits stay local and language-aware',()=>{
 const tokens=[word('a',0,1,'hello'),word('b',1,2,'world'),word('c',3,4,'next')].map(t=>({...t,language:'en'}));const phrase=lyricPhrase(tokens,tokens[1]);assert.equal(phrase.text,'hello world');assert.equal(phrase.to,2);assert.deepEqual(phrase.tokens.map(t=>t.id),['a','b']);assert.equal(lyricPhrase(tokens,{...tokens[1],source:'txt'}).text,'world');
});

test('manual word splitting and merging keep text and timing without changing notes',()=>{
 const raw=[event('n1',0,1),event('n2',1,2,62)],tokens=[{...word('a',0,2,'hello world'),language:'en',noteIds:['n1','n2']}];
 const parts=splitLyricWord(tokens,'a',{at:1,left:'hello',right:'world'},raw);assert.deepEqual(parts.map(t=>t.text),['hello','world']);assert.deepEqual(parts.map(t=>t.noteIds),[['n1'],['n2']]);assert.ok(parts.every(t=>t.reviewed));assert.equal(tokens.length,1);const merged=mergeLyricWords(parts,'a');assert.equal(merged[0].text,'hello world');assert.deepEqual(merged[0].noteIds,['n1','n2']);assert.equal(merged[0].end,2);assert.throws(()=>splitLyricWord(tokens,'a',{at:0,left:'a',right:'b'},raw),/拆分/);
});
