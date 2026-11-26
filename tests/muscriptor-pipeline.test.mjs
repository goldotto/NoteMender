import {isMuTrackCandidate} from '../public/muscriptor-tracks.mjs';
import {appText} from '../public/app-i18n.mjs';
import {tr} from '../public/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {muMelodySlots,muSourceMelody,muSourceVariants,muWindowResult,createMuSourceAnalysis,distinctMuCandidates,chooseMuCandidates,isMuCandidate,MU_CANDIDATE_MODEL} from '../public/muscriptor-pipeline.mjs';
import {muPitchWindows} from '../public/muscriptor-vocal-pitch.mjs';
import {sectionBeats} from '../public/sections.mjs';
import {replaceSectionCandidate} from '../public/local-candidates.mjs';
import {makeDemo,uid,validateProject,quantizeNotes,estimateKey,EDIT_STEP} from '../public/music.mjs';
import {quantizeTimed,makeTimeAnchors} from '../public/time-map.mjs';
import {analysisWindows,chooseQuantization,mergeAnalysisUsed,modeName} from '../public/adaptive-strategy.mjs';
import {preservePrimary,selectedIssues} from '../public/candidate-tools.mjs';
import {stitchEvidence} from '../public/recognition-evidence.mjs';
import {computeQuery} from '../public/compute-settings.mjs';
import {linkRawLyrics} from '../public/lyric-assist.mjs';
import {normalizeMuPrecision} from '../public/muscriptor-spec.mjs';
import {adoptCandidate} from '../public/candidate-adoption.mjs';
import {applyComponentAvailability} from '../public/components-ui.mjs';
import {candidateInput,candidateMenuLabel,visibleCandidates} from '../public/candidate-menu.mjs';

const event=(id,start,end,midi=65,instrument='voice')=>({id,start,end,midi,instrument});
const base=()=>validateProject({...makeDemo(),title:'合成测试',bpm:60,notes:[],lyrics:[],timeAnchors:makeTimeAnchors(40,60)});
const spans=[{from:0,to:5,kind:'intro',source:'other',name:'前奏'},{from:5,to:15,kind:'voice',source:'vocals',name:'人声1'},{from:15,to:25,kind:'interlude',source:'other',name:'间奏'},{from:25,to:35,kind:'voice',source:'vocals',name:'人声2'},{from:35,to:40,kind:'outro',source:'other',name:'尾奏'}];
const raw=spans.map((s,i)=>event('mu-'+i,s.from+.5,s.from+1,65+i,i===3?'electric_bass':'voice'));
const sourceResult={notes:raw,analysisId:'a'.repeat(64),duration:40,device:'cpu',precision:'fp32'};

test('real-source melody retains later singing despite instrument-label drift and does not mutate raw polyphony',()=>{
  const before=structuredClone(raw),notes=muSourceMelody([...raw,event('drum',1,2,60,'drums')]);
  assert.equal(notes.length,5);assert.equal(notes.at(-2).start,25.5);assert.deepEqual(raw,before);
  assert.equal(muSourceVariants(sourceResult).variants.length,3,'stable variants across section windows');
});

test('held notes survive later attacks; genuine repeats, silence, and high/low choices remain',()=>{
  const held=[event('held',0,2,72),event('bass',.5,.7,48)];
  for(const voice of ['continuous','high'])assert.deepEqual(muSourceMelody(held,voice).map(n=>[n.start,n.end,n.midi]),[[0,2,72]]);
  assert.deepEqual(muSourceMelody(held,'low').map(n=>n.midi),[72,48,72]);
  assert.equal(muSourceMelody([event('a',0,.1),event('b',.1,.2),event('c',1,1.2)]).length,3);
  assert.equal(muSourceMelody([event('a',0,1,60),event('b',.012,1,72)],'high').length,1);
  assert.equal(muSourceMelody([event('a',0,.01),event('b',.015,.03,62)]).length,2);
});

