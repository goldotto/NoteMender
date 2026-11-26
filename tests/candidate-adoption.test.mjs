import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {adoptCandidate} from '../public/candidate-adoption.mjs';
import {draftScoreWindow} from '../public/draft-preview.mjs';
import {muscriptorCandidates} from '../public/muscriptor-candidates.mjs';
import {timeAtBeat} from '../public/time-map.mjs';
import {projectText,parseProjectText} from '../public/project-file.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const note=(id,start,duration=1,midi=60)=>({id,start,duration,midi,reviewStatus:'reviewed'});
const section={id:'all',audioStart:0,audioEnd:240,name:'全曲',kind:'other',source:'original'};
const make=notes=>validateProject({...makeDemo(),title:'已有人工谱',bpm:60,key:0,notes,timeAnchors:[{beat:0,second:0},{beat:240,second:240}],sections:[section],lyrics:[]});
function draft(notes){return validateProject({...make(notes),title:'候选',alternates:[{id:'voice',sectionId:'all',method:'人声',primary:true,notes}]});}

test('MuScriptor sparse voice over a whole-song section cannot erase the rest of the workspace',()=>{
  const current=make([note('intro',2),note('old-voice',40),note('later',130),note('outro',230)]);
  const raw={duration:240,analysisId:'a'.repeat(64),notes:[{start:35,end:36,midi:65,instrument:'voice'},{start:94,end:95,midi:67,instrument:'voice'},{start:160,end:161,midi:72,instrument:'electric_bass'}]};
  const {variants}=muscriptorCandidates(raw,current,0,'all');
  const source=validateProject({...draft(variants[0].notes),alternates:variants}),before=structuredClone(current);
  const result=adoptCandidate(current,source,[section]);
  assert.deepEqual(result.ranges.map(r=>[r.from,r.to]),[[35,95]]);
  for(const id of ['intro','later','outro'])assert.deepEqual(result.project.notes.find(n=>n.id===id),current.notes.find(n=>n.id===id));
  assert.equal(result.project.notes.some(n=>n.id==='old-voice'),false);
  assert.equal(result.added,2);assert.equal(result.replaced,1);
  assert.equal(result.project.alternates.length,variants.length);
  assert.deepEqual(current,before);assert.equal(result.project.title,current.title);
  assert.deepEqual(parseProjectText(projectText(result.project)),result.project);
});

for(const engine of ['Basic Pitch','Pitchy','ROSVOT','歌词辅助','MIDI'])test(`${engine}: full candidate, not the visible slice, is adopted while outside edits survive`,()=>{
  const current=make([note('before',1),note('inside',25),note('after',220)]),source=draft([note('a',20),note('b',80),note('c',180)]);
  source.engine=engine;const before=structuredClone(source);
  const window=draftScoreWindow(source,70,90,'试听');assert.equal(window.notes.length,1);
  const result=adoptCandidate(current,source,[section]);
  assert.equal(result.added,3);assert.deepEqual(result.project.notes.map(n=>n.midi),[60,60,60,60,60]);
  assert.ok(result.project.notes.some(n=>n.id==='before'));assert.ok(result.project.notes.some(n=>n.id==='after'));
  assert.deepEqual(source,before);assert.throws(()=>adoptCandidate(current,window,[section]),/试听切片/);
});

test('multiple candidate sections preserve the gap and changes made after candidate generation',()=>{
  const current=make([note('lead',0),note('middle-latest',50,1,75),note('tail',200)]),source=draft([note('a',10),note('b',100)]);
  const sections=[{...section,id:'first',audioEnd:20},{...section,id:'second',audioStart:90,audioEnd:120}];
  const result=adoptCandidate(current,source,sections).project;
  assert.deepEqual(result.notes.find(n=>n.id==='middle-latest'),current.notes.find(n=>n.id==='middle-latest'));
  assert.ok(result.notes.some(n=>n.id==='tail'));assert.equal(result.notes.length,5);
});

test('cross-boundary sustained notes retain both outside fragments and lyric text',()=>{
  const current=make([note('held',0,100)]);current.lyrics=[{id:'text',text:'保留文字',start:0,end:100,noteIds:['held'],reviewed:true,source:'manual'}];
  const result=adoptCandidate(current,draft([note('new',35,60,65)]),[section]).project;
  assert.deepEqual(result.notes.map(n=>[n.start,n.duration]),[[0,35],[35,60],[95,5]]);
  assert.equal(result.lyrics[0].text,'保留文字');assert.equal(result.lyrics[0].noteIds.length,2);
});

test('existing time map and section-external lyrics survive; candidate aligns by original seconds',()=>{
  const current=make([note('before',2),note('after',210)]);current.timeAnchors=[{beat:0,second:0},{beat:120,second:60},{beat:240,second:240}];
  current.lyrics=[{id:'text',text:'未校准也保留',start:20,end:21,noteIds:[],reviewed:false,source:'asr'}];
  const source=draft([note('new',20,2)]),result=adoptCandidate(current,source,[section]).project;
  assert.deepEqual(result.timeAnchors,current.timeAnchors);
  const added=result.notes.find(n=>n.id!=='before'&&n.id!=='after');assert.equal(timeAtBeat(result,added.start),20);
  assert.equal(result.lyrics[0].text,'未校准也保留');
});

test('empty default candidate refuses deletion; explicit section/whole and new-song modes remain available',()=>{
  const current=make([note('before',1),note('after',220)]),source=draft([]);
  assert.throws(()=>adoptCandidate(current,source,[section]),/没有音符/);
  assert.equal(adoptCandidate(current,source,[section],{mode:'sections'}).project.notes.length,0);
  assert.equal(adoptCandidate(current,source,[section],{mode:'whole'}).project.notes.length,0);
  assert.deepEqual(adoptCandidate(current,source,[section],{newSong:true}).project,source);
});

