import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseNotes,combineSelection,continuousSelection} from '../public/selection.mjs';
import {clockPosition,noteSchedule,validSpeed} from '../public/play-clock.mjs';
import {makeDemo,validateProject,freeScoreSVG} from '../public/music.mjs';
import {mergeSelectedNotes} from '../public/manual-timing.mjs';
import {normalizeLyrics,matchLyrics,lyricLabels,importLyrics,wordsFromSegments,withOrphanLyrics} from '../public/lyrics.mjs';
import {splitNoteAt,copyNotes,pasteNotes} from '../public/note-clipboard.mjs';
import {validateLyricRequest} from '../src/lyrics-service.mjs';
const fixture=()=>validateProject({...makeDemo(),bpm:60,notes:[{id:'a',start:0,duration:1,midi:60},{id:'b',start:1,duration:1,midi:62},{id:'c',start:2,duration:1,midi:64}],lyrics:[{id:'word',text:'唱',start:0,end:2,noteIds:['a','b'],source:'manual',reviewed:true}]});
test('deleting part of a melisma retains its remaining lyric links and timing',()=>{
 const p=fixture(),next=validateProject(withOrphanLyrics(p,{...p,notes:p.notes.filter(n=>n.id!=='a')}));
 assert.deepEqual(next.lyrics[0].noteIds,['b']);assert.equal(next.lyrics[0].text,'唱');assert.equal(next.lyrics[0].end,2);
 const rest=validateProject({...p,notes:p.notes.map(n=>n.id==='a'?{...n,midi:null}:n)});
 assert.deepEqual(rest.lyrics[0].noteIds,['b']);
});
test('Ctrl toggles disjoint notes, Shift selects anchored range, marquee can append and subtract',()=>{
  const notes=fixture().notes;let ids=chooseNotes(notes,[],'a');ids=chooseNotes(notes,ids,'c',{toggle:true});assert.deepEqual([...ids],['a','c']);assert.equal(continuousSelection(notes,ids),false);ids=chooseNotes(notes,ids,'a',{toggle:true});assert.deepEqual([...ids],['c']);assert.deepEqual([...chooseNotes(notes,ids,'a',{range:true,anchor:'c'})],['a','b','c']);assert.deepEqual([...combineSelection(['a'],['c','c'],'add')],['a','c']);assert.deepEqual([...combineSelection(['a','b'],['a'],'subtract')],['b']);
});
test('different pitches require explicit target, merge retains lyrics and refuses skipped notes',()=>{
  const p=fixture();assert.throws(()=>mergeSelectedNotes(p,['a','b']),/音高/);const merged=mergeSelectedNotes(p,['a','b'],{midi:65});assert.equal(merged.project.notes[0].midi,65);assert.equal(merged.project.notes[0].duration,2);assert.deepEqual(merged.project.lyrics[0].noteIds,['a']);assert.throws(()=>mergeSelectedNotes(p,['a','c'],{midi:65,fillGaps:true}),/未选中/);assert.throws(()=>mergeSelectedNotes(p,['a','b'],{midi:109}),/音高/);assert.equal(p.notes.length,3);
});
test('speed clocks stay in audio seconds; all note boundaries use same rate after a restart',()=>{
  for(const speed of [.5,.75,1,1.5]){const clock={position:5,startedAt:10,speed,end:60};assert.equal(clockPosition(clock,40),5+30*speed);const schedule=noteSchedule(10,12,5,60,10,speed);assert.equal(clockPosition(clock,schedule.when),10);assert.equal(schedule.duration,2/speed);const position=clockPosition(clock,15),next={position,startedAt:15,speed:1.2,end:60};assert.equal(clockPosition(next,15),position);}assert.equal(validSpeed(.1),.5);assert.equal(validSpeed(2),1.5);
});
test('lyric mapping respects non-linear audio mapping, melisma, manual words, and missing timings',()=>{
  const p=fixture(),manual=p.lyrics[0];p.lyrics=[];p.notes.forEach(n=>n.lyric='');p.timeAnchors=[{beat:0,second:0},{beat:1,second:2},{beat:3,second:3}];const tokens=[{id:'x',text:'歌',start:0,end:2.5,noteIds:[],reviewed:false},{id:'y',text:'词',start:null,end:null,noteIds:[]}];const mapped=matchLyrics(p,tokens);assert.deepEqual(mapped[0].noteIds,['a','b']);assert.deepEqual(mapped[1].noteIds,[]);assert.equal(lyricLabels({...p,lyrics:mapped}).get('b'),'—');p.notes[0].lyric='手改';assert.ok(!matchLyrics(p,tokens)[0].noteIds.includes('a'));p.lyrics=[manual];assert.deepEqual(matchLyrics(p,[manual])[0].noteIds,['a','b']);assert.deepEqual(matchLyrics(p,tokens)[0].noteIds,[]);
});
test('cut, delete, merge, paste, and JSON round trip keep text without stale audio links',()=>{
  const p=fixture(),cut=splitNoteAt(p,'a',.5);assert.deepEqual(cut.project.lyrics[0].noteIds,['a',cut.id,'b']);const deleted=validateProject({...p,notes:p.notes.filter(n=>n.id!=='a')});assert.equal(deleted.lyrics[0].text,'唱');assert.deepEqual(deleted.lyrics[0].noteIds,['b']);const clipboard=copyNotes(p,['a','b']),pasted=pasteNotes(p,clipboard,4);assert.equal(pasted.project.notes.find(n=>n.start===4).lyric,'唱');assert.equal(pasted.project.lyrics[0].start,0);assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).lyrics,p.lyrics);assert.match(freeScoreSVG(p),/score-lyric/);assert.equal(validateProject(makeDemo()).lyrics,undefined);
});
test('TXT requires a sentence range; LRC preserves time; unaligned characters stay unpositioned',()=>{
  assert.ok(importLyrics('甲\n乙',{end:5}).every(t=>t.start===null));assert.equal(importLyrics('[00:02.00]甲\n[00:03.00]乙',{end:4})[0].end,3);assert.throws(()=>normalizeLyrics([{id:'bad',start:2,end:1,text:'甲'}]),/时间/);const tokens=wordsFromSegments([{text:'甲乙',chars:[{char:'甲',start:0,end:.5},{char:'乙'}]}],'zh');assert.equal(tokens[1].start,null);
});
test('lyric API validates resource, finite range, execution, and text limits',()=>{
  const request={resourceId:'a'.repeat(64),from:0,to:10,language:'zh',device:'cuda',threads:0,text:'歌词'};assert.equal(validateLyricRequest(request).device,'cuda');assert.throws(()=>validateLyricRequest({...request,resourceId:'../x'}),/资源/);assert.throws(()=>validateLyricRequest({...request,to:NaN}),/范围/);assert.throws(()=>validateLyricRequest({...request,to:0}),/结束/);
});
test('alignment with no acoustic support remains unlinked until a person assigns it',()=>{
  const p=fixture();p.lyrics=[];const words=wordsFromSegments([{chars:[{char:'字',start:0,end:1,score:0}]}],'zh');assert.deepEqual(matchLyrics(p,words)[0].noteIds,[]);assert.equal(normalizeLyrics(words,p.notes)[0].alignmentScore,0);
});
test('replacing candidates and deleting legacy notes keeps their words as unlinked text',()=>{
  const p=fixture();p.notes[2].lyric='词';const next=validateProject(withOrphanLyrics(p,{...p,lyrics:undefined,notes:[{id:'new',midi:60,start:0,duration:3}]}));assert.deepEqual(next.lyrics.map(t=>t.text),['唱','词']);assert.ok(next.lyrics.every(t=>t.noteIds.length===0));assert.deepEqual(validateProject(withOrphanLyrics(p,{...p,lyrics:[],notes:p.notes})).lyrics,[]);
});