test('window boundaries retain both halves of sustained notes, without rerunning inference',()=>{
  const prepared=muSourceVariants({...sourceResult,notes:[event('held',0,10)]});
  const a=muWindowResult(prepared,{from:100,to:104},100,'vocals'),b=muWindowResult(prepared,{from:104,to:110},100,'vocals');
  assert.deepEqual(stitchEvidence([...a.primary,...b.primary]).map(n=>[n.start,n.end]),[[100,110]]);
  assert.equal(a.variants[0].source,'vocals');
});

test('source cache shares concurrent calls and does not repeat failed model loading in every section',async()=>{
  let calls=0;const load=createMuSourceAnalysis(async()=>{calls++;return sourceResult;});
  const results=await Promise.all([load('same',{}),load('same',{})]);assert.equal(calls,1);assert.equal(results[0],results[1]);
  await load('other',{});assert.equal(calls,2);
  let failed=0;const bad=createMuSourceAnalysis(async()=>{failed++;throw Error('模型失败');});
  await assert.rejects(bad('same',{}));await assert.rejects(bad('same',{}));assert.equal(failed,1);
});

function convert(events,project,step){const choice=chooseQuantization(events,project,step);return {notes:quantizeNotes(quantizeTimed(events,project,choice.step),60,0,choice.step),step:choice.step,lyrics:[]};}
async function harness({mode='muscriptor',separate=true,failSource=null}={}){
  const source=await readFile(new URL('../public/app.mjs',import.meta.url),'utf8'),requests=[],engineCalls=[],checkpoints=[];
  const controls=new Map(),control=id=>{if(!controls.has(id))controls.set(id,{value:'',checked:false,textContent:'',selectedOptions:[{textContent:'默认基线'}],replaceChildren(){}});return controls.get(id);};
  for(const [id,value] of Object.entries({rangeStart:'0',rangeEnd:'40',minMidi:'21',maxMidi:'108',instrumentMinMidi:'21',instrumentQuantize:'.5',quantize:'.25',strategy:'smooth',engine:'auto',muPrecision:'auto'}))control(id).value=value;
  control('recognitionMu').checked=mode==='muscriptor';control('muAutoSeparate').checked=separate;control('autoSeparate').checked=separate;control('singingFine').checked=true;
  const project=base();const state={appText,tr,project,original:{duration:40,kind:'original'},vocals:{duration:40,kind:'vocals'},other:{duration:40,kind:'other'},bass:null,drums:null,instrumental:null,sourceRevision:1,job:null,lyricsTask:null,scorePending:true,pendingDraftMeta:null,componentStatus:{components:[{id:'basic',ready:true},{id:'muscriptor',ready:true}]},token:'fixture-token',performance,AbortController,AbortSignal,DOMException,Map,Set,structuredClone,setTimeout,clearTimeout,Option:class{},
    $:control,stopPlayback(){},setBusy(){},progress(){},prepareCompute:async task=>{task.execution={mode:'standard',device:'cpu',threads:0};task.computeTimes={};},ensureOriginalResource:async()=>{},separateForTask:async()=>{},
    transcriptionTempo:async()=>({bpm:60,beats:[]}),monoSamples:async(audio,from,to,sampleRate)=>({audio,from,to,sampleRate}),wavBytes:samples=>samples,computeQuery,normalizeMuPrecision,
    fetch:async(url,request)=>{assert.match(url,/^\/api\/muscriptor\/analyse/);const body=request.body;requests.push(body);assert.equal(body.sampleRate,16000);assert.equal(body.from,0);assert.equal(body.to,40);if(failSource==='all'||body.audio.kind===failSource)return {ok:false,json:async()=>({error:'测试失败'})};return {ok:true,json:async()=>({...sourceResult,analysisId:body.audio.kind==='vocals'?'b'.repeat(64):body.audio.kind==='other'?'c'.repeat(64):'a'.repeat(64)})};},
    createMuSourceAnalysis,muSourceVariants,muWindowResult,distinctMuCandidates,lyricCandidate:(events,words,project,step)=>convert(events,project,step),trackName:s=>s,analysisWarnings:[],auditWindows:[],audioResources:[{id:'d'.repeat(64),source:'original',audioStart:0,audioEnd:40,model:'original'}],automaticSpans:(vocals,other)=>vocals&&other?spans:[{from:0,to:40,name:'原曲',kind:'instrumental',source:'original'}],analysisWindows,uid,makeTimeAnchors,estimateKey,quantizeNotes,quantizeTimed,EDIT_STEP,validateProject,linkRawLyrics,
    generationLyrics:async()=>[],analyseWindow:async(window,source,options,engine)=>{engineCalls.push({source,engine});return {primary:[{id:uid(),start:window.from+.2,end:window.from+.4,midi:60,confidence:.8,source}],variants:[],mode:'solo',source,diagnostics:{issues:[]}};},
    stitchEvidence,selectedIssues,joinWindowNotes:stitchEvidence,candidateNotes:convert,mergeAnalysisUsed,diagnosticFlags:()=>[],instrumentAlternates:async()=>[],singingAlternates:async()=>[],checkpointCandidates:(base,timed,words,sections)=>checkpoints.push(sections.length),showComputeTimes(){},buildAudit:()=>({}),persistAudit:async()=>{},lyricsAfterQuantization:()=>[],preservePrimary,modeName,sectionBeats:()=>({start:0,end:40}),previewFlags:()=>'',loadedAudioName:'合成.wav',renderDraftSection(){},openDraftDialog(){},closeWorker(){}};
  vm.createContext(state);
  vm.runInContext(source.slice(source.indexOf('async function loadMuSource('),source.indexOf('\nfunction renderDraftSection(')),state);
  return {state,requests,engineCalls,checkpoints,run:()=>state.transcribe(),source,controls};
}

