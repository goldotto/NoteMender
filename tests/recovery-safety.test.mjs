import {appText} from '../public/app-i18n.mjs';
import {tr} from '../public/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {makeDemo,validateProject} from '../public/music.mjs';

const code=await readFile(new URL('../public/app.mjs',import.meta.url),'utf8');
const key='jianpu-studio-pending-candidate-v1';
const project=()=>validateProject({...makeDemo(),sections:[{id:'all',name:'整曲',audioStart:0,audioEnd:60,source:'original'}]});
const snapshot=()=>({version:1,draft:project(),base:project(),comparison:project(),sections:project().sections,variants:[],selected:[]});
function candidateHarness(value,{fetch=async()=>({ok:true,json:async()=>snapshot()})}={}){
  let stored=value===undefined?JSON.stringify({version:1,url:'/exports/candidate.json'}):value;
  const controls=new Map(),get=id=>{if(!controls.has(id))controls.set(id,{disabled:false,open:false,textContent:'',replaceChildren(){},close(){this.open=false;}});return controls.get(id);};
  const state={appText,tr,PENDING_DRAFT_KEY:key,pendingDraftMemory:null,pendingDraftMeta:null,pendingDraftSaved:false,pendingDraftError:'',restoringDraft:false,
    localDraft:null,localDraftBase:null,localDraftRange:null,localDraftSections:[],localDraftVariants:[],selectedDraftVariants:new Map(),
    draftComparisonProject:null,draftNewSong:false,draftShouldPersist:false,localDraftLabel:'',lastAudit:null,lastAuditId:null,
    draftSelectedNoteId:null,draftSeekPosition:null,draftAuditionRange:null,draftIssueLoop:false,job:null,lyricsTask:null,token:'',audioUnloaded:false,
    localStorage:{getItem:()=>stored,setItem:(_,value)=>{stored=value;},removeItem:()=>{stored=null;}},
    fetch,AbortSignal,validateProject,isExportPath:value=>/^\/exports\/[\w.-]+\.json$/.test(value),
    $:get,Option:function(name,id){this.name=name;this.id=id;},runtimeDiagnostics:{error(){state.errors++;}},errors:0,
    renderDraftSection(){state.renders++;},renders:0,stopDraftPlayback(){},render(){},toast(){},
    requestCleanup:(_title,_message,action)=>{state.confirm=action;}};
  const context=vm.createContext(state);
  vm.runInContext(code.slice(code.indexOf('function updatePendingDraftBar()'),code.indexOf('let pendingCleanup=null;')),context);
  return {state,get,stored:()=>stored};
}

test('temporary disk fetch failure keeps candidate index visible, then retry restores it',async()=>{
  let ready=false;const h=candidateHarness(undefined,{fetch:async()=>({ok:ready,json:async()=>snapshot()})}),prior=h.stored();
  assert.equal(await h.state.restorePendingCandidate(),false);assert.equal(h.stored(),prior);
  assert.equal(h.get('pendingCandidateBar').hidden,false);assert.match(h.get('pendingCandidateStatus').textContent,/原恢复记录已保留/);
  assert.equal(h.get('resumeCandidate').disabled,false);assert.equal(h.get('discardCandidate').disabled,false);
  ready=true;assert.equal(await h.state.restorePendingCandidate(),true);assert.ok(h.state.localDraft);
  assert.equal(h.state.pendingDraftError,'');assert.equal(h.state.pendingDraftSaved,true);assert.equal(h.state.renders,1);
});

test('corrupt JSON, fetch rejection and timeout retain recovery entry and allow explicit deletion',async()=>{
  for(const h of [candidateHarness('{broken'),candidateHarness(undefined,{fetch:async()=>{throw Error('offline');}}),candidateHarness(undefined,{fetch:async()=>{const error=Error('timeout');error.name='TimeoutError';throw error;}})]){
    const prior=h.stored();assert.equal(await h.state.restorePendingCandidate(),false);assert.equal(h.stored(),prior);
    h.state.discardCurrentCandidate();assert.equal(h.stored(),prior);assert.equal(typeof h.state.confirm,'function');
    h.state.confirm();assert.equal(h.stored(),null);assert.equal(h.get('pendingCandidateBar').hidden,true);
  }
});

test('validate complete snapshot before replacing any live candidate state',()=>{
  const mutations=[s=>s.base={version:9},s=>s.comparison=null,s=>s.selected=[null],s=>s.selected=[['all','missing']],s=>s.sections=[null]];
  for(const mutate of mutations){const h=candidateHarness(),old=project(),s=snapshot();h.state.localDraft=old;h.state.localDraftBase=old;mutate(s);
    assert.throws(()=>h.state.loadPendingDraft(s));assert.equal(h.state.localDraft,old);assert.equal(h.state.localDraftBase,old);
    assert.equal(h.state.pendingDraftMemory,null);assert.equal(h.state.renders,0);
  }
});