test('partial section mode clears only the chosen section, not later sections',()=>{
  const current=make([note('before',1),note('old',30),note('after',220)]),source=draft([note('new',40)]);
  const result=adoptCandidate(current,source,[{...section,audioStart:20,audioEnd:60}],{mode:'sections'});
  assert.equal(result.replaced,1);assert.equal(result.project.notes.length,3);assert.ok(result.project.notes.some(n=>n.id==='after'));
});

// Exercise the real button handler, including the asynchronous backup gate.
async function handlerHarness({approve=true,backup=async()=>{}}={}){
  const code=await readFile(new URL('../public/app.mjs',import.meta.url),'utf8');
  const begin=code.indexOf('let adoptingDraft=false;'),end=code.indexOf('\nfunction draftPosition()',begin);
  const current=make([note('keep',1),note('old',50),note('tail',230)]),candidate=draft([note('new',40),note('new2',80)]);
  let closeListener;const controls={applyLocalDraft:{disabled:false},localDraftDialog:{returnValue:'',close(reason){this.returnValue=reason;state.closed=reason;closeListener?.();},addEventListener(event,fn){if(event==='close')closeListener=fn;}}};
  const state={project:current,localDraft:candidate,localDraftSections:[section],selectedDraftVariants:new Map(),localDraftVariants:[],draftCacheProbe:null,draftNewSong:false,draftShouldPersist:true,job:null,lyricsTask:null,
    $:id=>controls[id],on:(id,event,callback)=>{state.handler=()=>callback({preventDefault(){state.prevented=true;}});},confirmEntryDiscard:async()=>approve,adoptCandidate,confirm:()=>{throw Error('采用不应再询问覆盖范围');},timeText:String,backupProject:()=>backup(state),stopDraftPlayback(){},clearPendingDraft(){state.cleared=true;},updatePendingDraftBar(){},render(){},toast:message=>state.messages.push(message),messages:[],commit:(p,options)=>{state.project=p;state.commitOptions=options;state.commits++;},commits:0};
  const context=vm.createContext(state);vm.runInContext(code.slice(begin,end),context);const close=code.split('\n').find(line=>line.startsWith("$('localDraftDialog').addEventListener('close'"));vm.runInContext(close,context);return {state,controls,current,candidate,closeAgain:()=>closeListener?.()};
}
test('actual apply directly replaces workspace with complete candidate and backs up once',async()=>{
  let backups=0;const {state,candidate,closeAgain}=await handlerHarness({backup:async state=>{backups++;assert.equal(state.commits,0);assert.ok(state.project.notes.some(n=>n.id==='tail'));}});await state.handler();closeAgain();
  assert.equal(backups,1);assert.equal(state.commits,1);assert.deepEqual(state.project,candidate);assert.equal(state.project.notes.some(n=>n.id==='tail'),false);assert.equal(state.cleared,true);assert.equal(state.localDraft,null);assert.equal(state.draftShouldPersist,false);assert.equal(state.commitOptions.resetLyrics,true);assert.equal(state.prevented,true);assert.equal(state.closed,'adopted');assert.ok(!state.messages.some(m=>m.includes('已收起')));
});

test('actual apply adopts candidate time map, lyrics and all notes despite incompatible old mapping',async()=>{
  const {state,candidate}=await handlerHarness();state.project.timeAnchors=[{beat:0,second:0},{beat:240,second:24000}];
  candidate.lyrics=[{id:'new-lyric',text:'新词',start:40,end:41,noteIds:['new'],reviewed:false,source:'manual',language:'zh'}];
  state.project.lyrics=[{id:'old-lyric',text:'旧词',start:1,end:2,noteIds:['keep'],reviewed:true,source:'manual'}];
  assert.throws(()=>adoptCandidate(state.project,candidate,[section]),/时间映射不兼容/);
  await state.handler();assert.deepEqual(state.project,candidate);assert.equal(state.project.notes.length,2);assert.equal(timeAtBeat(state.project,state.project.notes[0].start),40);assert.equal(state.commitOptions.resetLyrics,true);
});

test('actual close still reports a manual hide when candidate remains unapplied',async()=>{
  const {state,closeAgain}=await handlerHarness();closeAgain();assert.ok(state.messages.some(m=>m.includes('候选已收起')));assert.equal(state.commits,0);assert.ok(state.localDraft);
});

test('cancel or backup failure keeps workspace and pending candidate untouched',async()=>{
  for(const setup of [{approve:false},{backup:async()=>{throw Error('磁盘写入失败');}}]){
    const {state,controls,current,candidate}=await handlerHarness(setup);
    if(setup.approve===false)await state.handler();else await assert.rejects(state.handler(),/磁盘写入失败/);
    assert.equal(state.project,current);assert.equal(state.localDraft,candidate);assert.equal(state.commits,0);assert.equal(state.cleared,undefined);assert.equal(controls.applyLocalDraft.disabled,false);
  }
});
test('backup-time edits block a stale commit; repeated clicks cannot apply twice',async()=>{
  const changed=await handlerHarness({backup:async state=>{state.project=make([note('latest',200)]);}});
  await assert.rejects(changed.state.handler(),/已改变/);assert.equal(changed.state.commits,0);
  let release;const gate=new Promise(resolve=>{release=resolve;});const {state,controls}=await handlerHarness({backup:()=>gate});
  const applying=state.handler();await new Promise(resolve=>setImmediate(resolve));controls.applyLocalDraft.disabled=false;await state.handler();release();await applying;
  assert.equal(state.commits,1);
});
