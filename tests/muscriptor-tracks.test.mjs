import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EDIT_STEP,uid,validateProject} from '../public/music.mjs';
import {sectionBeats,sectionSeconds} from '../public/sections.mjs';
import {replaceSectionCandidate} from '../public/local-candidates.mjs';
import {MU_TRACK_MODEL,audibleMuTracks,isMuTrackCandidate,muTrackAnalyses,muTrackWindow,muRollEditKey,applyMuRollEdits,normalizeMuRollEdits,scoreMuInstrument} from '../public/muscriptor-tracks.mjs';
import {visibleCandidates} from '../public/candidate-menu.mjs';
import {scheduleMuMidi} from '../public/muscriptor-track-audio.mjs';
import {muDuplicateIds,muMoveNotes,muVocalSuggestions} from '../public/muscriptor-relabel.mjs';
import {auditionWindows,createAuditionMatcher,matchedAuditionLevels,measureAudition} from '../public/preview-loudness.mjs';

const id='a'.repeat(64),resource='b'.repeat(64);
const event=(id,start,end,midi,instrument='voice')=>({id,start,end,midi,instrument});
const first={id:'first',source:'original',audioStart:10,audioEnd:12};
const second={id:'second',source:'original',audioStart:12,audioEnd:15};
const base=()=>validateProject({version:1,bpm:60,key:8,notes:[],sections:[first,second]});
const result={analysisId:id,duration:10,notes:[
  event('lead1',.12,.15,69),event('lead2',.25,.28,69),event('lead3',.26,.28,69),event('held',1,3,72),
  event('bass1',2,3,45,'electric_bass'),event('bass2',2,3,69,'electric_bass'),
  event('bass3',3,4,47,'electric_bass'),event('kick',2.1,2.3,36,'drums')
]};
const candidate=section=>({sectionId:section.id,id:'raw-'+section.id,analysisId:id,analysisStart:10,analysisEnd:20,
  audioStart:section.audioStart,audioEnd:section.audioEnd,source:'original',method:'MuScriptor · 连续旋律',resourceId:resource,notes:[]});

test('roll keeps original attacks, chords and drum events, with stable identifiers at a section boundary',()=>{
  const left=muTrackWindow(result,10,{from:10,to:12}),right=muTrackWindow(result,10,{from:12,to:15});
  assert.deepEqual(left.tracks.get('voice').map(n=>n.id),['lead1','lead2','lead3','held']);
  const heldBefore=left.tracks.get('voice').at(-1),heldAfter=right.tracks.get('voice')[0];
  assert.equal(heldBefore.end,12);assert.equal(heldAfter.start,12);
  assert.equal(heldBefore.evidenceId,heldAfter.evidenceId);
  assert.equal(result.notes.find(n=>n.id==='held').end,3);
  assert.equal(right.tracks.get('electric_bass').length,3);
  assert.deepEqual(audibleMuTracks(right.tracks,'drums',new Set()).map(n=>n.midi),[36]);
  assert.equal(audibleMuTracks(right.tracks,null,new Set(['drums'])).length,4);
  assert.equal(audibleMuTracks(right.tracks,null,new Set()).length,5);
});

test('selected track preserves short repeated pitches and reports collisions and polyphonic omissions',()=>{
  const left=muTrackWindow(result,10,{from:10,to:12}),right=muTrackWindow(result,10,{from:12,to:15});
  const lead=scoreMuInstrument(left,'voice',base()),bass=scoreMuInstrument(right,'electric_bass',base());
  assert.deepEqual(lead.notes.map(n=>[n.midi,n.duration]),[[69,EDIT_STEP],[69,EDIT_STEP],[72,1]]);
  assert.deepEqual(lead.stats,{polyphony:0,collision:1,pitch:0});
  assert.deepEqual(bass.stats,{polyphony:1,collision:0,pitch:0});
  assert.ok(bass.notes.every(n=>n.muEvent.startsWith(id+':bass')));
  assert.deepEqual(scoreMuInstrument(right,'drums',base()).notes,[]);
  const tempo=validateProject({...base(),timeAnchors:[{beat:0,second:10},{beat:4,second:12},{beat:8,second:16}]});
  assert.equal(scoreMuInstrument(right,'electric_bass',tempo).notes[0].start,4);
});