test('imported sentences require alignment or an explicit manual link instead of spreading to notes',()=>{
  const p=fixture();p.lyrics=[];p.notes.forEach(n=>n.lyric='');const sentence=importLyrics('[00:00.00]唱这首歌',{end:3})[0];assert.deepEqual(matchLyrics(p,[sentence])[0].noteIds,[]);assert.deepEqual(matchLyrics(p,[{...sentence,reviewed:true,noteIds:['a','b']}])[0].noteIds,['a','b']);
});

test('explicit manual lyric links override legacy display while automatic links retain it',()=>{
  const p=fixture();p.notes[0].lyric='旧';assert.equal(lyricLabels(p).get('a'),'唱');p.lyrics[0].reviewed=false;assert.equal(lyricLabels(p).get('a'),'旧');
});

 test('resource-less pending MIDI does not hide the saved project original audio',async()=>{
   const {restorableAudioProject}=await import('../public/candidate-tools.mjs');const project={audioResources:[{source:'original',id:'song'}]},midi={audioResources:[]},audioDraft={audioResources:[{source:'original',id:'new'}]};assert.equal(restorableAudioProject(project,midi),project);assert.equal(restorableAudioProject(project,audioDraft),audioDraft);assert.equal(restorableAudioProject(project,null),project);
 });