test('generation uses only the selected engine; Mu covers every passage and caches each source once',async()=>{
  const traditional=await harness({mode:'traditional'});await traditional.run();
  assert.equal(traditional.requests.length,0);
  assert.ok(traditional.engineCalls.length>=5);
  assert.ok(traditional.state.localDraft.notes.every(n=>n.midi===60));

  const mu=await harness();
  mu.state.componentStatus.components.find(c=>c.id==='basic').ready=false;
  await mu.run();
  assert.equal(mu.engineCalls.length,0);
  assert.deepEqual(mu.requests.map(r=>r.audio.kind).sort(),['original','other','vocals']);
  assert.equal(mu.state.project.notes.length,0,'no automatic adoption');
  assert.deepEqual(mu.checkpoints,[1,2,3,4,5]);
  const draft=mu.state.localDraft;
  assert.equal(draft.engine,'MuScriptor large');
  assert.equal(draft.notes.length,5);
  assert.equal(mu.state.selectedDraftVariants.size,5);
  for(const section of draft.sections){
    const active=mu.state.selectedDraftVariants.get(section.id);
    assert.ok(draft.alternates.some(c=>c.id===active&&c.sectionId===section.id&&isMuCandidate(c)));
    assert.equal(section.analysisUsed[0].mode,'muscriptor');
    if(section.source==='vocals')assert.ok(draft.alternates.some(c=>c.sectionId===section.id&&c.source==='original'&&isMuCandidate(c)));
  }
  const adopted=adoptCandidate(base(),draft,draft.sections,{newSong:true});
  assert.equal(adopted.project.notes.length,5);
  assert.equal(adopted.project.notes.at(-1).start,35.5,'adoption includes outro outside current preview');
});

