import {MU_TRACK_MODEL,isMuTrackCandidate,muTrackWindow,scoreMuInstrument} from '../public/muscriptor-tracks.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EDIT_STEP, validateProject, uid} from '../public/music.mjs';
import {makeRepairAlternate, reviewPoints} from '../public/muscriptor-review-ui.mjs';
import {sectionSeconds} from '../public/sections.mjs';
import {muSourceVariants, muWindowResult} from '../public/muscriptor-pipeline.mjs';

test('review markers use original seconds and only offer retries inside the selected section', () => {
  const report = {
    windows: [
      {from: 0, to: 5, status: 'suspected-missing'}, {from: 5, to: 10, status: 'suspected-label'},
      {from: 10, to: 15, status: 'suspected-label'}, {from: 15, to: 20, status: 'insufficient-evidence'},
      {from: 20, to: 25, status: 'no-anomaly'}
    ],
    repairs: [{from: 0, to: 5, clipFrom: 0, clipTo: 8}]
  };
  assert.deepEqual(reviewPoints(report, 110, {from: 112, to: 127}), [
    {from: 112, to: 115, clipFrom: 110, clipTo: 118, status: 'suspected-missing'},
    {from: 115, to: 125, status: 'suspected-label'},
    {from: 125, to: 127, status: 'insufficient-evidence'}
  ]);
});

const candidate = {id: 'basis', muVariant:'medium', sectionId: 'verse', source: 'vocals', resourceId: 'a'.repeat(64),
  analysisId: 'b'.repeat(64), analysisStart: 108, analysisEnd: 132,
  method: 'MuScriptor · 连续旋律', notes: [
    {id:'held', start:111, duration:10, midi:64}, {id:'later', start:125, duration:1, midi:67}
  ], lyrics: [{id:'word-1', text:'外', start:111, end:112, noteIds:['held']}]};
const baseScore = validateProject({version:1,bpm:60,key:0, notes:[{id:'formal', start:0, duration:1, midi:55}]});
const point = {from:115, to:120, clipFrom:112, clipTo:123};

test('local alternate keeps both tails of a boundary note and its existing lyric association', () => {
  const patch = makeRepairAlternate(baseScore, candidate, point, {notes:[{id:'retry', start:116, duration:1, midi:72}],lyrics:[]});
  assert.deepEqual(patch.notes.map(n=>[n.start,n.duration,n.midi]), [[111,4,64],[116,1,72],[120,1,64],[125,1,67]]);
  assert.equal(patch.lyrics[0].text,'外');
  assert.ok(patch.lyrics[0].noteIds.includes(patch.notes[0].id));
  assert.equal(baseScore.notes[0].id,'formal');
  assert.equal(candidate.notes[0].duration,10);
});

const app = readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
const functions = app.slice(app.indexOf('const currentDraftSection='), app.indexOf('const muReview=installMuReview('));

test('candidate action reads authenticated cache, then submits only the requested contextual crop and saves a separate variant', async () => {
  const section = {id:'verse', name:'Verse', source:'vocals', audioStart:110, audioEnd:130};
  const baseline = validateProject({...baseScore, sections:[section], alternates:[candidate]});
  const buffer = {duration:30}, calls = [], controls = {draftSectionSelect:'verse', muPrecision:'auto', minMidi:'21', maxMidi:'108'};
  const state = vm.createContext({
    $: id=>({value:controls[id],open:true}),
    currentDraft:null, job:null, lyricsTask:null, adoptingDraft:false, original:{duration:140},
    localDraftBase:baseline, localDraft:baseline, localDraftSections:[section], localDraftVariants:[candidate],
    selectedDraftVariants:new Map([[section.id,candidate.id]]), sourceRevision:2,
    audioResources:[{id:candidate.resourceId,source:'vocals',audioStart:105,audioEnd:135}], token:'mock-token',
    AbortSignal, performance, resourceBuffer:async()=>buffer,
    fetch:async(url,options)=>{calls.push([url,options.headers['X-Studio-Token']]);return {ok:true,json:async()=>({duration:24,notes:[]})};},
    monoSamples:async(input,from,to,rate)=>{calls.push([input,from,to,rate]);return new Float32Array(24*rate);},
    loadMuSource:async input=>{calls.push(['retry',input.from,input.to,input.origin,input.source,input.task.muVariant]);return {origin:input.from,result:{notes:[
      {id:'context',start:1,end:2,midi:50,instrument:'voice'},{id:'wanted',start:4,end:5,midi:72,instrument:'voice'}
    ]}};},
    sectionSeconds, EDIT_STEP, validateProject, uid, makeRepairAlternate, muSourceVariants, muWindowResult, isMuTrackCandidate,muTrackWindow,scoreMuInstrument,tr:s=>s,
    normalizeMuPrecision: value=>value, requireRecognitionComponent(mode,variant){assert.equal(mode,'muscriptor');assert.equal(variant,'medium');}, prepareCompute:async()=>{}, setBusy(){}, renderDraftSection(){},
    lyricCandidate: raw=>({notes:raw.map(n=>({id:n.id,start:n.start,duration:n.end-n.start,midi:n.midi})),lyrics:[]}),
    diagnosticTime: String, savePendingDraft:()=>calls.push('saved')
  });
  vm.runInContext(functions, state);
  const info = state.muReviewContext([]);
  const {input} = await state.loadMuReviewInput(info, new AbortController().signal);
  assert.deepEqual(calls, [['/api/muscriptor/result/'+candidate.analysisId+'/json','mock-token'], [buffer,3,27,8000]]);
  const patch = await state.retryMuReview(info, point, input, new AbortController());
  assert.deepEqual(calls.slice(2), [['retry',112,123,105,'vocals','medium'],'saved']);
  assert.equal(state.selectedDraftVariants.get(section.id), candidate.id);
  assert.equal(state.localDraft.notes[0].id, 'formal');
  const alternate = state.localDraftVariants.find(v=>v.id===patch.id);
  assert.deepEqual(alternate.notes.map(n=>n.midi), [64,72,64,67]);
  assert.equal(alternate.analysisId, null);
  assert.equal(state.job,null);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(state.retryMuReview(state.muReviewContext([]), point, input, cancelled), {name:'AbortError'});
  assert.equal(state.localDraftVariants.length,2);
  assert.equal(state.job,null);

  const bass={...candidate,id:'bass',model:MU_TRACK_MODEL,instrument:'electric_bass'};
  state.localDraftVariants.push(bass);state.selectedDraftVariants.set(section.id,bass.id);
  let label='voice';
  state.loadMuSource=async()=>({origin:112,result:{analysisId:'c'.repeat(64),duration:11,notes:[
    {id:'matched-only-if-bass',start:4,end:5,midi:55,instrument:label},
    {id:'other',start:4,end:5,midi:72,instrument:'voice'}
  ]}});
  const count=state.localDraftVariants.length;
  await assert.rejects(state.retryMuReview(state.muReviewContext([]),point,input,new AbortController()),/原候选已保留/);
  assert.equal(state.localDraftVariants.length,count);
  label='electric_bass';
  const bassPatch=await state.retryMuReview(state.muReviewContext([]),point,input,new AbortController());
  const repaired=state.localDraftVariants.find(v=>v.id===bassPatch.id);
  assert.equal(state.selectedDraftVariants.get(section.id),bass.id);
  assert.equal(repaired.instrument,'electric_bass');
  assert.equal(repaired.notes.find(n=>n.midi===55)?.muEvent,'c'.repeat(64)+':matched-only-if-bass');
  assert.ok(!repaired.notes.some(n=>n.midi===72));
});