test('analysis switch distinguishes source and time and keeps legacy melody reductions available for comparison',()=>{
  const raw=candidate(first),duplicate={...raw,id:'higher',method:'MuScriptor · 较高旋律'};
  const track={...raw,id:'chosen',model:MU_TRACK_MODEL,method:'MuScriptor 乐器轨',instrument:'voice'};
  const next={...raw,id:'second-input',source:'vocals',resourceId:'c'.repeat(64)};
  assert.deepEqual(muTrackAnalyses([raw,duplicate,next],duplicate.id).map(v=>v.candidate.id),['higher','second-input']);
  assert.deepEqual(visibleCandidates([raw,duplicate,track]).map(v=>v.id),['chosen']);
  assert.deepEqual(visibleCandidates([raw,duplicate,track],{active:'raw-first'}).map(v=>v.id),['raw-first','chosen']);
  assert.equal(visibleCandidates([raw,duplicate,track],{all:true}).length,3);
});

test('app selection replaces only the requested section and survives project and candidate serialization',()=>{
  const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
  const start=app.indexOf('function selectDraftVariant('),end=app.indexOf('const muTracks=installMuTracks(');
  const raw=base(),variants=[candidate(first),candidate(second)],saved=[];
  const state=vm.createContext({
    localDraftBase:raw,localDraft:raw,localDraftSections:raw.sections,localDraftVariants:variants,
    selectedDraftVariants:new Map(),audioResources:[],sourceRevision:1,scope:first,job:null,lyricsTask:null,adoptingDraft:false,
    draftIssueLoop:false,draftAuditionRange:null,savePendingDraft:()=>saved.push(1),$:()=>({}),
    sectionBeats,uid,validateProject,replaceSectionCandidate,currentDraftSection:()=>state.scope,
    isMuTrackCandidate,MU_TRACK_MODEL,scoreMuInstrument,stopDraftPlayback(){},renderDraftSection(){}
  });
  vm.runInContext(app.slice(start,end),state);
  const make=(section,instrument)=>state.createDraftMuTrack({revision:1,section,range:sectionSeconds(raw,section)},{
    candidate:candidate(section),origin:10,end:20
  },muTrackWindow(result,10,sectionSeconds(raw,section)),instrument);
  make(first,'voice');
  const priorId=state.selectedDraftVariants.get(first.id);
  state.scope=second;
  make(second,'electric_bass');
  assert.equal(state.selectedDraftVariants.get(first.id),priorId);
  assert.equal(raw.notes.length,0);
  const restored=validateProject(JSON.parse(JSON.stringify(state.localDraft)));
  assert.ok(restored.notes.filter(n=>n.start<12).every(n=>n.midi===69||n.midi===72));
  assert.equal(restored.notes[0].muEvent,id+':lead1');
  assert.equal(restored.alternates.find(v=>v.id===priorId).resourceId,resource);
  assert.equal(restored.alternates.find(v=>v.id===priorId).instrument,'voice');
  assert.equal(restored.alternates.find(v=>v.id===priorId).notes[0].muEvent,id+':lead1');
  make(second,'electric_bass');
  assert.equal(state.localDraftVariants.filter(isMuTrackCandidate).length,2);
  assert.equal(saved.length,3);
});