test('Mu direct mode reads only the mix; optional separation failure in a stem uses the Mu mix',async()=>{
  const direct=await harness({separate:false});
  direct.state.separateForTask=()=>assert.fail('unexpected separation');
  await direct.run();
  assert.deepEqual(direct.requests.map(r=>r.audio.kind),['original']);
  assert.equal(direct.state.localDraft.sections.length,1);

  const fallback=await harness({failSource:'vocals'});await fallback.run();
  assert.equal(fallback.requests.filter(r=>r.audio.kind==='vocals').length,1);
  assert.equal(fallback.engineCalls.length,0);
  assert.ok(fallback.state.localDraft.notes.length>0);
  assert.ok(fallback.state.analysisWarnings.some(w=>w.includes('测试失败')));
  assert.equal(fallback.state.localDraft.sections.filter(s=>s.source==='original').length,2);
});

test('Mu inference failure surfaces its cause and leaves the previous candidate alone',async()=>{
  const h=await harness({failSource:'all'});
  const previous={id:'pending'};
  h.state.localDraft=previous;
  await assert.rejects(h.run(),/MuScriptor 没有生成可用旋律.*测试失败/);
  assert.equal(h.engineCalls.length,0);
  assert.equal(h.state.localDraft,previous);
  assert.equal(h.state.job,null);
});

test('segment regeneration also uses the selected engine and retains the selected Mu analysis',async()=>{
  const h=await harness({separate:false}),s=h.state;
  const segment={id:'selection',name:'当前段',audioStart:25,audioEnd:35,source:'vocals'};
  s.sectionSeconds=()=>({from:25,to:35});
  let draft;
  s.showSectionDraft=(...args)=>{draft=args;};
  const start=h.source.indexOf('async function regenerateLocalSection(');
  const end=h.source.indexOf("on('sectionList'",start);
  vm.runInContext(h.source.slice(start,end),s);
  s.fetch=async(url,{body})=>{
    assert.ok(url.startsWith('/api/muscriptor/analyse'));
    assert.equal(body.audio.kind,'original');assert.equal(body.from,25);assert.equal(body.to,35);
    return {ok:true,json:async()=>({...sourceResult,notes:[event('ref',.5,1,74)]})};
  };
  await s.regenerateLocalSection(segment);
  assert.equal(h.engineCalls.length,0);
  assert.equal(draft[1][0].start,25.5);
  assert.equal(draft[3].selectedVariant,draft[3].variants[0].id);
  assert.equal(draft[3].analysisUsed[0].mode,'muscriptor');
});

test('Mu request abort propagates and clears the active task',async()=>{
  const h=await harness();h.state.fetch=async()=>{throw new DOMException('取消','AbortError');};
  await assert.rejects(h.run(),{name:'AbortError'});assert.equal(h.state.project.notes.length,0);assert.equal(h.state.job,null);
});

test('actual instrument-track loop keeps ordinary alternatives without automatically loading Mu on every stem',async()=>{
  const h=await harness(),s=h.state;s.project=base();const resources=['guitar','piano','bass','other'].map((source,i)=>({source,id:String(i+1).repeat(64),audioStart:0,audioEnd:40,model:'htdemucs_6s'}));
  s.signalRms=()=>.1;s.separatedInstrumentResources=async()=>resources;s.resourceBuffer=async resource=>({duration:40,kind:resource.source});s.hasTrackContent=()=>true;s.instrumentContext=null;s.resourceBuffers=new Map();s.candidateNotes=convert;
  vm.runInContext(h.source.slice(h.source.indexOf('async function instrumentAlternates('),h.source.indexOf('\nfunction buildAudit(')),s);
  const task={muPrecision:'auto',execution:{device:'cpu'},controller:new AbortController(),muRange:{from:0,to:40}},options={minMidi:21,maxMidi:108};
  const candidates=await s.instrumentAlternates(spans[2],'interlude',options,base(),.25,task);
  for(const source of ['guitar','piano','bass','other','original'])assert.ok(candidates.some(c=>c.source===source&&c.method.startsWith('自动旋律')));
  assert.ok(!candidates.some(c=>c.model===MU_CANDIDATE_MODEL));
  assert.equal(s.instrumentContext,null);assert.equal(h.requests.length,0);
});