test('successful legacy inline candidate recovers notes, selections and sections together',async()=>{
  const s=snapshot();s.variants=[{id:'alternative',sectionId:'all',notes:s.draft.notes,method:'Basic Pitch'}];s.selected=[['all','alternative']];
  const h=candidateHarness(JSON.stringify(s));assert.equal(await h.state.restorePendingCandidate(),true);
  assert.equal(h.state.localDraft.notes.length,s.draft.notes.length);assert.equal(h.state.selectedDraftVariants.get('all'),'alternative');
  assert.equal(h.state.localDraftVariants[0].method,'Basic Pitch');assert.equal(h.state.localDraftSections[0].audioEnd,60);
});

test('late candidate read never replaces a newly generated candidate, cleared index or running analysis',async()=>{
  for(const change of [h=>{h.state.pendingDraftMemory=snapshot();},h=>h.state.localStorage.removeItem(key),h=>{h.state.job={};}]){
    let release;const gate=new Promise(resolve=>{release=resolve;});const h=candidateHarness(undefined,{fetch:()=>gate});
    const restoring=h.state.restorePendingCandidate();await assert.rejects(h.state.restorePendingCandidate(),/正在恢复/);
    change(h);release({ok:true,json:async()=>snapshot()});assert.equal(await restoring,false);assert.equal(h.state.renders,0);
  }
});

test('startup uses recoverable restore path rather than removing its persisted index on error',()=>{
  const end=code.indexOf('const editorStartupReady='),start=code.lastIndexOf('render();drawWave();',end);
  assert.ok(start>=0&&end>start,'startup boundaries must be present');
  const startup=code.slice(start,end);
  assert.match(startup,/await restorePendingCandidate\(\)/);assert.doesNotMatch(startup,/removeItem\(PENDING_DRAFT_KEY/);
});

function projectHarness({changeAt=null,kind='backup',approve=true,savedInPreview=false}={}){
  const current=project(),restored={...project(),title:'恢复谱'},controls={backupSelect:{value:'0'},backupDialog:{close(){}},playMode:{value:'original'}},handlers={};
  const change=stage=>{if(changeAt===stage)state.project={...current,title:'用户刚修改的谱'};};
  const state={appText,tr,project:current,job:null,lyricsTask:null,scorePending:false,lyricsPreview:null,lyricSelection:null,lastRaw:null,
    $:id=>controls[id],on:(id,_event,fn)=>{handlers[id]=fn;},saveProject(){},localStorage:{},listBackups:()=>[{}],
    validateProject,readBackup:async()=>{change('read');return restored;},readProjectFile:async()=>{change('read');return restored;},
    confirmEntryDiscard:async()=>{change('confirm');return savedInPreview?{project:state.project}:approve;},backupProject:async()=>{change('backup');},
    commit:next=>{state.commits++;state.project=next;},commits:0,restoreResources:async p=>{state.audio=p;},
    rememberProjectName(){},importedProjectStem:()=>'',toast(){}};
  const context=vm.createContext(state),start=code.indexOf('function requireUnchangedProject('),end=code.indexOf('\nfunction commit(',start);
  vm.runInContext(code.slice(start,end),context);
  if(kind==='file')vm.runInContext(code.split('\n').find(line=>line.startsWith("on('saveProject','click',saveProject);")),context);
  return {state,current,restored,run:()=>handlers[kind==='file'?'projectFile':'restoreBackup']({target:{files:[{name:'sample.json'}],value:'sample'}})};
}

test('backup and file open reject stale read/confirmation/backup results without losing new edits',async()=>{
  for(const kind of ['backup','file'])for(const changeAt of kind==='backup'?['read','confirm','backup']:['read','confirm']){
    const h=projectHarness({kind,changeAt});await assert.rejects(h.run(),/工程或任务已改变/);
    assert.equal(h.state.commits,0);assert.equal(h.state.project.title,'用户刚修改的谱');assert.equal(h.state.audio,undefined);
  }
});

test('backup and file open restore matching original resources; cancellation leaves state alone',async()=>{
  for(const kind of ['backup','file']){
    const h=projectHarness({kind});await h.run();assert.equal(h.state.commits,1);assert.deepEqual(h.state.audio,h.restored);
    const cancelled=projectHarness({kind,approve:false});await cancelled.run();assert.equal(cancelled.state.project,cancelled.current);assert.equal(cancelled.state.commits,0);
  }
});

test('explicitly saved floating-window text establishes a new checkpoint before loading a project',async()=>{
  for(const kind of ['backup','file']){
    const h=projectHarness({kind,changeAt:'confirm',savedInPreview:true});
    await h.run();assert.equal(h.state.commits,1);assert.deepEqual(h.state.audio,h.restored);
  }
});