test('kick playback uses original song offsets, bounded scheduling and stops queued sounds',()=>{
  const scheduled=[],stopped=[];
  const param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
  const ctx={currentTime:7,destination:{},createGain:()=>({gain:param(),connect(){},disconnect(){}}),
    createOscillator:()=>({frequency:param(),connect(){},disconnect(){},start:when=>scheduled.push(when),stop:when=>stopped.push(when)})};
  const notes=[event('first',115,115.05,36,'drums'),event('late',117,117.1,36,'drums')];
  const playback=scheduleMuMidi(ctx,notes,{startedAt:7.05,position:115,to:120,speed:2,volume:.75});
  playback.tick();
  assert.deepEqual(scheduled,[7.05]);
  ctx.currentTime=7.85;playback.tick();
  assert.deepEqual(scheduled,[7.05,8.05]);
  playback.stop();assert.equal(stopped.at(-1),undefined);
  playback.tick();assert.equal(scheduled.length,2);
});

test('roll edits survive serialization and affect only a selected section and input',()=>{
  const range={from:10,to:12},raw=muTrackWindow(result,10,range),[analysis]=muTrackAnalyses([candidate(first)]);
  const edits=[['lead1',{start:10.4,end:10.6,midi:73,instrument:'voice'}],['lead2',null],
    ['edit_added',{start:11.8,end:12.1,midi:77,instrument:'voice',added:true}],['lead3',{start:10.2,end:10.1,midi:127,instrument:'voice'}]];
  const key=muRollEditKey(first,range,analysis);
  assert.notEqual(key,muRollEditKey(second,range,analysis));
  assert.notEqual(key,muRollEditKey(first,range,{...analysis,key:'other'}));
  const restored=normalizeMuRollEdits(JSON.parse(JSON.stringify(edits)));
  const edited=applyMuRollEdits(raw,id,restored);
  assert.deepEqual(edited.tracks.get('voice').map(n=>[n.id,n.start,n.end,n.midi]),[
    ['lead3',10.26,10.28,69],['lead1',10.4,10.6,73],['held',11,12,72],['edit_added',11.8,12,77]]);
  assert.equal(edited.tracks.get('voice').at(-1).evidenceId,id+':edit_added');
  assert.ok(scoreMuInstrument(edited,'voice',base()).notes.some(n=>n.midi===73));
  assert.deepEqual(raw.tracks.get('voice').map(n=>n.id),['lead1','lead2','lead3','held']);
  assert.equal(result.notes.find(n=>n.id==='lead1').midi,69);
});


test('audition levels match active original and MIDI audio without clipping or amplifying silence',()=>{
  const rate=8000,duration=7;
  const tone=amplitude=>{
    const data=Float32Array.from({length:rate*duration},(_,i)=>i>=2*rate&&i<5*rate?amplitude*Math.sin(2*Math.PI*440*i/rate):0);
    return {sampleRate:rate,numberOfChannels:2,length:data.length,duration,getChannelData:()=>data};
  };
  const range={from:0,to:7},original=measureAudition(tone(.6),[range]),midi=measureAudition(tone(.018),[range]);
  assert.ok(original.rms>.3);
  const gains=matchedAuditionLevels(original,midi);
  assert.ok(gains.original<1&&gains.midi>1&&gains.midi<=16);
  assert.ok(Math.abs(original.rms*gains.original-midi.rms*gains.midi)<1e-8);
  assert.ok(original.peak*gains.original<=.8&&midi.peak*gains.midi<=.8);
  assert.deepEqual(matchedAuditionLevels(original,measureAudition(tone(0),[range])),{original:1,midi:1});
});

test('loudness samples unordered notes and shares calibration only within the same audition mix',async()=>{
  const notes=[{start:16,end:17},{start:3,end:4},{start:30,end:31}],range={from:0,to:35};
  const windows=auditionWindows(notes,range,1);
  assert.equal(windows.length,3);
  for(const [i,second] of [3.5,16.5,30.5].entries())assert.ok(windows[i].from<second&&windows[i].to>second);
  const data=new Float32Array(8000*35);
  const buffer={sampleRate:8000,numberOfChannels:1,length:data.length,duration:35,getChannelData:()=>data};
  let renders=0;
  const match=createAuditionMatcher(async(_,windows)=>{renders++;return {buffer,windows};});
  const roll={notes,range,mixKey:['voice']};
  const pending=match(buffer,roll,1);
  assert.equal(pending,match(buffer,roll,1));
  await pending;
  await match(buffer,{...roll,mixKey:['electric_bass']},1);
  await match(buffer,roll,.5);
  await match(buffer,{...roll,range:{...range}},1);
  assert.equal(renders,4);
});