test('actual on-demand action computes only the selected passage/input, preserves baseline and avoids duplicates',async()=>{
  const h=await harness({mode:'traditional'});await h.run();const s=h.state,section=s.localDraftSections[0],calls=[];
  const resource={id:'e'.repeat(64),source:'guitar',model:'htdemucs_6s',audioStart:0,audioEnd:40};
  s.audioResources.push(resource);s.localDraftVariants.push({id:'guitar-regular',sectionId:section.id,resourceId:resource.id,source:'guitar',method:'自动旋律',notes:[],model:'htdemucs_6s'});
  s.selectedDraftVariants=new Map([[section.id,'guitar-regular']]);h.controls.set('draftSectionSelect',{value:section.id});h.controls.set('draftTrackSelect',{value:'guitar'});
  s.isMuCandidate=isMuCandidate;s.isMuTrackCandidate=isMuTrackCandidate;s.sectionBeats=sectionBeats;s.replaceSectionCandidate=replaceSectionCandidate;s.stopDraftPlayback=()=>{};s.savePendingDraft=()=>{};s.resourceBuffer=async()=>({duration:40,kind:'guitar'});
  s.fetch=async(url,request)=>{calls.push(request.body);return {ok:true,json:async()=>sourceResult};};
  vm.runInContext(h.source.slice(h.source.indexOf('async function generateDraftMuTrack('),h.source.indexOf("on('generateMuTrack'")),s);
  const initial=s.localDraftBase.notes.map(n=>[n.start,n.duration,n.midi]);
  await s.generateDraftMuTrack();assert.equal(calls.length,1);assert.equal(calls[0].from,section.audioStart);assert.equal(calls[0].to,section.audioEnd);assert.equal(calls[0].audio.kind,'guitar');
  const variants=s.localDraftVariants.filter(v=>v.model===MU_CANDIDATE_MODEL);assert.equal(variants.length,1);assert.equal(variants[0].inputModel,'htdemucs_6s');assert.equal(variants[0].resourceId,resource.id);
  assert.deepEqual(s.localDraftBase.notes.map(n=>[n.start,n.duration,n.midi]),initial);assert.equal(s.project.notes.length,0);assert.equal(s.job,null);
  await s.generateDraftMuTrack();assert.equal(s.localDraftVariants.filter(v=>v.model===MU_CANDIDATE_MODEL).length,1,'retry replaces that input rather than adding another indistinguishable set');
  s.selectedDraftVariants.clear();
  const result=await s.generateDraftMuTrack({source:'guitar',resourceId:resource.id});
  assert.equal(result.source,'guitar');assert.equal(s.selectedDraftVariants.has(section.id),false,'roll input generation does not select the candidate');
  s.fetch=async()=>{throw Error('测试网络失败');};const before=s.localDraftBase;
  await assert.rejects(s.generateDraftMuTrack({source:'guitar',resourceId:resource.id}),/原候选保留/);assert.equal(s.localDraftBase,before);assert.equal(s.job,null);
  s.fetch=async()=>{s.job.controller.abort();throw new DOMException('取消','AbortError');};
  await assert.rejects(s.generateDraftMuTrack({source:'guitar',resourceId:resource.id}),{name:'AbortError'});assert.equal(s.localDraftBase,before);assert.equal(s.job,null);assert.equal(h.controls.get('cancelMuTrack').hidden,true);
});