test('vocal suggestions match actual pitch and timing, flag duplicates and ignore short notes and drums',()=>{
  const rate=8000,start=32;
  const samples=Float32Array.from({length:rate*3},(_,i)=>{
    const t=i/rate;
    return t>=.2&&t<1.8?.12*Math.sin(t*2*Math.PI*440):0;
  });
  const notes=[event('good',32.3,32.62,69,'synth_pad'),event('duplicate',32.9,33.27,69,'electric_bass'),
    event('voice',32.92,33.25,69),event('realbass',32.3,32.7,45,'electric_bass'),
    event('pad',32.3,32.7,74,'synth_pad'),event('drums',32.3,32.65,69,'drums'),
    event('short',33.38,33.401,69,'synth_pad'),event('silent',34,34.4,69,'synth_pad')];
  const groups=muVocalSuggestions({samples,rate,start},notes,[event('evidence',32.31,32.64,69)]);
  assert.deepEqual(groups.map(({ids,repeated,backed})=>[ids,repeated,backed]),[[['good'],false,1],[['duplicate'],true,0]]);
});

test('migration preserves event identity, note properties, chords and boundaries through candidate storage',()=>{
  const left=muTrackWindow(result,10,{from:10,to:12}),right=muTrackWindow(result,10,{from:12,to:15});
  const held=left.tracks.get('voice').at(-1);held.velocity=93;
  const edits=new Map([['edit_x',{start:11.1,end:11.5,midi:75,instrument:'voice',added:true}]]);
  const augmented=applyMuRollEdits(left,id,edits);
  const notes=augmented.tracks.get('voice');
  const patch=normalizeMuRollEdits(JSON.parse(JSON.stringify([...muMoveNotes(edits,notes,'synth_pad')])));
  const moved=applyMuRollEdits(left,id,patch);
  assert.equal(moved.tracks.has('voice'),false);
  assert.deepEqual(moved.tracks.get('synth_pad').map(({instrument,...note})=>note),notes.map(({instrument,...note})=>note));
  assert.equal(moved.tracks.get('synth_pad').find(n=>n.id==='held').end,12);
  assert.equal(right.tracks.get('voice')[0].start,12);
  assert.equal(moved.tracks.get('synth_pad').find(n=>n.id==='held').velocity,93);
  assert.equal(moved.tracks.get('synth_pad').length,5);
  assert.ok(scoreMuInstrument(moved,'synth_pad',base()).notes.length);
  assert.equal(applyMuRollEdits(left,id,edits).tracks.has('voice'),true);
  assert.deepEqual([...muDuplicateIds([event('unison',10.03,10.5,69),event('repeat',10.1,10.5,69)],
    [event('original',10,10.5,69)])],['unison']);
});

test('dual agreement rejects contradicted vocal matches and distinguishes possible accompaniment unison',()=>{
  const rate=8000,start=110,samples=Float32Array.from({length:rate*2},(_,i)=>.12*Math.sin(i/rate*2*Math.PI*440));
  const audio={samples,rate,start};
  const notes=[event('voice-mislabel',110.2,110.7,69,'synth_pad'),event('normal-bass',111.1,111.7,45,'electric_bass')];
  const consensus=Array.from({length:200},(_,i)=>({second:start+i*.01,pitch:i<100?69:45}));
  const options={consensus,accompaniment:{other:audio}};
  assert.deepEqual(muVocalSuggestions(audio,notes,[],options).map(g=>[g.ids,g.alsoInBacking]),[[['voice-mislabel'],true]]);
  assert.deepEqual(muVocalSuggestions(audio,notes,[],{consensus:[]}),[]);
  assert.deepEqual(muVocalSuggestions(audio,notes,[],{consensus:consensus.map(f=>({...f,pitch:67}))}),[]);
});