test('menu distinguishes four/six stem inputs and keeps retired Pitchy only as historical comparisons',()=>{
  const input=[{id:'six',model:'htdemucs_6s'}],a={id:'four',source:'other',resourceId:null,inputModel:'htdemucs',method:'MuScriptor · 连续旋律',notes:[{start:0,duration:1,midi:60}]},b={...a,id:'six-variant',inputModel:undefined,resourceId:'six'};
  assert.equal(candidateInput(a,input),'四轨分离');assert.equal(candidateInput(b,input),'六轨分离');assert.notEqual(candidateMenuLabel(a,input),candidateMenuLabel(b,input));
  const legacy={id:'old',method:'Pitchy',notes:a.notes},improved={id:'new',method:'Pitchy 连续音高分音',notes:a.notes},backup={id:'backup',method:'MuScriptor · 连续旋律 · 整理前备份',notes:a.notes};
  assert.deepEqual(visibleCandidates([a,b,legacy,improved,backup]),[]);
  assert.deepEqual(visibleCandidates([a,b],{all:true}).map(v=>v.id),['four','six-variant']);
  assert.equal(visibleCandidates([legacy],{active:'old'}).length,1);assert.equal(visibleCandidates([legacy,backup],{all:true}).length,2);
  assert.match(candidateMenuLabel(legacy),/历史候选/);assert.match(candidateMenuLabel(improved),/改进分音/);
  assert.deepEqual(visibleCandidates([a,{...a,id:'active'}],{active:'active'}).map(v=>v.id),['active']);
});

test('duplicate voices collapse locally; selecting all keeps non-Mu choices when a section has no Mu notes',()=>{
  assert.equal(distinctMuCandidates([{notes:[{start:1,duration:1,midi:60}]},{notes:[{start:1,duration:1,midi:60}]}]).length,1);
  const project=base(),sections=spans.map((s,i)=>({id:'s'+i,name:s.name,source:s.source,audioStart:s.from,audioEnd:s.to}));project.notes=[{id:'keep',start:35.5,duration:.5,midi:60}];
  const variants=[{id:'mu',sectionId:'s0',source:'other',model:MU_CANDIDATE_MODEL,notes:[{id:'new',start:.5,duration:.5,midi:65}],lyrics:[]}];
  const result=chooseMuCandidates(project,sections,variants);assert.equal(result.selected.size,1);assert.equal(result.missing.length,4);assert.ok(result.project.notes.some(n=>n.id==='keep'));assert.equal(project.notes.length,1);
});

test('source analysis origin survives project save/load without changing existing fields',()=>{
  const p=base();p.alternates=[{id:'mu',sectionId:'s',model:MU_CANDIDATE_MODEL,analysisId:'a'.repeat(64),analysisStart:20,analysisEnd:40,audioStart:25,audioEnd:35,source:'vocals',notes:[]}];
  const restored=validateProject(JSON.parse(JSON.stringify(validateProject(p))));assert.equal(restored.alternates[0].analysisStart,20);assert.equal(restored.alternates[0].audioStart,25);
});

test('actual cached rebuild keeps the regular baseline, other sources, and unique backup IDs',async()=>{
  const h=await harness(),s=h.state,section={id:'section',name:'后段',source:'vocals',audioStart:25,audioEnd:35};
  s.localDraftBase=validateProject({...base(),sections:[section],notes:[{id:'regular',start:26,duration:1,midi:60}]});
  const metadata={sectionId:section.id,model:MU_CANDIDATE_MODEL,analysisId:'a'.repeat(64),analysisStart:20,analysisEnd:40,audioStart:25,audioEnd:35,method:'MuScriptor · 连续旋律',lyrics:[]};
  s.localDraftVariants=[{...metadata,id:'mu-vocal',source:'vocals',notes:[{id:'old-note',start:26,duration:.5,midi:65}]},{...metadata,id:'mu-original',source:'original',notes:[]},{id:'ordinary',sectionId:section.id,source:'vocals',method:'自动首选',notes:[]}];
  s.localDraftSections=[section];s.selectedDraftVariants=new Map([[section.id,'mu-vocal']]);h.controls.set('draftSectionSelect',{value:section.id});
  s.muPitchWindows=muPitchWindows;s.muMelodySlots=muMelodySlots;s.currentDraftSection=()=>section;
  h.controls.set('localDraftDialog',new EventTarget());
  s.isMuCandidate=isMuCandidate;s.isMuTrackCandidate=isMuTrackCandidate;s.sectionBeats=sectionBeats;s.replaceSectionCandidate=replaceSectionCandidate;s.stopDraftPlayback=()=>{};s.savePendingDraft=()=>{};
  const callbacks=new Map();s.on=(id,type,fn)=>callbacks.set(id,fn);s.fetch=async()=>({ok:true,json:async()=>({notes:[event('cached-relative',6,6.5,69,'electric_bass')]})});
  vm.runInContext(h.source.slice(h.source.indexOf("on('rebuildMuCandidates'"),h.source.indexOf("on('selectMuAll'")),s);
  await callbacks.get('rebuildMuCandidates')();
  assert.deepEqual(s.localDraftBase.notes.map(n=>[n.start,n.duration,n.midi]),[[26,1,60]],'ordinary primary is not replaced');
  assert.deepEqual(s.localDraft.notes.map(n=>[n.start,n.duration,n.midi]),[[26,.5,69]],'raw cache origin is 20, not section start 25');
  assert.ok(s.localDraftVariants.some(v=>v.id==='mu-original'));assert.ok(s.localDraftVariants.some(v=>v.id==='ordinary'));
  assert.ok(s.localDraftVariants.some(v=>v.id==='mu-vocal'&&v.method.includes('整理前备份')));
  await callbacks.get('rebuildMuCandidates')();
  assert.equal(new Set(s.localDraftVariants.map(v=>v.id)).size,s.localDraftVariants.length);
  assert.equal(s.localDraftBase.notes[0].midi,60);assert.equal(h.controls.get('rebuildMuCandidates').disabled,false);
});

test('only the selected recognition component gates the Generate button',()=>{
  const previous=globalThis.document;
  const button={dataset:{},type:'button',disabled:false,classList:{toggle(){}},setAttribute(){}};
  globalThis.document={getElementById:id=>id==='transcribe'?button:null};
  try{
    const status={components:[{id:'basic',ready:true,description:'基础'},{id:'muscriptor',ready:false,description:'Mu'}]};
    applyComponentAvailability(status,'traditional');assert.equal(button.disabled,false);
    applyComponentAvailability(status,'muscriptor');assert.equal(button.disabled,true);
    button.disabled=false; // Ordinary render recalculates the non-component conditions.
    applyComponentAvailability(status,'traditional');assert.equal(button.disabled,false);
    status.components[0].ready=false;status.components[1].ready=true;
    applyComponentAvailability(status,'muscriptor');assert.equal(button.disabled,false);
    applyComponentAvailability(status,'traditional');assert.equal(button.disabled,true);
  }finally{globalThis.document=previous;}
});

test('trusted vocal frames choose pitches inside overlaps and preserve clean retriggers and unaltered windows',()=>{
  const hidden=[event('uncontested1',1,1.25,70),event('uncontested2',1.25,1.55,70),
    event('higher',3,3.5,80),event('sung',3,3.5,65),event('higher-later',100,100.5,80),event('lower-later',100,100.5,67)];
  const frames=Array.from({length:47},(_,i)=>({second:3.02+i*.01,pitch:65}));
  const prepared=muSourceVariants({notes:hidden},{pitchFrames:frames});
  const guided=prepared.variants.find(v=>v.id==='vocal-pitch');
  assert.ok(guided);
  assert.deepEqual(guided.notes.map(n=>n.eventId),['uncontested1','uncontested2','sung','higher-later']);
  assert.ok(muWindowResult(prepared,{from:2,to:4},0,'vocals').variants.some(v=>v.id==='vocal-pitch'));
  assert.ok(!muWindowResult(prepared,{from:97,to:101},0,'vocals').variants.some(v=>v.id==='vocal-pitch'));
  assert.equal(muSourceVariants({notes:hidden},{pitchFrames:[{second:2,pitch:65}]}).variants.length,3);
  assert.equal(muSourceVariants({notes:hidden},{pitchFrames:frames.map(f=>({...f,pitch:69}))}).variants.length,3);
  assert.deepEqual(muPitchWindows(muMelodySlots(hidden),{from:0,to:120}).map(w=>w.keepFrom),[2.92,99.92]);
});

test('long overlapping notes request bounded context without assigning a frame to two cores',()=>{
  const slots=muMelodySlots([event('low',0,70,60),event('high',0,70,72)]);
  const windows=muPitchWindows(slots,{from:0,to:70});
  assert.deepEqual(windows.map(w=>[w.keepFrom,w.keepTo]),[[0,24],[24,48],[48,70]]);
  assert.ok(windows.every(w=>w.to-w.from<=27&&w.from>=0&&w.to<=70));
});

test('manual cached vocal reprocessing reports stale backend and keeps the active draft on failure or no change',async()=>{
  const h=await harness(),s=h.state,section={id:'voice',name:'人声',source:'vocals',audioStart:5,audioEnd:15};
  const original={id:'original-vocal',sectionId:section.id,source:'vocals',model:MU_CANDIDATE_MODEL,analysisId:'a'.repeat(64),
    analysisStart:0,analysisEnd:15,audioStart:5,audioEnd:15,notes:[{id:'before',start:7,duration:.5,midi:72}],method:'MuScriptor · 连续旋律'};
  const other={...original,id:'other-analysis',analysisId:'b'.repeat(64)};
  const before=[original,other],callbacks=new Map(),toasts=[];
  const raw=[event('higher',7,7.5,72),event('sung',7,7.5,64)];
  let state='old',saves=0;
  Object.assign(s,{localDraftBase:base(),localDraftVariants:before,localDraftSections:[section],
    selectedDraftVariants:new Map([[section.id,original.id]]),currentDraftSection:()=>section,
    isMuCandidate,isMuTrackCandidate,sectionBeats,replaceSectionCandidate,muMelodySlots,muPitchWindows,
    on:(id,type,fn)=>callbacks.set(id,fn),toast:message=>toasts.push(message),stopDraftPlayback(){},savePendingDraft(){saves++;},
    fetch:async (url,request)=>url.includes('/pitch?')?(state==='old'
      ?{ok:false,json:async()=>({error:'不支持的实验音高引擎'})}
      :{ok:true,json:async()=>({externalEngine:'dual',externalFrames:state==='silent'?[]:Array.from({length:40},(_,i)=>({second:7.02-request.body.from+i*.01,pitch:64}))})})
      :{ok:true,json:async()=>({duration:15,notes:raw})},
    draftMuVocalInput:async()=>({buffer:{duration:15},origin:0}),selectedCompute:()=>({mode:'standard'}),
  });
  h.controls.set('draftSectionSelect',{value:section.id});h.controls.set('localDraftDialog',new EventTarget());
  vm.runInContext(h.source.slice(h.source.indexOf('const muPitchCache='),h.source.indexOf('async function loadMuSource(')),s);
  vm.runInContext(h.source.slice(h.source.indexOf('async function readDraftMuPitch('),h.source.indexOf('async function createGuidedDraftMuTrack(')),s);
  vm.runInContext(h.source.slice(h.source.indexOf("on('rebuildMuCandidates'"),h.source.indexOf("on('selectMuAll'")),s);
  const click=callbacks.get('rebuildMuCandidates');
  await assert.rejects(click(),/后台版本较旧/);
  assert.equal(s.localDraftVariants,before);assert.equal(saves,0);
  state='silent';
  await click();
  assert.equal(s.localDraftVariants,before);assert.equal(saves,0);
  assert.match(toasts.pop(),/没有改变/);
  // Use a fresh decoded buffer so a previous analysis of silence does not occupy the test cache.
  state='corrected';
  await click();
  assert.equal(saves,1);
  const current=s.localDraftVariants.find(v=>v.id===s.selectedDraftVariants.get(section.id));
  assert.match(current.method,/人声音高校正/);
  assert.equal(current.notes[0].midi,64);
  assert.equal(s.localDraftVariants.find(v=>v.id===other.id),other);
  assert.ok(s.localDraftVariants.some(v=>v.id===original.id&&v.method.includes('整理前备份')));
});
