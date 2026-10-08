import {listBackups,saveBackup,readBackup} from './project-backups.mjs';
import {createComponentManager,applyComponentAvailability} from './components-ui.mjs';
import {transcriptionTempo} from './tempo-fallback.mjs';
import {ProjectAudioRestore} from './project-audio.mjs';
import {exportName,importedProjectStem,isExportPath} from './export-name.mjs';
import {splitNotesByLyrics} from './lyric-note-split.mjs';
import {SHORTCUTS,shortcutAction} from './shortcuts.mjs';
import {associatedGroup,retimeAssociated,moveAssociatedLyrics} from './linked-edit.mjs';
import {linkedPreviewSVG} from './linked-preview.mjs';
import {CONTROL_HELP} from './help-content.mjs';
import {installHelp} from './help-ui.mjs';
import {readProjectFile,projectText,parseProjectText} from './project-file.mjs';
import {copyLyrics,pasteLyrics,shiftLyrics} from './lyric-clipboard.mjs';
import {lyricSegmentationCandidates,useLyricSinging,linkRawLyrics,lyricsAfterQuantization,lyricPhrase,splitLyricWord,mergeLyricWords} from './lyric-assist.mjs';
import {candidateSchemeHelp} from './scheme-guide.mjs';
import {alignmentLanguage,textLanguage} from './lyric-language.mjs';
import {timelineLyrics,retimeLyric} from './lyric-score.mjs';
import {lyricRanges} from './lyric-ranges.mjs';
import {scoreCursorPosition} from './score-cursor.mjs';
import {assignNoteLyrics,replaceLyricText,setNoteLyricText,selectedLyricText} from './manual-lyrics.mjs';
import {compactInspector} from './editor-ui.mjs';
import {chooseNotes,combineSelection,continuousSelection} from './selection.mjs';
import {validSpeed,clockPosition,noteSchedule} from './play-clock.mjs';
import {createAudioPlayback,prepareAudioPlayback} from './slow-playback.mjs';
import {normalizeLyrics,matchLyrics,wordsFromSegments,stableWordsFromSegments,importLyrics,lyricLabels,withOrphanLyrics} from './lyrics.mjs';
import {KEYS,EDIT_STEP,keyAt,clamp,snap,uid,escapeXML,pitchName,numberPitch,validateProject,transpose,shiftAllNotes,estimateKey,quantizeNotes,scoreSVG,freeScoreSVG,midiFile,makeDemo,barLength} from './music.mjs';
import {monoSamples,wavBytes,toDataURL,synthNote,renderWav,stereoWav} from './audio.mjs';
import {parseBar,parseFreeNotes,formatBar,replaceRange,expandToSong} from './note-input.mjs';
import {timeAtBeat,beatAtTime,makeTimeAnchors,quantizeTimed} from './time-map.mjs';
import {automaticSpans} from './segmentation.mjs';
import {analysisWindows,mergeAnalysisUsed,stitchNotes,chooseQuantization,modeName} from './adaptive-strategy.mjs';
import {integratePartialCandidates} from './partial-candidates.mjs';
import {replaceSectionCandidate} from './local-candidates.mjs';
import {projectFromMidiTrack} from './midi-candidate.mjs';
import {sectionSeconds,sectionBeats,validateSectionRange,shiftSelectedNotes} from './sections.mjs';
import {copyNotes,pasteNotes,splitNoteAt} from './note-clipboard.mjs';
import {durationReviewNotes,mergeSelectedNotes,shortSamePitchRuns,mergeShortSamePitchRuns} from './manual-timing.mjs';
import {followedWaveStart} from './wave-view.mjs';
import {activeFragment,conflictText,selectedIssues,preservePrimary,signalRms,hasTrackContent,restorableAudioProject} from './candidate-tools.mjs';
import {draftScoreWindow} from './draft-preview.mjs';
import {stitchEvidence,ownEvents,shiftEvidence,quantizationEvidence,EVIDENCE_VERSION,sourceLabel} from './recognition-evidence.mjs';
import {analysisKeys,baseEvidence,loadAnalysis,saveAnalysis} from './analysis-cache.mjs';
import {normalizeCompute,resolveCompute,computeQuery} from './compute-settings.mjs';
let bass=null,drums=null,instrumental=null,analysisWarnings=[],auditWindows=[],lastAuditId=null,draftIssueLoop=false;
let stemExecution='standard:cpu:0',stemFingerprint='legacy-cpu',stemCompute=null,computeStatus=null;
const pipelineOptions=()=>({pipeline:$('recognitionProfile').value,ablation:$('recognitionAblation').value});
const joinWindowNotes=events=>{
  const decisions=job?.stitchDecisions||[];
  if($('recognitionProfile').value!=='legacy')return stitchEvidence(events,decisions);
  const joined=stitchNotes(events);
  for(const n of events)if(joined.some(q=>q.midi===n.midi&&q.start<n.start-1e-6&&q.end>=n.end-1e-6))decisions.push({kind:'连续同音合并（现版）',second:n.start,end:n.end,midi:n.midi,reason:'同音且间隔约 80 毫秒以内'});
  return joined;
};
const $=id=>document.getElementById(id),on=(id,event,fn)=>$(id).addEventListener(event,async e=>{try{await fn(e);}catch(err){if(err.name!=='AbortError')toast(err.message,true);}});

const LINKED_EDIT_KEY='jianpu-linked-editing-v2';
let linkedEditing=false;
try{linkedEditing=localStorage.getItem(LINKED_EDIT_KEY)==='true';}catch{}
const linkedActive=()=>linkedEditing&&lyricsPreview===null&&!scorePending&&!transcribing;
function renderLinkedStatus(){
  for(const id of ['linkedEditing','lyricsLinkedEditing','inlineLinkedEditing'])$(id).checked=linkedEditing;
  const group=associatedGroup(project,{noteIds:[...chosenIds()],lyricIds:lyricSelection?[lyricSelection]:[]});
  const text=lyricsPreview!==null?'歌词预览尚未采用，当前独立编辑。':!linkedEditing?'独立编辑：仅修改拖动的一方。':group.lyricIds.size?`当前对应组：${group.noteIds.size} 音 · ${group.lyricIds.size} 字词，一起移动；调整长短只改一方。`:'联动已开启；关联字词与音符后，一起移动；调整长短只改一方。';
  for(const id of ['linkedGroupInfo','lyricsLinkedGroupInfo','inlineLinkedGroupInfo'])$(id).textContent=text;
}
for(const id of ['linkedEditing','lyricsLinkedEditing','inlineLinkedEditing'])on(id,'change',e=>{linkedEditing=e.target.checked;try{localStorage.setItem(LINKED_EDIT_KEY,String(linkedEditing));}catch{}renderLinkedStatus();});

const COMPUTE_KEY='jianpu-compute-v1';
try{const saved=normalizeCompute(JSON.parse(localStorage.getItem(COMPUTE_KEY)||'{}'));$('computeMode').value=saved.mode;$('computeDevice').value=saved.device;$('computeThreads').value=saved.threads;}catch{}
const selectedCompute=()=>normalizeCompute({mode:$('computeMode').value,device:$('computeDevice').value,threads:$('computeThreads').value},computeStatus?.logicalCores||1024);
function renderCompute(){
  $('computeAdvanced').hidden=$('computeMode').value!=='performance';
  if($('computeMode').value==='standard'){$('computeState').textContent='当前模式使用现有 CPU 链路。';return;}
  const execution=resolveCompute(selectedCompute(),computeStatus||{}),names={'tfjs-cpu':'当前 CPU 后端','onnx-cpu':'原生 CPU','onnx-cuda':'NVIDIA 显卡'};
  $('computeState').textContent=`Basic Pitch：${names[execution.basicBackend]} · 分轨：${execution.separationBackend==='cuda'?'NVIDIA 显卡':'CPU'} · CREPE：${execution.pitchBackend==='cuda'?'NVIDIA 显卡':'CPU'}${computeStatus?.gpuName?' · '+computeStatus.gpuName:''}。${execution.reasons.join('；')}`;
  if(computeStatus?.logicalCores)$('computeThreads').max=computeStatus.logicalCores;
}
async function refreshCompute(signal,force=false){
  const response=await fetch('/api/compute/status'+(force?'?refresh=1':''),{headers:{'X-Studio-Token':token},signal});
  if(!response.ok)throw Error((await response.json()).error||'加速环境检查失败');
  computeStatus=await response.json();renderCompute();return computeStatus;
}
async function prepareCompute(task){
  const settings=selectedCompute();
  if(settings.mode==='performance')try{await refreshCompute(task.controller.signal);}catch(error){if(task.cancelled)throw error;computeStatus=null;analysisWarnings.push(error.message);}
  task.execution=Object.freeze(resolveCompute(settings,computeStatus||{}));task.computeTimes={separationMs:0,tempoMs:0};
  $('computeTiming').textContent='';renderCompute();
}
function showComputeTimes(task){
  const computations=auditWindows.filter(w=>!w.cacheHit).flatMap(w=>w.compute?.records||[]),inference=computations.reduce((sum,x)=>sum+(x.inferenceMs||0),0),load=computations.reduce((sum,x)=>sum+(x.loadMs||0),0);
  task.computeTimes={...task.computeTimes,inferenceMs:inference,modelLoadMs:load,otherMs:Math.max(0,performance.now()-task.started-(task.computeTimes.separationMs||0)-(task.computeTimes.tempoMs||0)-(task.computeTimes.lyricsMs||0)-(task.computeTimes.singingMs||0)-inference-load),totalMs:performance.now()-task.started};
  const devices=[...new Set(auditWindows.map(w=>w.compute?.backend||w.parameters?.execution?.basicBackend).filter(Boolean))];
  const separationDevice=task.separationCompute?.device;
  if(separationDevice)$('computeState').textContent=`本次 Basic Pitch：${devices.join('／')||task.execution?.basicBackend} · 分轨：${separationDevice==='cuda'?'NVIDIA 显卡':'CPU'}${task.separationCompute.spectralDevice==='cpu'&&separationDevice==='cuda'?'（频谱变换使用 CPU）':''}。${task.separationCompute.fallbacks?.join('；')||''}`;
  $('computeTiming').textContent=`本次 ${devices.join('／')||task.execution?.basicBackend||'CPU'} · 总计 ${(task.computeTimes.totalMs/1000).toFixed(1)} 秒 · 分轨 ${(task.computeTimes.separationMs/1000).toFixed(1)} 秒 · 节拍 ${(task.computeTimes.tempoMs/1000).toFixed(1)} 秒${computations.length?` · 模型加载 ${(load/1000).toFixed(1)} 秒 · 推理 ${(inference/1000).toFixed(1)} 秒 · 其他处理 ${(task.computeTimes.otherMs/1000).toFixed(1)} 秒`:''}${task.computeTimes.lyricsMs?' · 歌词 '+(task.computeTimes.lyricsMs/1000).toFixed(1)+' 秒':''}${task.computeTimes.singingMs?' · 人声精细分音 '+(task.computeTimes.singingMs/1000).toFixed(1)+' 秒':''} · ${auditWindows.filter(w=>w.cacheHit).length} 个窗口命中缓存`;
}
for(const id of ['computeMode','computeDevice','computeThreads'])on(id,'change',async()=>{localStorage.setItem(COMPUTE_KEY,JSON.stringify(selectedCompute()));renderCompute();if(!job&&$('computeMode').value==='performance')await refreshCompute();});
on('computeThreads','input',()=>{try{localStorage.setItem(COMPUTE_KEY,JSON.stringify(selectedCompute()));}catch{}});
on('refreshCompute','click',async()=>{if(job){toast('当前任务完成后再刷新环境；设置已保留供下一次任务使用。');return;}await refreshCompute(undefined,true);});
renderCompute();
compactInspector();
const noteMeasureContext=document.createElement('canvas').getContext('2d');noteMeasureContext.font='600 20px Georgia';
let project=makeDemo(),selected=null,undo=[],redo=[],original=null,vocals=null,other=null,token='',worker=null,job=null,dirty=false,toastTimer,importedMidi=null,importedMidiName='',lastRaw=null,lastAudit=null,localDraft=null,localDraftBase=null,localDraftRange=null,localDraftLabel='本机候选',localDraftSections=[],localDraftVariants=[],selectedDraftVariants=new Map(),draftComparisonProject=null,draftNewSong=false,draftShouldPersist=false,pendingDraftSaved=false,pendingDraftMemory=null,pendingDraftMeta=null;
let ctx,playing=false,playStarting=false,mainPlaybackSerial=0,playPosition=0,playStarted=0,playOrigin=0,playEnd=0,playNodes=[],timer=null;
let sourceRevision=0,playingNoteId=null;
let barLoop=null;
let noteLoop=null;
let scorePending=false,transcribing=false,loadedAudioName='',bpmManuallySet=false,tempoCache=null;
let scoreZoom=8,scorePixelZoom=180,scoreBeatsPerRow=8,selectedGap=null,noteDrag=null,suppressScoreClick=false,lastScoreWidth=0;
let zoomFrame=null;
const zoomSliderBeats=value=>Math.max(1,Math.min(16,snap(16*2**(-4*Number(value)/1000),EDIT_STEP)));
const beatsZoomSlider=beats=>Math.round(Math.log2(16/beats)*250);
let selectedIds=new Set(),marqueeMode=false,marqueeDrag=null,selectedSectionId=null,sectionDrag=null,sectionViewStart=0,sectionViewSeconds=40;
let lyricClipboard=null,clipboardKind='notes',selectedLyricIds=new Set(),lyricAnchor=null;
let noteClipboard=null,selectionAnchor=null,pendingMerge=null,marqueeFrame=null;
let playbackSpeed=validSpeed(localStorage.getItem('jianpu-playback-speed')||1),mainClock=null,lyricsOpen=false,lyricSelection=null,lyricsPreview=null,lyricsTask=null,lyricDrag=null,lyricPopupOpen=false,lyricLinking=false; 
const chosenIds=()=>new Set(selectedIds.size?selectedIds:selected?[selected]:[]);
const selectionSnapshot=()=>({selected,ids:[...selectedIds],gap:selectedGap,anchor:selectionAnchor});
const historySnapshot=()=>({audio:captureAudioState(),project:structuredClone(project),selection:selectionSnapshot(),lyricSelection,lyricIds:[...selectedLyricIds],lyricsPreview:lyricsPreview===null?null:structuredClone(lyricsPreview)});
let waveZoom=1,waveViewStart=0,audioUnloaded=localStorage.getItem('jianpu-audio-unloaded')==='true';
let draftBeatsPerRow=8,draftPlayback=null,draftPlaybackSerial=0,draftFollow=true,draftAutoScroll=false;
let audioResources=[],resourceBuffers=new Map(),instrumentContext=null,singingReady=false;
const PENDING_DRAFT_KEY='jianpu-studio-pending-candidate-v1';
try{const saved=localStorage.getItem('jianpu-studio-v1');if(saved)project=validateProject(JSON.parse(saved));}catch{}
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?8500:4200);}
function persist(){try{localStorage.setItem('jianpu-studio-v1',JSON.stringify(project));$('saveState').textContent='已自动保存到此浏览器';dirty=false;}catch{$('saveState').textContent='自动保存失败，请保存工程';dirty=true;}}
async function backupProject(){
  await saveBackup(localStorage,project,async(snapshot,at)=>{
    const name=exportName('备份-'+at.replace(/[:.]/g,'-')+'-'+snapshot.title,'json');
    const response=await fetch('/api/export-file?name='+encodeURIComponent(name),{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:projectText(snapshot)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'本机备份失败；候选仍保留');
    if(!isExportPath(result.url))throw Error('备份地址无效');return result.url;
  });
}
function updatePendingDraftBar(){
  for(const id of ['discardCandidate','discardDialogCandidate'])$(id).disabled=!localDraft||Boolean(job)||Boolean(lyricsTask);
  $('pendingCandidateBar').hidden=!pendingDraftMeta||$('localDraftDialog').open;
  if(pendingDraftMeta)$('pendingCandidateStatus').textContent=`${pendingDraftMeta.title} · ${pendingDraftMeta.notes} 音 · ${pendingDraftSaved?'已在本机保存，关闭页面后可恢复':'仅当前页面暂存，请勿刷新'}`;
}
function capturePendingDraft(){
  return {version:1,createdAt:pendingDraftMeta?.createdAt||Date.now(),draft:{...localDraft,alternates:undefined},base:{...localDraftBase,alternates:undefined},comparison:draftComparisonProject,newSong:draftNewSong,sections:localDraftSections,variants:localDraftVariants,selected:[...selectedDraftVariants],label:localDraftLabel,summary:$('localDraftSummary').textContent,sectionSummary:$('localDraftSections').textContent,auditId:lastAuditId};
}
function savePendingDraft(){
  if(!draftShouldPersist||!localDraft)return;
  const snapshot=capturePendingDraft();pendingDraftMemory=snapshot;
  pendingDraftMeta={createdAt:snapshot.createdAt,title:localDraft.title,notes:localDraft.notes.length};
  try{localStorage.setItem(PENDING_DRAFT_KEY,JSON.stringify(snapshot));pendingDraftSaved=true;}
  catch{pendingDraftSaved=false;savePendingOnDisk(snapshot).catch(error=>{if(pendingDraftMemory===snapshot)toast('候选仅当前页面暂存：'+error.message,true);});}
  updatePendingDraftBar();
}
async function savePendingOnDisk(snapshot){
  const response=await fetch('/api/export-file?name='+encodeURIComponent('候选-'+crypto.randomUUID()+'.json'),{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'本机保存失败');
  if(!isExportPath(result.url))throw Error('候选地址无效');
  if(pendingDraftMemory!==snapshot)return;
  localStorage.setItem(PENDING_DRAFT_KEY,JSON.stringify({version:1,url:result.url}));pendingDraftSaved=true;updatePendingDraftBar();
}
async function readPendingSnapshot(value){
  if(!value?.url)return value;
  if(!isExportPath(value.url))throw Error('候选地址无效');
  const response=await fetch(value.url);if(!response.ok)throw Error('本机候选文件缺失');return response.json();
}
function loadPendingDraft(snapshot){
  if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.sections)||!snapshot.sections.length)throw Error('暂存候选已损坏');
  localDraft=validateProject({...snapshot.draft,alternates:snapshot.variants||snapshot.draft.alternates});localDraftBase=validateProject({...snapshot.base,alternates:snapshot.variants||snapshot.base.alternates});draftComparisonProject=validateProject(snapshot.comparison);
  draftNewSong=Boolean(snapshot.newSong);draftShouldPersist=true;localDraftSections=snapshot.sections;localDraftVariants=Array.isArray(snapshot.variants)?snapshot.variants:[];
  selectedDraftVariants=new Map(Array.isArray(snapshot.selected)?snapshot.selected:[]);localDraftLabel=String(snapshot.label||'本机候选');lastAudit=snapshot.audit||null;lastAuditId=snapshot.auditId||null;
  $('localDraftSummary').textContent=String(snapshot.summary||'已恢复候选谱。');$('localDraftSections').textContent=String(snapshot.sectionSummary||'');
  $('draftSectionSelect').replaceChildren(...localDraftSections.map(s=>new Option(s.name,s.id)));
  pendingDraftMemory=snapshot;pendingDraftMeta={createdAt:snapshot.createdAt||Date.now(),title:localDraft.title,notes:localDraft.notes.length};
  renderDraftSection(localDraftSections[0]);if(token&&!audioUnloaded)restoreResources(restorableAudioProject(project,localDraft));updatePendingDraftBar();
}
function clearPendingDraft(){
  try{localStorage.removeItem(PENDING_DRAFT_KEY);}catch{}
  pendingDraftMemory=null;pendingDraftMeta=null;pendingDraftSaved=false;updatePendingDraftBar();
}
function discardCurrentCandidate(confirmed=false){
  if(job||lyricsTask)throw Error('请先取消正在运行的分析');
  if(!localDraft)return;
  if(!confirmed)return requestCleanup('删除候选谱','删除浏览器中尚未采用的候选谱？正式谱与原音保留，本机已保存的文件不会删除。',()=>discardCurrentCandidate(true));
  stopDraftPlayback();draftShouldPersist=false;clearPendingDraft();
  localDraft=null;localDraftBase=null;localDraftRange=null;localDraftSections=[];localDraftVariants=[];selectedDraftVariants.clear();draftComparisonProject=null;draftNewSong=false;draftIssueLoop=false;
  $('localDraftScore').replaceChildren();if($('localDraftDialog').open)$('localDraftDialog').close();render();toast('当前候选已删除。');
}
let pendingCleanup=null;
function requestCleanup(title,message,action){pendingCleanup=action;$('cleanupTitle').textContent=title;$('cleanupMessage').textContent=message;$('cleanupDialog').showModal();}
on('cleanupConfirm','click',()=>{const action=pendingCleanup;pendingCleanup=null;$('cleanupDialog').close();action?.();});
on('cleanupCancel','click',()=>$('cleanupDialog').close());
$('cleanupDialog').addEventListener('close',()=>pendingCleanup=null);
for(const id of ['discardCandidate','discardDialogCandidate'])on(id,'click',()=>discardCurrentCandidate());
function unloadCurrentAudio(confirmed=false){
  if(job||lyricsTask)throw Error('请先取消正在运行的分析');if(!original)return;
  if(!confirmed)return requestCleanup('卸载当前音频','卸载当前原音与分离音轨？音符、歌词及候选谱保留，可重新导入音频；不会删除电脑上的文件。',()=>unloadCurrentAudio(true));
  stopDraftPlayback();stopPlayback();audioRestorer.invalidate();
  original=vocals=other=bass=drums=instrumental=null;loadedAudioName='';resourceBuffers.clear();instrumentContext=null;sourceRevision++;tempoCache=null;waveZoom=1;waveViewStart=0;sectionViewStart=0;scorePending=false;stemCompute=null;
  audioUnloaded=true;localStorage.setItem('jianpu-audio-unloaded','true');commit({...project,audioResources:[]});audioResources=[];$('audioFile').value='';$('playMode').value='synth';syncAudioUI();
  if(localDraftRange)$('playDraftOriginal').disabled=true;for(const id of ['playDraftStem','playDraftDrums'])$(id).disabled=true;
  toast('音频已卸载，谱子和歌词仍可编辑。');
}
on('unloadAudio','click',()=>unloadCurrentAudio());
on('resumeCandidate','click',async()=>{
  const snapshot=pendingDraftMemory||await readPendingSnapshot(JSON.parse(localStorage.getItem(PENDING_DRAFT_KEY)||'null'));
  if(!snapshot)throw Error('没有可恢复的候选谱');loadPendingDraft(snapshot);if(lastAuditId)try{const r=await fetch('/api/analysis/audits/'+lastAuditId,{headers:{'X-Studio-Token':token}});if(r.ok)lastAudit=await r.json();}catch{}openDraftDialog();renderDraftIssues(localDraftSections[0]);
});
on('backupsBtn','click',()=>{const items=listBackups(localStorage);if(!items.length)throw Error('还没有可恢复的替换前备份');$('backupSelect').replaceChildren(...items.map((x,i)=>new Option(`${new Date(x.at).toLocaleString()} · ${x.project?.title||x.title} · ${x.project?.notes.length??x.notes} 音`,i)));$('backupSelect').value=String(items.length-1);$('backupDialog').showModal();});
on('restoreBackup','click',async()=>{const items=listBackups(localStorage),item=items[Number($('backupSelect').value)];const restored=await readBackup(item,async url=>{if(!isExportPath(url))throw Error('备份地址无效');const response=await fetch(url);if(!response.ok)throw Error('本机备份文件缺失，请重新打开已保存的工程');return parseProjectText(await response.text());});await backupProject();scorePending=false;lyricsPreview=null;commit(restored,{resetLyrics:true});$('backupDialog').close();toast('已恢复工程备份；原曲音频需与恢复的谱面对应。');});
function commit(next,{keepPlayback=false,resetLyrics=false}={}){const checked=validateProject(resetLyrics?next:withOrphanLyrics(project,next)),resume=keepPlayback&&playing;stopPlayback(!keepPlayback);undo.push(historySnapshot());if(undo.length>80)undo.shift();redo=[];project=checked;selectedGap=null;if(!project.notes.some(n=>n.id===selected))selected=null;selectedIds=new Set([...selectedIds].filter(id=>project.notes.some(n=>n.id===id)));if(!project.sections?.some(s=>s.id===selectedSectionId))selectedSectionId=null;persist();render();if(resume)play({continueLoop:true}).catch(err=>toast(err.message,true));}
function updateNote(changes,{linkedMove=changes.start!==undefined&&changes.duration===undefined}={}){
  const n=currentNote();if(!n)return;let next=project;
  if(linkedActive()&&linkedMove){
    const start=changes.start??n.start,duration=changes.duration??n.duration;
    next=retimeAssociated(project,{kind:'note',id:n.id,start,end:start+duration,maxSeconds:original?.duration||3600}).project;
  }
  commit({...next,notes:next.notes.map(x=>x.id===n.id?{...x,...changes,reviewStatus:'reviewed'}:x)},{keepPlayback:true});
}
const currentNote=()=>project.notes.find(n=>n.id===selected);
const scoreSecond=beat=>timeAtBeat(project,beat)-project.offset;
const scoreBeat=seconds=>beatAtTime(project,seconds+project.offset);
const playbackBuffer=mode=>({vocals,other,bass,drums,instrumental})[mode]||(['original','both'].includes(mode)?original:null);
const totalSeconds=()=>{const mode=$('playMode').value,buffer=playbackBuffer(mode);if(buffer&&mode!=='both')return Math.max(1,buffer.duration-(scorePending?0:project.offset));return Math.max(1,scoreSecond((project.notes.at(-1)?.start||0)+(project.notes.at(-1)?.duration||0)));};
const timeText=t=>`${String(Math.floor(Math.max(0,t)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const stem=name=>String(name||'').replace(/\.[^.]+$/,'').trim().toLowerCase();
const diagnosticTime=t=>`${timeText(t)}.${String(Math.floor(Math.max(0,t)*100)%100).padStart(2,'0')}`;
function render(){
  $('unloadAudio').disabled=!original||Boolean(job)||Boolean(lyricsTask);
  for(const id of ['discardCandidate','discardDialogCandidate'])$(id).disabled=!localDraft||Boolean(job)||Boolean(lyricsTask);
  const waiting=scorePending||transcribing;
  $('score').hidden=waiting;$('scorePlaceholder').hidden=!waiting;
  $('showPreviousScore').hidden=transcribing||!scorePending;
  $('scorePlaceholderTitle').textContent=transcribing?'正在生成新简谱':`已导入 ${loadedAudioName||'新音频'}`;
  $('scorePlaceholderDetail').textContent=transcribing?'正在运行本机声学分析；完成后显示可编辑初稿。':'旧谱已收起。点击“生成简谱”开始识别，或查看上一份谱子。';
  const viewport=$('scoreViewport'),style=getComputedStyle(viewport),available=Math.max(320,viewport.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));
  scoreBeatsPerRow=scoreZoom;
  scorePixelZoom=(available-84)/scoreBeatsPerRow;lastScoreWidth=viewport.clientWidth;
  const scoreView=lyricViewProject();
  $('score').innerHTML=waiting?'':project.layout==='barred'?scoreSVG(scoreView,{selected,flats:$('flats').checked}):freeScoreSVG(scoreView,{compactHeader:true,selectedLyric:lyricSelection,selected,selectedIds:[...selectedIds],selectedGap,flats:$('flats').checked,zoom:scorePixelZoom,beatsPerRow:scoreBeatsPerRow,measureText:s=>noteMeasureContext.measureText(s).width});
  if(!waiting){const svg=$('score').querySelector('svg');svg?.insertAdjacentHTML('beforeend','<g id="scorePlaybackCursor" aria-hidden="true" pointer-events="none"><line stroke="#c15139" stroke-width="1.8" vector-effect="non-scaling-stroke"/><path fill="#c15139"/></g>');if(project.layout==='free')$('score').insertAdjacentHTML('beforeend','<div id="marqueeBox" hidden></div>');}
  $('scoreViewport').classList.toggle('marquee-mode',marqueeMode);$('marqueeMode').ariaPressed=String(marqueeMode);$('marqueeMode').disabled=waiting||project.layout==='barred';$('clearSelection').disabled=!selected&&!selectedIds.size&&selectedGap===null;
  $('copyNotes').disabled=waiting||Boolean(job)||(!selected&&!selectedIds.size);$('pasteNotes').disabled=waiting||Boolean(job)||!noteClipboard;
  $('clipboardSummary').textContent=noteClipboard?`已复制 ${noteClipboard.notes.length} 音 · 跨 ${+noteClipboard.span.toFixed(4)} 拍`:'尚未复制音符';
  $('zoomControl').hidden=waiting||project.layout==='barred';$('scoreZoom').value=String(beatsZoomSlider(scoreZoom));$('scoreBeatsInput').value=String(scoreZoom);
  playingNoteId=null;
  $('title').value=scorePending?(loadedAudioName.replace(/\.[^.]+$/,'')||'新歌曲'):project.title;$('bpm').value=project.bpm;$('key').value=project.key;$('meter').value=project.meter;$('layoutMode').value=project.layout||'free';$('barTools').open=project.layout==='barred';$('offset').value=scorePending?0:project.offset;
  $('noteCount').textContent=waiting?'—':project.notes.filter(n=>n.midi!==null).length;$('uncertainCount').textContent=waiting?'—':project.notes.filter(n=>n.reviewStatus!=='reviewed').length;$('engineLabel').textContent=waiting?'等待新简谱':project.engine;
  $('undo').disabled=waiting||!undo.length||Boolean(job);$('redo').disabled=waiting||!redo.length||Boolean(job);$('backupsBtn').disabled=Boolean(job);$('detectTempo').disabled=!original||Boolean(job);
  $('transcribe').disabled=!original||Boolean(job);$('requantize').disabled=!lastRaw||Boolean(job);renderEditor();updateTime();$('lyricAssist').disabled=Boolean(job)||Boolean(lyricsTask);
  $('play').disabled=transcribing;
  $('alignmentStatus').textContent=waiting?'生成后可调整':`${project.timeAnchors?.length||2} 个对齐点；当前播放位置约第 ${Math.max(0,scoreBeat(playPosition)).toFixed(2)} 拍。`;
  for(const id of ['exportBtn','addNote','addRest','insertPitch','insertStart','insertDuration','nextUncertain','title','key','meter','layoutMode','offset','transposeBtn','globalPitchStep','globalPitchDown','globalPitchUp','barNumber','barAtPlayhead','loadBar','loopBar','barInput','freeStart','freeAtPlayhead','freeAtSelection','freeInput','freeApply'])$(id).disabled=waiting;
  renderSections();renderTimingReview();renderSelectionTools();renderLyrics();
}
function timingCandidates(){return durationReviewNotes(project,{shortSeconds:Number($('reviewShortSeconds').value),longSeconds:Number($('reviewLongSeconds').value),kind:$('durationReviewKind').value});}
function renderTimingReview(){
  const waiting=scorePending||transcribing||Boolean(job);let matches=[];
  try{matches=timingCandidates();$('durationReviewSummary').textContent=waiting?'显示简谱后可按时长定位':`符合条件 ${matches.length} 音；这是查找条件，不是错误判定。`;}
  catch(error){$('durationReviewSummary').textContent=error.message;}
  for(const id of ['durationPrevious','durationNext'])$(id).disabled=waiting||!matches.length;
  $('loopSelection').disabled=waiting||(!selected&&!selectedIds.size);
  $('cutAtPlayhead').disabled=waiting||!project.notes.length;
  $('batchMerge').disabled=waiting||!continuousSelection(project.notes,chosenIds());
  let groups=[];try{groups=shortSamePitchRuns(project,Number($('reviewShortSeconds').value));}catch{}
  $('durationSelectAll').disabled=waiting||!matches.length;
  $('durationMergeShort').disabled=waiting||!groups.length;
  $('durationMergeSummary').textContent=`可合并 ${groups.length} 组相邻同音短片段。仅合并连续短音，不填空拍；整批可一次撤销。`;
}
function locateDurationNote(direction){
  const matches=timingCandidates();if(!matches.length)return;
  const current=currentNote(),beat=current?.start??scoreBeat(playPosition),index=matches.findIndex(n=>n.id===selected);
  const next=index>=0?matches[(index+direction+matches.length)%matches.length]:direction>0?(matches.find(n=>n.start>=beat)||matches[0]):([...matches].reverse().find(n=>n.start<=beat)||matches.at(-1));
  barLoop=null;selectNote(next.id);seekTo(scoreSecond(next.start),false);
  $('score').querySelector(`[data-note="${next.id}"]`)?.scrollIntoView({block:'nearest'});
  toast(`${next.type==='short'?'短音':'长音'} ${next.seconds.toFixed(3)} 秒；可循环试听后调整。`);
}
async function loopSelection(){
  const notes=project.notes.filter(n=>selectedIds.size?selectedIds.has(n.id):n.id===selected);if(!notes.length)throw Error('请先选择要试听的音符');
  barLoop={start:Math.max(0,scoreSecond(notes[0].start)-.35),end:Math.min(totalSeconds(),scoreSecond(notes.at(-1).start+notes.at(-1).duration)+.35)};
  $('loop').checked=false;seekTo(barLoop.start,false);await play({continueLoop:true});
}
function cutAtPlayhead(){
  if(job||scorePending||transcribing)return;
  const seconds=playing?mainPosition():playPosition,beat=snap(scoreBeat(seconds),EDIT_STEP);
  const n=currentNote()||project.notes.find(n=>beat>n.start&&beat<n.start+n.duration);if(!n)throw Error('请将播放位置移到要切开的音符内部');
  const result=splitNoteAt(project,n.id,beat);commit(result.project,{keepPlayback:true});selectNote(result.id);toast('已在播放位置切成两个音符，可撤销。');
}
function renderSections(){
  const waiting=scorePending||transcribing,sections=waiting?[]:project.sections||[];
  $('sectionTrackEmpty').hidden=Boolean(original);
  $('sectionTrack').hidden=!original;$('sectionEditor').hidden=!selectedSectionId||waiting||!original;
  $('sectionList').innerHTML=waiting?'<p class="hint">新简谱生成后显示区块。</p>':sections.map(s=>{const {from,to}=sectionSeconds(project,s),beats=sectionBeats(project,s),count=project.notes.filter(n=>n.start>=beats.start&&n.start<beats.end).length,used=[...new Set((s.analysisUsed||[]).map(x=>modeName[x.mode]||x.mode))].join('／');return `<div class="section-row${s.id===selectedSectionId?' active':''}"><button data-section="${escapeXML(s.id)}"><b>${escapeXML(s.name)}</b><span>${timeText(from)}–${timeText(to)} · ${count} 音${used?' · '+escapeXML(used):''}</span></button><button data-local-regenerate="${escapeXML(s.id)}" ${original&&!job?'':'disabled'}>重识别</button>${project.alternates?.some(a=>a.sectionId===s.id)?`<button data-alternate="${escapeXML(s.id)}">备选</button>`:''}</div>`;}).join('')||'<p class="hint">在上方波形拖出范围，即可建立区块。</p>';
  $('expandTimeline').disabled=Boolean(job)||waiting||project.offset<=.01;
  $('applyBar').disabled=Boolean(job)||waiting;
  if(selectedSectionId){const s=sections.find(x=>x.id===selectedSectionId);if(s){const {from,to}=sectionSeconds(project,s);$('sectionName').value=s.name;$('sectionKind').value=s.kind;$('sectionSource').value=s.source;$('sectionAnalysis').value=s.analysisMode||'auto';$('sectionAnalysisStatus').textContent=s.analysisUsed?.length?`上次识别：${[...new Set(s.analysisUsed.map(x=>modeName[x.mode]||x.mode))].join('／')}。改变策略后请点“本机重识别”。`:'新建或旧版区块，尚无策略记录。';$('sectionStart').value=from.toFixed(3);$('sectionEnd').value=to.toFixed(3);}}
  drawSectionTrack();
}
function renderEditor(){const n=(scorePending||transcribing)?null:currentNote(),batch=selectedIds.size>0;$('batchEditor').hidden=!batch;$('singleEditor').hidden=batch;$('selectionEmpty').hidden=Boolean(n);$('noteEditor').hidden=!n;if(batch){const notes=project.notes.filter(x=>selectedIds.has(x.id)),from=Math.min(...notes.map(x=>x.start)),to=Math.max(...notes.map(x=>x.start+x.duration));$('batchSummary').textContent=`已选 ${notes.length} 个音符 · 第 ${+(from+1).toFixed(4)}–${+(to+1).toFixed(4)} 拍`;return;}if(!n){$('selectionEmpty').innerHTML=selectedGap===null?'<div>♩</div>选择谱面上的音符<br><small>点击“+”空白处后，在上方直接插入。</small>':`<div>＋</div>第 ${+(selectedGap+1).toFixed(4)} 拍是空白<br><small>已填入上方起始拍；选择音高和时长后点“插入音符”。</small>`;return;}
  $('sectionKey').value=keyAt(project,n.start);const p=numberPitch(n.midi,keyAt(project,n.start),$('flats').checked);$('notePreview').textContent=p.accidental+p.digit+(p.octave>0?'̇'.repeat(p.octave):p.octave<0?'̣'.repeat(-p.octave):'');
  $('selectedIndex').textContent=`${project.notes.indexOf(n)+1} / ${project.notes.length}`;$('notePitch').value=n.midi===null?'rest':n.midi;$('noteStart').value=n.start+1;$('noteDuration').value=n.duration;$('noteDurationSeconds').value=+(timeAtBeat(project,n.start+n.duration)-timeAtBeat(project,n.start)).toFixed(3);$('noteLyric').value=selectedLyricText(lyricViewProject(),n.id);
  $('confidence').textContent=n.reviewStatus==='reviewed'?'✓ 已人工校对':'● 待校对 · 请对照原音';
  $('splitNote').disabled=Boolean(job)||n.duration<EDIT_STEP*2;$('splitAt').disabled=Boolean(job)||n.duration<EDIT_STEP*2;$('splitAtPlayhead').disabled=$('splitAt').disabled;$('splitAtMiddle').disabled=$('splitAt').disabled;$('mergeNote').disabled=Boolean(job)||project.notes.indexOf(n)===project.notes.length-1;$('durationDown').disabled=Boolean(job)||n.duration<=EDIT_STEP;$('durationUp').disabled=Boolean(job)||n.duration>=128;
}
function clearSelection(){lyricLinking=false;clearLyricSelection();closeLyricPopup();selected=null;selectedGap=null;selectedIds.clear();render();}
function selectNote(id){if(!lyricLinking)clearLyricSelection();closeLyricPopup();selectionAnchor=id;selectedIds.clear();selected=id;selectedGap=null;render();const n=currentNote();if(n){$('freeStart').value=n.start+1;$('pasteStart').value=n.start+n.duration+1;$('splitAt').value=n.start+Math.max(EDIT_STEP,snap(n.duration/2,EDIT_STEP))+1;$('barNumber').value=Math.floor(n.start/barLength(project.meter))+1;if(project.layout==='barred')loadBarInput();}}
function selectGap(beat){if(!lyricLinking)clearLyricSelection();selectedIds.clear();selected=null;selectedGap=snap(beat,EDIT_STEP);$('insertStart').value=selectedGap+1;$('pasteStart').value=selectedGap+1;$('freeStart').value=selectedGap+1;const next=project.notes.find(n=>n.start>selectedGap+1e-6),room=(next?.start??selectedGap+1)-selectedGap;$('insertDuration').value=Math.max(EDIT_STEP,Math.min(1,snap(room,EDIT_STEP)));closeLyricPopup();if(!lyricsOpen)$('insertDisclosure').open=true;render();}
function moveSelection(delta){const i=project.notes.findIndex(n=>n.id===selected),n=project.notes[clamp(i+delta,0,project.notes.length-1)];if(n){selectNote(n.id);$('score').querySelector(`[data-note="${n.id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});}}
async function download(data,name,type){const response=await fetch('/api/export-file?name='+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Studio-Token':token},body:new Blob([data],{type})}),result=await response.json();if(!response.ok)throw Error(result.error||'导出保存失败');const a=document.createElement('a');a.href=result.url;a.download=result.filename;a.textContent='打开刚导出的文件';a.className='text-btn';a.target='_blank';a.rel='noopener';const location=$('exportLocation');if(location){location.replaceChildren(document.createTextNode('已保存到应用 exports 文件夹。 '),a);}const trigger=document.createElement('a');trigger.href=result.url;trigger.download=result.filename;trigger.hidden=true;document.body.appendChild(trigger);trigger.click();trigger.remove();toast('已保存：exports/'+result.filename);}
const filename=ext=>exportName(project.title,ext);
const PROJECT_NAMES_KEY='jianpu-project-save-names-v1';
let projectSaveNames={};
try{const names=JSON.parse(localStorage.getItem(PROJECT_NAMES_KEY)||'{}');if(names&&typeof names==='object'&&!Array.isArray(names))projectSaveNames=names;}catch{}
function rememberProjectName(title,name){
  projectSaveNames={...projectSaveNames,[title]:name};
  projectSaveNames=Object.fromEntries(Object.entries(projectSaveNames).slice(-30));
  try{localStorage.setItem(PROJECT_NAMES_KEY,JSON.stringify(projectSaveNames));}catch{}
}
function previewProjectName(){
  const raw=$('projectSaveName').value;
  $('projectSavePreview').textContent='文件名：'+exportName(raw,'json');
  $('projectSaveConfirm').disabled=!raw.trim();
}
function saveProject(){
  const remembered=Object.hasOwn(projectSaveNames,project.title)?projectSaveNames[project.title]:null;
  $('projectSaveName').value=typeof remembered==='string'?remembered:importedProjectStem(project.title);
  previewProjectName();
  if(!$('projectSaveDialog').open)$('projectSaveDialog').showModal();
  $('projectSaveName').focus();$('projectSaveName').select();
}
async function confirmProjectSave(){
  if(!$('projectSaveName').value.trim())return;
  const name=exportName($('projectSaveName').value,'json'),text=projectText(project),title=project.title;
  $('projectSaveConfirm').disabled=true;
  try{await download(text,name,'application/json');rememberProjectName(title,name.replace(/\.json$/i,''));if(projectText(project)===text)dirty=false;$('projectSaveDialog').close();}
  finally{previewProjectName();}
}
on('projectSaveName','input',previewProjectName);
on('projectSaveForm','submit',async e=>{e.preventDefault();await confirmProjectSave();});
on('projectSaveCancel','click',()=>$('projectSaveDialog').close());

function setBusy(value,label=''){
  $('progressArea').hidden=!value;for(const id of ['alignmentBeat','alignmentSecond','alignAtPlayhead','addAlignment','removeAlignment','sectionKey','setSectionKey','removeSectionKey','autoSeparate','recognitionProfile','recognitionAblation','audioFile','engine','rangeStart','rangeEnd','minMidi','instrumentMinMidi','instrumentQuantize','maxMidi','strategy','quantize','key','meter','layoutMode','bpm','title','offset','transposeBtn','globalPitchStep','globalPitchDown','globalPitchUp','newBtn','demoBtn','openProject','importMidi','separate','addNote','addRest','insertPitch','insertStart','insertDuration','copyNotes','pasteNotes','pasteStart','pasteMode','pasteAtPlayhead','notePitch','noteStart','noteDuration','noteDurationSeconds','durationDown','durationUp','noteLyric','pitchDown','pitchUp','splitNote','splitAt','splitAtPlayhead','splitAtMiddle','mergeNote','deleteNote','markReviewed','barNumber','barAtPlayhead','loadBar','loopBar','barInput','applyBar','freeStart','freeAtPlayhead','freeAtSelection','freeInput','freeApply','expandTimeline','saveSection','sectionAnalysis','deleteSection','regenerateSection'])$(id).disabled=value;
  if(!value)$('separate').disabled=!original||!window.separationReady;
  $('progressLabel').textContent=label;$('progressBar').style.width='0%';render();
}
function progress(p,label){$('progressBar').style.width=`${clamp(p,0,1)*100}%`;$('progressLabel').textContent=label;}
function cancelJob(){if(!job)return;job.controller?.abort();worker?.terminate();worker=null;job.cancelled=true;if(job.separationId)api('separation/cancel',{id:job.separationId}).catch(()=>{});job.reject?.(new DOMException('已取消','AbortError'));job=null;transcribing=false;setBusy(false);toast(pendingDraftMeta?'已取消；已完成的候选可从顶部恢复。':'已取消；现有乐谱保持不变。');}
async function api(route,body,signal){const request=()=>fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(body),signal});let response=await request();if(response.status===403){const fresh=await fetch('/api/status',{cache:'no-store'});if(fresh.ok){const status=await fresh.json();token=status.token;response=await request();}}const value=await response.json();if(!response.ok)throw Error(value.error||'服务请求失败');return value;}
async function loadAudio(file){if(lyricsTask)throw Error('请等待歌词分析结束或先取消');if(job)return;if(!file)return;audioRestorer.invalidate();if(file.size>120*1024*1024)throw Error('音频不能超过 120 MB，请先剪辑或压缩。');stopPlayback();toast('正在解码音频…');ctx ||= new AudioContext();let buffer;
  try{buffer=await ctx.decodeAudioData(await file.arrayBuffer());}catch{
    toast('浏览器不支持该编码，正在本机转换音频…');
    const status=await(await fetch('/api/status')).json();token=status.token;
    const response=await fetch('/api/decode',{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/octet-stream'},body:file});
    if(!response.ok)throw Error((await response.json()).error||'本地音频转换失败');
    buffer=await ctx.decodeAudioData(await response.arrayBuffer());
  }
  if(buffer.duration>600)throw Error('目前单曲最长 10 分钟，请先剪辑音频。');if(buffer.duration<.1)throw Error('音频太短');
  const stem=name=>String(name||'').replace(/\.[^.]+$/,'').trim().toLocaleLowerCase();
  const newSong=Boolean(project.notes.length)&&stem(project.sourceName)!==stem(file.name);
  if(newSong){lyricsPreview=null;lyricSelection=null;}audioResources=newSong?[]:(project.audioResources||[]);resourceBuffers.clear();instrumentContext=null;original=buffer;audioUnloaded=false;localStorage.removeItem('jianpu-audio-unloaded');stemExecution='standard:cpu:0';stemFingerprint='legacy-cpu';stemCompute=null;vocals=null;other=null;bass=null;drums=null;instrumental=null;loadedAudioName=file.name;sourceRevision++;waveZoom=1;waveViewStart=0;sectionViewStart=0;tempoCache=null;lastAudit=null;if(newSong)bpmManuallySet=false;scorePending=newSong;selected=null;
  $('separationState').textContent=window.separationReady?'本地 Demucs 已就绪，新音频尚未分轨。':'分轨未安装。';$('computeTiming').textContent='';renderCompute();
  $('playMode').value='original';$('rangeStart').value=0;$('rangeEnd').value=buffer.duration.toFixed(2);$('audioInfo').textContent=`${file.name} · ${timeText(buffer.duration)} · ${buffer.numberOfChannels} 声道`;$('waveLabel').textContent=file.name;$('separate').disabled=!window.separationReady;
  if(!newSong)project.sourceName=file.name;persist();render();drawWave();toast(newSong?'新音频已导入，旧谱已收起。点击“生成简谱”。':'音频已导入，可与当前谱面对照。');
}
const waveWindow=()=>original?Math.min(original.duration,Math.max(1,original.duration/waveZoom)):1;
const waveZoomFactor=value=>2**(7*Number(value)/1000);
const waveTime=t=>`${timeText(t)}.${Math.floor((t%1)*10)}`;
function drawWave(){
  const canvas=$('waveform'),w=Math.max(100,canvas.clientWidth||600),h=Math.max(80,canvas.clientHeight||120),dpr=devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,w,h);c.fillStyle='#f0f4ed';c.fillRect(0,0,w,h);
  for(const id of ['waveZoom','wavePan','wavePrev','waveAtPlayhead','waveNext','waveFollow'])$(id).disabled=!original;
  if(!original){c.strokeStyle='#cbd7c4';c.setLineDash([2,5]);c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();$('waveZoomLabel').textContent='导入原音后可放大';$('waveRangeLabel').textContent='';return;}
  const visible=waveWindow(),travel=Math.max(0,original.duration-visible);waveViewStart=clamp(waveViewStart,0,travel);
  $('waveZoom').value=String(Math.round(Math.log2(waveZoom)*1000/7));$('wavePan').value=String(travel?Math.round(waveViewStart/travel*1000):0);$('wavePan').disabled=travel<.001;
  $('waveZoomLabel').textContent=waveZoom<1.01?'整曲':`×${waveZoom.toFixed(1)}`;$('waveRangeLabel').textContent=`${waveTime(waveViewStart)}–${waveTime(waveViewStart+visible)}`;
  const data=original.getChannelData(0),rate=original.sampleRate,center=(h+12)/2;
  c.fillStyle='#83aa84';for(let x=0;x<w;x+=2){const from=Math.floor((waveViewStart+x/w*visible)*rate),to=Math.min(data.length,Math.ceil((waveViewStart+(x+2)/w*visible)*rate)),stride=Math.max(1,Math.floor((to-from)/24));let peak=0;for(let i=from;i<to;i+=stride)peak=Math.max(peak,Math.abs(data[i]||0));const height=Math.max(2,peak*(h-24));c.fillRect(x,center-height/2,2,height);}
  const tick=[.5,1,2,5,10,20,30,60,120].find(value=>visible/value<=9)||120;
  c.font='10px sans-serif';for(let second=Math.ceil(waveViewStart/tick)*tick;second<waveViewStart+visible;second+=tick){const x=(second-waveViewStart)/visible*w;c.strokeStyle='#5d7d6e55';c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();c.fillStyle='#506d58';c.fillText(waveTime(second),x+3,11);}
  drawWavePointer();
}
function drawWavePointer(){
  if(!original){$('playhead').hidden=true;return;}
  const second=playPosition+(scorePending?0:project.offset),visible=waveWindow();
  if(playing&&$('waveFollow').checked&&waveZoom>1.01){const next=followedWaveStart(waveViewStart,visible,second,original.duration);if(Math.abs(next-waveViewStart)>.01){waveViewStart=next;drawWave();return;}}
  const position=(second-waveViewStart)/visible;$('playhead').style.left=`${position*100}%`;$('playhead').hidden=position<0||position>1;
}
on('waveZoom','input',e=>{if(!original)return;const oldWindow=waveWindow(),second=playPosition+(scorePending?0:project.offset),anchor=second>=waveViewStart&&second<=waveViewStart+oldWindow?second:waveViewStart+oldWindow/2,relative=(anchor-waveViewStart)/oldWindow;waveZoom=waveZoomFactor(e.target.value);const visible=waveWindow();waveViewStart=clamp(anchor-relative*visible,0,Math.max(0,original.duration-visible));drawWave();});
on('wavePan','input',e=>{if(!original)return;$('waveFollow').checked=false;waveViewStart=Math.max(0,original.duration-waveWindow())*Number(e.target.value)/1000;drawWave();});
for(const [id,direction] of [['wavePrev',-1],['waveNext',1]])on(id,'click',()=>{if(!original)return;$('waveFollow').checked=false;waveViewStart=clamp(waveViewStart+direction*waveWindow()*.8,0,Math.max(0,original.duration-waveWindow()));drawWave();});
on('waveAtPlayhead','click',()=>{if(!original)return;$('waveFollow').checked=true;const visible=waveWindow(),second=playPosition+(scorePending?0:project.offset);waveViewStart=clamp(second-visible/2,0,Math.max(0,original.duration-visible));drawWave();});
on('waveFollow','change',()=>{if($('waveFollow').checked&&original)$('waveAtPlayhead').click();});
on('waveform','click',e=>{if(!original)return;const box=e.target.getBoundingClientRect(),second=waveViewStart+clamp((e.clientX-box.left)/box.width,0,1)*waveWindow();seekTo(second-(scorePending?0:project.offset));});
function selectSection(id){selectedSectionId=id;renderSections();}
function sectionPointerSecond(e){const box=$('sectionTrack').getBoundingClientRect();return clamp(sectionViewStart+(e.clientX-box.left)/Math.max(1,box.width)*sectionViewSeconds,0,original?.duration||0);}
function drawSectionTrack(){
  const wrap=$('sectionTrack'),canvas=$('sectionWave');if(!original||wrap.hidden)return;
  const w=Math.max(300,wrap.clientWidth),h=110,dpr=devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=h*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.fillStyle='#f4f8f2';c.fillRect(0,0,w,h);
  const data=original.getChannelData(0),rate=original.sampleRate;
  for(let x=0;x<w;x+=2){const from=Math.floor((sectionViewStart+x/w*sectionViewSeconds)*rate),to=Math.min(data.length,Math.floor((sectionViewStart+(x+2)/w*sectionViewSeconds)*rate)),stride=Math.max(1,Math.floor((to-from)/18));let peak=0;for(let i=from;i<to;i+=stride)peak=Math.max(peak,Math.abs(data[i]||0));c.fillStyle='#8dae99';c.fillRect(x,56-peak*42,1,Math.max(2,peak*84));}
  c.strokeStyle='#d2e0d4';c.fillStyle='#627b69';c.font='11px sans-serif';for(let t=Math.ceil(sectionViewStart/5)*5;t<sectionViewStart+sectionViewSeconds;t+=5){const x=(t-sectionViewStart)/sectionViewSeconds*w;c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();c.fillText(timeText(t),x+3,13);}
  $('sectionRegions').innerHTML=(scorePending||transcribing?[]:project.sections||[]).map(s=>{const {from,to}=sectionSeconds(project,s),left=clamp((from-sectionViewStart)/sectionViewSeconds*100,0,100),right=clamp((to-sectionViewStart)/sectionViewSeconds*100,0,100);if(right<=left)return '';return `<div class="section-region${s.id===selectedSectionId?' active':''}" data-section-block="${escapeXML(s.id)}" style="left:${left}%;width:${right-left}%" title="${escapeXML(s.name)} · ${timeText(from)}–${timeText(to)}"><span class="region-handle" data-section-handle="start"></span><b>${escapeXML(s.name)}</b><span class="region-handle" data-section-handle="end"></span></div>`;}).join('');
  $('sectionWindowLabel').textContent=`${timeText(sectionViewStart)}–${timeText(Math.min(original.duration,sectionViewStart+sectionViewSeconds))}`;drawSectionPointer();
}
function drawSectionPointer(){if(!original)return;const second=playPosition+(scorePending?0:project.offset),position=(second-sectionViewStart)/sectionViewSeconds;$('sectionPointer').style.left=`${position*100}%`;$('sectionPointer').hidden=position<0||position>1;}
function saveSectionFromEditor(){const old=project.sections?.find(s=>s.id===selectedSectionId);if(!old)return;const audioStart=Number($('sectionStart').value),audioEnd=Number($('sectionEnd').value);if(audioEnd>original.duration+.001)throw Error('区块结束秒数超出原音');validateSectionRange(project.sections,{audioStart,audioEnd},old.id);commit({...project,sections:project.sections.map(s=>s.id===old.id?{...s,audioStart,audioEnd,name:$('sectionName').value.trim()||'未命名区块',kind:$('sectionKind').value,source:$('sectionSource').value,analysisMode:$('sectionAnalysis').value,analysisUsed:audioStart!==s.audioStart||audioEnd!==s.audioEnd||$('sectionSource').value!==s.source||$('sectionAnalysis').value!==s.analysisMode?[]:s.analysisUsed}:s)});}
on('sectionWindow','change',e=>{sectionViewSeconds=Number(e.target.value);sectionViewStart=clamp(sectionViewStart,0,Math.max(0,(original?.duration||0)-sectionViewSeconds));drawSectionTrack();});
on('sectionPrev','click',()=>{sectionViewStart=Math.max(0,sectionViewStart-sectionViewSeconds*.8);drawSectionTrack();});
on('sectionNext','click',()=>{sectionViewStart=clamp(sectionViewStart+sectionViewSeconds*.8,0,Math.max(0,(original?.duration||0)-sectionViewSeconds));drawSectionTrack();});
on('sectionAtPlayhead','click',()=>{if(!original)return;sectionViewStart=clamp(playPosition+(scorePending?0:project.offset)-sectionViewSeconds/2,0,Math.max(0,original.duration-sectionViewSeconds));drawSectionTrack();});
on('saveSection','click',saveSectionFromEditor);
on('locateSection','click',()=>{const s=project.sections?.find(x=>x.id===selectedSectionId);if(s)seekTo(sectionSeconds(project,s).from-project.offset,false);});
on('regenerateSection','click',()=>{const s=project.sections?.find(x=>x.id===selectedSectionId);if(s)return regenerateLocalSection(s);});
on('deleteSection','click',()=>{if(!selectedSectionId)return;const id=selectedSectionId;selectedSectionId=null;commit({...project,sections:project.sections.filter(s=>s.id!==id),alternates:(project.alternates||[]).filter(a=>a.sectionId!==id)});toast('区块标记及备选已删除；正式音符与原音保留，可撤销。');});
$('sectionTrack').addEventListener('pointerdown',e=>{if(!original||job||scorePending||e.button!==0)return;const block=e.target.closest('[data-section-block]'),id=block?.dataset.sectionBlock,edge=e.target.closest('[data-section-handle]')?.dataset.sectionHandle,second=sectionPointerSecond(e);if(id){selectSection(id);if(!edge)return;const section=project.sections.find(s=>s.id===id);sectionDrag={mode:edge,id,start:section.audioStart,end:section.audioEnd,current:second};}else{sectionDrag={mode:'create',start:second,current:second};$('sectionSelection').hidden=false;}e.preventDefault();$('sectionTrack').setPointerCapture(e.pointerId);});
$('sectionTrack').addEventListener('pointermove',e=>{if(!sectionDrag)return;sectionDrag.current=sectionPointerSecond(e);const d=sectionDrag,from=d.mode==='end'?d.start:d.mode==='start'?Math.min(d.current,d.end):Math.min(d.start,d.current),to=d.mode==='start'?d.end:d.mode==='end'?Math.max(d.current,d.start):Math.max(d.start,d.current),left=(from-sectionViewStart)/sectionViewSeconds*100,width=(to-from)/sectionViewSeconds*100;Object.assign($('sectionSelection').style,{left:left+'%',width:width+'%'});$('sectionSelection').hidden=false;});
$('sectionTrack').addEventListener('pointerup',()=>{const d=sectionDrag;if(!d)return;sectionDrag=null;$('sectionSelection').hidden=true;const audioStart=+(d.mode==='end'?d.start:d.mode==='start'?Math.min(d.current,d.end):Math.min(d.start,d.current)).toFixed(3),audioEnd=+(d.mode==='start'?d.end:d.mode==='end'?Math.max(d.current,d.start):Math.max(d.start,d.current)).toFixed(3);try{validateSectionRange(project.sections,{audioStart,audioEnd},d.id);if(d.mode==='create'){const id=uid();selectedSectionId=id;commit({...project,sections:[...project.sections,{id,name:`自选区块 ${project.sections.length+1}`,kind:'other',source:'original',audioStart,audioEnd,analysisMode:'auto',analysisUsed:[]}]});}else commit({...project,sections:project.sections.map(s=>s.id===d.id?{...s,audioStart,audioEnd,analysisUsed:[]}:s)});}catch(err){renderSections();toast(err.message,true);}});
$('sectionTrack').addEventListener('pointercancel',()=>{sectionDrag=null;$('sectionSelection').hidden=true;});
function closeWorker(){worker?.terminate();worker=null;}
async function runWorker(samples,engine,options,task){return new Promise((resolve,reject)=>{task.reject=reject;worker ||= new Worker('/vendor/worker.js',{type:'module'});worker.onmessage=({data})=>{if(data.type==='progress')progress((task.workerBase||0)+(task.workerScale||1)*data.value,task.workerLabel?`${task.workerLabel} · ${data.stage}`:data.stage);else if(data.type==='error'){closeWorker();reject(Error(data.message));}else{task.reject=null;resolve(data);}};worker.onerror=e=>{closeWorker();reject(Error('转录引擎加载失败：'+e.message));};worker.postMessage({samples,engine,options:{...options,execution:task.execution,token}},[samples.buffer]);});}
async function separateForTask(task){
  const full=true,execution=task.execution||resolveCompute({}),identity=execution.mode+':'+execution.separationBackend+':'+execution.threads;if(vocals&&other&&stemExecution===identity){task.sourceFingerprint=stemFingerprint;task.separationCompute=stemCompute;return;}const separatedAt=performance.now();if(!window.separationReady)throw Error('稳定生成需要先安装本机 Demucs；也可取消分轨后转录独奏或器乐。');
  progress(.01,'本机 Demucs 分离人声');const audio=await stereoWav(original);if(task.cancelled)throw new DOMException('已取消','AbortError');
  const r=await fetch('/api/separation/start?'+computeQuery({...execution,device:execution.separationBackend})+(full?'&full=1':''),{method:'POST',headers:{'Content-Type':'audio/wav','X-Studio-Token':token},body:audio,signal:task.controller.signal}),info=await r.json();if(!r.ok)throw Error(info.error||'无法开始人声分离');task.separationId=info.id;
  while(!task.cancelled){await new Promise(resolve=>setTimeout(resolve,1200));const response=await fetch('/api/separation/job/'+info.id+'?end='+original.duration,{headers:{'X-Studio-Token':token},signal:task.controller.signal}),s=await response.json();progress(s.progress||.1,s.message||'本机正在分离音轨');if(s.state==='failed')throw Error(s.error||'音轨分离失败');if(s.state==='done'){
    task.computeTimes.separationMs+=performance.now()-separatedAt;task.sourceFingerprint=s.compute?.fingerprint||execution.mode+':'+(s.compute?.device||execution.separationBackend);stemExecution=identity;stemFingerprint=task.sourceFingerprint;
    task.separationCompute=s.compute;stemCompute=s.compute;audioResources=mergeResources(audioResources,s.resources||[]);task.audioResources=audioResources;
    if(s.compute?.fallbacks?.length)analysisWarnings.push(...s.compute.fallbacks);
    ctx ||= new AudioContext();const buffers=await Promise.all(['audio','other'].map(async name=>{const r=await fetch('/api/separation/'+name+'/'+info.id,{headers:{'X-Studio-Token':token},signal:task.controller.signal});if(!r.ok)throw Error('读取分离音轨失败：'+name);return ctx.decodeAudioData(await r.arrayBuffer());}));
    [vocals,other]=buffers;$('separationState').textContent=full?'✓ 已保留人声、贝斯、鼓和其他器乐，可比较不同旋律来源。':'✓ 已分离人声与器乐轨。';return;
  }}
  throw new DOMException('已取消','AbortError');
}
async function tempoForTask(task){
  if(tempoCache?.revision===sourceRevision)return tempoCache;
  progress(.03,'本机测量节拍');const samples=await monoSamples(original,0,original.duration);if(task.cancelled)throw new DOMException('已取消','AbortError');
  const response=await fetch('/api/tempo',{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'audio/wav'},body:wavBytes(samples),signal:task.controller.signal});
  if(!response.ok)throw Error('本机测速度失败；请手动填写 BPM 后重试，避免整曲定位偏移。');
  const result=await response.json();if(!Number.isFinite(result.bpm)||result.bpm<30||result.bpm>300)throw Error('本机速度结果无效');tempoCache={revision:sourceRevision,bpm:result.bpm,beats:Array.isArray(result.beats)?result.beats:[]};return tempoCache;
}
function ownedWindow(events,clipStart,from,to,decisions=[]){return ownEvents(events,clipStart,from,to,{legacy:$('recognitionProfile').value==='legacy',windowId:`${from}-${to}`,decisions});}
async function analyseWindow(window,source,options,engine,task,label){
  let contextual=instrumentContext?.source===source?instrumentContext:null;if(!contextual&&source!=='original'&&!({vocals,other,bass,drums,instrumental})[source]){const resource=audioResources.filter(r=>r.source===source&&r.audioStart<=window.from&&r.audioEnd>=window.to).sort((a,b)=>(a.audioEnd-a.audioStart)-(b.audioEnd-b.audioStart))[0];if(resource)contextual={source,buffer:await resourceBuffer(resource,task.controller.signal),audioStart:resource.audioStart,fingerprint:resource.id};}
  const chosen=contextual?.buffer||({vocals,other,bass,drums,instrumental,original})[source],usedSource=chosen?source:'original';
  const audio=chosen||original,origin=contextual?.audioStart||0,clipStart=Math.max(origin,window.from-.4),clipEnd=Math.min(origin+audio.duration,window.to+.4),samples=await monoSamples(audio,clipStart-origin,clipEnd-origin);
  task.workerLabel=label;const workerEngine=engine==='auto'?'adaptive':engine==='basic'&&source==='other'?'instrumental':engine;
  const parameters={...pipelineOptions(),...options,source:usedSource,execution:task.execution,sourceFingerprint:usedSource==='original'?'original':contextual?.fingerprint||task.sourceFingerprint||stemFingerprint},started=performance.now();let keys=await analysisKeys(samples,workerEngine,parameters);let rawEvidence=null,combinedHit=false;
  try{rawEvidence=await loadAnalysis(keys.combined,token,task.controller.signal);combinedHit=Boolean(rawEvidence);if(!rawEvidence&&keys.combined!==keys.base)rawEvidence=await loadAnalysis(keys.base,token,task.controller.signal);}catch(error){if(task.cancelled)throw error;analysisWarnings.push(error.message);}
  let externalEvidence=null;
  if(['pyin','crepe'].includes(parameters.pipeline)&&rawEvidence?.externalEngine!==parameters.pipeline){
    progress(task.workerBase||0,`${label} · ${parameters.pipeline} 实验音高分析`);
    const r=await fetch(`/api/analysis/pitch?engine=${parameters.pipeline}&minMidi=${parameters.minMidi}&maxMidi=${parameters.maxMidi}&${computeQuery({...task.execution,device:task.execution.pitchBackend})}`,{method:'POST',headers:{'X-Studio-Token':token},body:wavBytes(samples),signal:task.controller.signal});
    if(!r.ok)throw Error((await r.json()).error||'实验音高分析失败');externalEvidence=await r.json();
  }
  const result=await runWorker(samples,workerEngine,{...parameters,rawEvidence,externalEvidence},task);
  const actual=result.rawEvidence?.compute,externalActual=(externalEvidence||result.rawEvidence)?.externalCompute;
  const effective={...parameters.execution,...(actual?.backend?{basicBackend:actual.backend,basicFingerprint:actual.fingerprint||parameters.execution.basicFingerprint}:{}),...(parameters.pipeline==='crepe'&&externalActual?.device?{pitchBackend:externalActual.device}:{})};
  if(effective.basicBackend!==parameters.execution.basicBackend||effective.pitchBackend!==parameters.execution.pitchBackend){keys=await analysisKeys(samples,workerEngine,{...parameters,execution:effective});analysisWarnings.push('显卡分析发生回退；缓存按实际使用的后端保存。');}
  for(const entry of actual?.records||[])if(entry.fallbacks?.length)analysisWarnings.push(...entry.fallbacks);
  for(const entry of externalEvidence?.externalCompute?.fallbacks||[])analysisWarnings.push(entry);
  if(actual?.records?.length)$('computeState').textContent=`Basic Pitch：${actual.backend} · 线程 ${actual.records.at(-1).threads}${task.separationCompute?' · 分轨：'+(task.separationCompute.device==='cuda'?'NVIDIA 显卡':'CPU'):''}${externalActual?' · '+parameters.pipeline+'：'+externalActual.device:''}。${actual.records.flatMap(x=>x.fallbacks||[]).join('；')}`;
  if(result.rawEvidence)try{
    if(!rawEvidence)await saveAnalysis(keys.base,baseEvidence(result.rawEvidence),token,task.controller.signal);
    if(keys.combined!==keys.base&&!combinedHit)await saveAnalysis(keys.combined,result.rawEvidence,token,task.controller.signal);
  }catch(error){if(task.cancelled)throw error;analysisWarnings.push(error.message);}
  const evidence=shiftEvidence(result.evidence,clipStart),windowDecisions=[];
  const own=(events,decisions=[])=>ownEvents((events||[]).map(n=>({...n,source:usedSource})),clipStart,window.from,window.to,{legacy:parameters.pipeline==='legacy',windowId:`${window.from}-${window.to}`,decisions}),primary=own(result.notes,windowDecisions);
  auditWindows.push({from:window.from,to:window.to,clipStart,clipEnd,source:usedSource,mode:result.mode,profile:parameters.pipeline,ablation:parameters.ablation,parameters,cacheKey:keys.combined,baseCacheKey:keys.base,candidateRole:options.candidateRole||'primary',engine:workerEngine,cacheHit:Boolean(result.cacheHit),externalCacheHit:combinedHit,elapsedMs:performance.now()-started,compute:actual||null,externalCompute:externalEvidence?.externalCompute||rawEvidence?.externalCompute||null,evidence,windowDecisions,issues:(result.diagnostics?.issues||[]).map(x=>({...x,second:x.second+clipStart,...(Number.isFinite(x.end)?{end:x.end+clipStart}:{})}))});
  return {primary,variants:(result.alternates||[]).map(a=>({id:a.id,label:a.label,source:usedSource,notes:own(a.notes)})),evidence,mode:result.mode||options.analysisMode||'auto',source:usedSource,diagnostics:{...(result.diagnostics||{}),issues:(result.diagnostics?.issues||[]).map(issue=>({...issue,second:issue.second+clipStart,...(Number.isFinite(issue.end)?{end:issue.end+clipStart}:{})})).filter(issue=>issue.second>=window.from&&issue.second<window.to)}};
}
function candidateNotes(raw,base,usualStep,trace=null){const choice=chooseQuantization(raw,base,usualStep),step=raw.some(n=>n.lyricBoundary)?EDIT_STEP:choice.step;return {notes:quantizeNotes(quantizeTimed(raw,base,step),60,0,step,trace),step,lateRatio:choice.lateRatio};}
function lyricCandidate(raw,words,base,step){const trace=[],result=candidateNotes(raw,base,step,trace);return {...result,lyrics:lyricsAfterQuantization(linkRawLyrics(raw,words),trace,result.notes)};}

function mergeResources(existing,added){return [...new Map([...existing,...added].map(r=>[r.id,r])).values()];}
async function ensureOriginalResource(task){
  // Hash/save the current waveform; matching filenames do not establish audio identity.
  const response=await fetch('/api/resources/audio?source=original&start=0&end='+original.duration,{method:'POST',headers:{'X-Studio-Token':token},body:await stereoWav(original),signal:task.controller.signal});
  if(!response.ok)throw Error((await response.json()).error||'原音保存失败');audioResources=mergeResources(audioResources.filter(r=>r.source!=='original'),[await response.json()]);
}
async function resourceBuffer(resource,signal){
  if(resourceBuffers.has(resource.id))return resourceBuffers.get(resource.id);
  const response=await fetch('/api/resources/audio/'+resource.id,{headers:{'X-Studio-Token':token},signal});
  if(!response.ok)throw Error('分轨音频缺失，请重新关联原音或重新识别该段');ctx ||= new AudioContext();
  const buffer=await ctx.decodeAudioData(await response.arrayBuffer());resourceBuffers.clear();resourceBuffers.set(resource.id,buffer);return buffer;
}
function captureAudioState(){return {original,vocals,other,bass,drums,instrumental,loadedAudioName,audioResources:[...audioResources],scorePending,stemExecution,stemFingerprint,stemCompute,playMode:$('playMode').value,waveZoom,waveViewStart};}
function syncAudioUI(){
  $('audioInfo').textContent=original?loadedAudioName+' · '+timeText(original.duration):'还没有关联原音';
  $('waveLabel').textContent=original?loadedAudioName:'导入歌曲后显示原音波形';
  $('rangeStart').value=0;$('rangeEnd').value=original?original.duration.toFixed(2):'';
  $('separate').disabled=!original||!window.separationReady;
  render();drawWave();
}
const audioRestorer=new ProjectAudioRestore({
  load:resource=>resourceBuffer(resource),
  reset:p=>{original=vocals=other=bass=drums=instrumental=null;audioResources=p?.audioResources||[];resourceBuffers.clear();loadedAudioName='';instrumentContext=null;sourceRevision++;tempoCache=null;waveZoom=1;waveViewStart=0;$('playMode').value='synth';syncAudioUI();},
  apply:(buffer,p)=>{original=buffer;loadedAudioName=p.sourceName||'原曲.wav';scorePending=false;$('playMode').value='original';syncAudioUI();},
  onError:error=>toast(error.message,true)
});
const restoreResources=p=>audioRestorer.restore(p);
function restoreAudioState(state){
  audioRestorer.invalidate();resourceBuffers.clear();instrumentContext=null;tempoCache=null;sourceRevision++;
  ({original,vocals,other,bass,drums,instrumental,loadedAudioName,audioResources,scorePending,stemExecution,stemFingerprint,stemCompute,waveZoom,waveViewStart}=state);
  audioUnloaded=!original;if(original)localStorage.removeItem('jianpu-audio-unloaded');$('playMode').value=state.playMode;syncAudioUI();
}
async function separatedInstrumentResources(span,task){
  if(!window.separationModels?.includes('htdemucs_6s')){analysisWarnings.push('六轨组件未安装，本段保留现有器乐候选；运行 scripts/安装候选组件.ps1 安装');return [];}
  const from=Math.max(0,span.from-2),to=Math.min(original.duration,span.to+2);
  progress(task.workerBase||0,span.name+' · 分离吉他、钢琴、贝斯及其他器乐');
  const samples=await monoSamples(original,from,to);const response=await fetch('/api/separation/start?model=htdemucs_6s&full=1&start='+from+'&end='+to+'&'+computeQuery({...task.execution,device:task.execution.separationBackend}),{method:'POST',headers:{'X-Studio-Token':token},body:wavBytes(samples),signal:task.controller.signal});
  const info=await response.json();if(!response.ok)throw Error(info.error||'器乐分离失败');task.separationId=info.id;
  for(;;){if(task.cancelled)throw new DOMException('已取消','AbortError');await new Promise(r=>setTimeout(r,800));const response=await fetch('/api/separation/job/'+info.id,{headers:{'X-Studio-Token':token},signal:task.controller.signal}),result=await response.json();if(!response.ok||result.state==='failed')throw Error(result.error||'器乐分离失败');if(result.state==='done'){audioResources=mergeResources(audioResources,result.resources||[]);task.computeTimes.separationMs+=result.compute?.elapsedMs||0;task.instrumentComputes ||= [];task.instrumentComputes.push(result.compute);return result.resources||[];}}
}
$('lyricAssist').checked=localStorage.getItem('jianpu-lyric-assist')==='true';on('lyricAssist','change',e=>localStorage.setItem('jianpu-lyric-assist',String(e.target.checked)));
async function analysisProgress(task,kind,label,action){
  const started=performance.now();
  progress(task.workerBase||0,label);
  const timer=setInterval(async()=>{try{const r=await fetch(`/api/${kind}/status`,{headers:{'X-Studio-Token':token},signal:task.controller.signal}),status=await r.json();if(job===task&&status.job)progress((task.workerBase||0)+(task.workerScale||.02)*status.job.progress,label+' · '+status.job.stage);}catch{}},700);
  try{return await action();}finally{clearInterval(timer);const key=kind==='lyrics'?'lyricsMs':'singingMs';task.computeTimes[key]=(task.computeTimes[key]||0)+performance.now()-started;}
}
function lyricResource(from,to){return audioResources.filter(r=>r.source==='vocals'&&r.audioStart<=from&&r.audioEnd>=to).sort((a,b)=>(a.audioEnd-a.audioStart)-(b.audioEnd-b.audioStart))[0]||audioResources.find(r=>r.source==='original'&&r.audioStart<=from&&r.audioEnd>=to);}
async function stableLyricWords(result,resource,range){return stableWordsFromSegments(result.segments,result.language,resource.id,range);}
async function generationLyrics(span,task){
  if(!task.lyricAssist)return [];
  const capability=await fetch('/api/lyrics/status',{headers:{'X-Studio-Token':token},signal:task.controller.signal}).then(r=>r.json());
  const manual=scorePending?[]:timelineLyrics(project).filter(t=>t.reviewed&&t.start!==null&&t.start>=span.from&&t.end<=span.to);
  if(!capability.ready){analysisWarnings.push('歌词组件未就绪，保留现有分音；已有文字仍可对应');return manual;}
  const phrases=[],used=new Set();for(const word of manual){if(used.has(word.id))continue;const phrase=lyricPhrase(manual,word);phrase.tokens.forEach(t=>used.add(t.id));phrases.push(phrase);}
  const requests=phrases.map(p=>({...p,kind:'align'}));let from=span.from;
  for(const p of phrases.sort((a,b)=>a.from-b.from)){if(p.from-from>=.25)requests.push({from,to:p.from,kind:'transcribe'});from=Math.max(from,p.to);}
  if(span.to-from>=.25)requests.push({from,to:span.to,kind:'transcribe'});
  const words=[],device=task.execution.mode==='performance'&&task.execution.device!=='cpu'&&computeStatus?.torchCUDA?'cuda':'cpu';
  for(const request of requests.sort((a,b)=>a.from-b.from)){
    const resource=lyricResource(request.from,request.to);if(!resource)throw Error('歌词音频资源尚未就绪');
    const result=await analysisProgress(task,'lyrics',span.name+' · '+(request.kind==='align'?'对齐已校正歌词':'Qwen 转写与文字对齐'),()=>api('lyrics/'+request.kind,{resourceId:resource.id,from:request.from,to:request.to,text:request.text,language:request.kind==='align'?alignmentLanguage(task.lyricLanguage,{language:request.language}):task.lyricLanguage,device,threads:task.execution.threads},task.controller.signal));
    if(result.warning)analysisWarnings.push(result.warning);const aligned=await stableLyricWords(result,resource,request);
    // Human text remains authoritative. Re-alignment gives timing evidence, not edits.
    const kept=request.kind==='align'?request.tokens.map(t=>{const matches=aligned.filter(a=>a.text===t.text&&a.start!==null&&a.start>=t.start-.15&&a.end<=t.end+.15);return matches.length===1?{...t,start:matches[0].start,end:matches[0].end}:t;}):aligned;
    words.push(...kept);task.completedLyrics.push(...kept);
  }
  return [...new Map(words.map(w=>[w.id,w])).values()].sort((a,b)=>(a.start??Infinity)-(b.start??Infinity));
}
async function lyricSinging(span,words,task){
  if(!useLyricSinging(task,{ready:singingReady,hasWords:words.some(w=>Number.isFinite(w.start))}))return null;
  const resource=lyricResource(span.from,span.to);if(!resource)return null;
  const windows=analysisWindows([span]).map((w,i)=>{const from=Math.max(resource.audioStart,w.from-.4),to=Math.min(resource.audioEnd,w.to+.4);return {id:'lyric-window-'+i,from,to,words:words.filter(t=>Number.isFinite(t.start)&&t.start<to&&t.end>from).map(t=>({id:t.id,start:Math.max(from,t.start),end:Math.min(to,t.end)}))};});
  const textVersion=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(words.map(t=>[t.id,t.text,t.start,t.end])))))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const result=await analysisProgress(task,'singing',span.name+' · 歌词辅助人声分音',()=>api('singing/align?'+computeQuery(task.execution),{resourceId:resource.id,language:task.lyricLanguage,textVersion,windows},task.controller.signal));
  const events=[],aligned=[],byWindow=analysisWindows([span]);
  for(const [i,w] of windows.entries()){
    const found=result.windows.find(r=>r.id===w.id);if(!found)throw Error('人声分音缺少窗口结果');const owned=byWindow[i];
    events.push(...ownEvents(found.events,w.from,owned.from,owned.to,{windowId:w.id}));aligned.push(...ownEvents(found.alignedEvents||[],w.from,owned.from,owned.to,{windowId:w.id}));
    auditWindows.push({from:owned.from,to:owned.to,source:resource.source,candidateRole:'lyric-singing',engine:'rosvot',compute:result.compute,evidence:{selected:(found.events||[]).map(n=>({...n,start:n.start+w.from,end:n.end+w.from})),alignedEvents:(found.alignedEvents||[]).map(n=>({...n,start:n.start+w.from,end:n.end+w.from})),wordIntervals:found.wordIntervals,note2words:found.note2words,rejectedWordIds:found.rejectedWordIds},issues:[]});
    if(found.warning)analysisWarnings.push(found.warning);
  }
  return {raw:stitchEvidence(events),aligned:stitchEvidence(aligned),source:resource.source};
}
async function vocalCandidate(span,id,primary,words,base,step,task){
  const windows=auditWindows.filter(w=>w.candidateRole==='primary'&&w.from<span.to&&w.to>span.from),onsets=windows.flatMap(w=>w.evidence?.onsets||[]),pitchFrames=windows.flatMap(w=>w.evidence?.pitchFrames||[]),variants=[];
  let singing=null;try{singing=await lyricSinging(span,words,task);}catch(error){if(task.cancelled||error.name==='AbortError')throw error;analysisWarnings.push('歌词辅助 ROSVOT：'+error.message+'；保留声学分音');}
  const baseline=primary.map((n,i)=>({...n,evidenceId:n.evidenceId||`baseline-${id}-${i}`}));
  const policy=lyricSegmentationCandidates(baseline,words,{onsets,pitchFrames},{resplit:task.lyricResplit}),assisted=policy.auxiliary;
  if(task.lyricResplit&&words.length){const old=lyricCandidate(baseline,words,base,step);variants.push({id:uid(),sectionId:id,source:span.source,method:'原分音 · 歌词对应',audioStart:span.from,audioEnd:span.to,notes:old.notes,lyrics:old.lyrics});}
  if(assisted.changed){const aid=lyricCandidate(assisted.events,words,base,step);variants.push({id:uid(),sectionId:id,source:span.source,method:'歌词边界辅助分音（备选）',audioStart:span.from,audioEnd:span.to,notes:aid.notes,lyrics:aid.lyrics,lyricAssist:true});}
  if(singing){for(const [raw,label] of [[singing.raw,'ROSVOT 字词条件分音（辅助）'],[singing.aligned,'ROSVOT 字词对齐修整（辅助）']]){const candidate=lyricCandidate(raw,words,base,step);variants.push({id:uid(),sectionId:id,source:singing.source,model:'rosvot',method:label,audioStart:span.from,audioEnd:span.to,notes:candidate.notes,lyrics:candidate.lyrics,lyricAssist:true,diagnostics:[]});}}
  const candidate=lyricCandidate(policy.primary,words,base,step);
  auditWindows.push({from:span.from,to:span.to,source:span.source,candidateRole:'lyric-assist',engine:'acoustic-boundary',evidence:{selected:assisted.events,words:assisted.lyrics,decisions:assisted.decisions},issues:assisted.lyrics.filter(t=>t.alignmentIssue).map(t=>({second:t.start??span.from,end:t.end??span.to,kind:t.alignmentIssue}))});
  return {...candidate,raw:policy.primary,variants,words:policy.lyrics,changed:policy.changed};
}
async function singingAlternates(span,sectionId,options,base,step,task){
  if(!task.singingFine)return [];if(!singingReady){analysisWarnings.push('演唱精细分音组件未就绪，已保留现有人声候选');return [];}
  const variants=[];
  for(const source of vocals?['vocals','original']:['original']){
    const audio=source==='vocals'?vocals:original,events=[],diagnostics=[],boundaries=[];
    for(const window of analysisWindows([span])){
      const from=Math.max(0,window.from-.4),to=Math.min(original.duration,window.to+.4),samples=await monoSamples(audio,from,to);
      progress(task.workerBase||0,span.name+' · ROSVOT · '+trackName(source));
      const response=await fetch('/api/singing/analyse?'+computeQuery(task.execution),{method:'POST',headers:{'X-Studio-Token':token},body:wavBytes(samples),signal:task.controller.signal});
      const result=await response.json();if(!response.ok){analysisWarnings.push('ROSVOT：'+(result.error||'失败'));break;}
      // Use evidence stitching, including repeated attacks, independent of baseline profile.
      events.push(...ownEvents(result.events,from,window.from,window.to,{windowId:window.from+'-'+window.to}));const wordBoundaries=(result.wordBoundaries||[]).map(t=>t+from).filter(t=>t>=window.from&&t<window.to);boundaries.push(...wordBoundaries);
      auditWindows.push({from:window.from,to:window.to,source,candidateRole:'singing',engine:'rosvot',compute:result.compute,evidence:{selected:result.events.map(n=>({...n,start:n.start+from,end:n.end+from})),wordBoundaries,pitchFrames:(result.pitchFrames||[]).map(f=>({...f,second:f.second+from})).filter(f=>f.second>=window.from&&f.second<window.to)},issues:[]});
    }
    const raw=stitchEvidence(events);for(const n of raw){const reference=auditWindows.filter(w=>w.candidateRole==='primary'&&w.source==='vocals').flatMap(w=>w.evidence?.selected||[]).filter(p=>p.start<n.end&&p.end>n.start).sort((a,b)=>Math.min(n.end,b.end)-Math.max(n.start,b.start)-(Math.min(n.end,a.end)-Math.max(n.start,a.start)))[0];if(reference&&reference.midi!==n.midi)diagnostics.push({second:n.start,end:n.end,kind:'两个候选音高不一致',pitches:[{engine:'ROSVOT',midi:n.midi},{engine:'本段自动首选',midi:reference.midi}]});}
    const notes=candidateNotes(raw.filter(n=>n.midi>=options.minMidi&&n.midi<=options.maxMidi),base,step).notes;
    variants.push({id:uid(),sectionId,source,model:'rosvot',method:'演唱精细分音 · ROSVOT',audioStart:span.from,audioEnd:span.to,diagnostics,notes});
  }
  return variants;
}
async function instrumentAlternates(span,sectionId,options,base,step,task){
  const referenceRms=signalRms(await monoSamples(original,span.from,span.to)),variants=[],separated=await separatedInstrumentResources(span,task),resources=separated.length?separated:audioResources.filter(r=>r.model==='htdemucs'&&r.audioStart<=span.from&&r.audioEnd>=span.to);
  const jobs=[...resources.filter(r=>['guitar','piano','bass','other','instrumental'].includes(r.source)).map(resource=>({source:resource.source,resource})),...['original',...(resources.length?[]:['bass','instrumental'].filter(source=>({bass,instrumental})[source]))].map(source=>({source}))];
  try{for(const {source,resource} of jobs){
    if(task.cancelled)throw new DOMException('已取消','AbortError');
    const buffer=resource?await resourceBuffer(resource,task.controller.signal):({original,bass,instrumental})[source];
    instrumentContext=resource?{source,buffer,audioStart:resource.audioStart,fingerprint:resource.id}:null;
    const from=span.from-(resource?.audioStart||0),to=span.to-(resource?.audioStart||0),samples=await monoSamples(buffer,from,to);
    const events=[],diagnostics=[],methods=new Map();
    if(hasTrackContent(samples,referenceRms))for(const w of analysisWindows([span])){const result=await analyseWindow(w,source,{...options,minMidi:source==='bass'?21:options.minMidi,analysisMode:'auto',candidateRole:'alternate',pipeline:'corrected'},'auto',task,span.name+' · '+trackName(source));events.push(...result.primary);diagnostics.push(...result.diagnostics.issues);for(const v of result.variants){const method=methods.get(v.id)||{label:v.label,events:[]};method.events.push(...v.notes);methods.set(v.id,method);}}
    const notes=candidateNotes(stitchEvidence(events),base,step).notes;
    const metadata={sectionId,source,model:resource?.model||'现有分轨',resourceId:resource?.id||null,audioStart:span.from,audioEnd:span.to};
    variants.push({...metadata,id:uid(),method:'自动旋律'+(source==='bass'?'（请确认是否主旋律）':''),diagnostics,notes});
    for(const method of methods.values())variants.push({...metadata,id:uid(),method:method.label,diagnostics:[],notes:candidateNotes(stitchEvidence(method.events),base,step).notes});
  }}finally{instrumentContext=null;resourceBuffers.clear();}
  return variants;
}
function buildAudit(raw,notes,base,range,sections,task){
  const quantized=quantizationEvidence(raw,notes,base,timeAtBeat,task.quantizationTrace||null);
  return {version:2,evidenceVersion:EVIDENCE_VERSION,createdAt:new Date().toISOString(),sourceName:loadedAudioName||project.sourceName,
    ...pipelineOptions(),range,events:raw.map(n=>({...n})),quantized,windows:auditWindows,stitchDecisions:task.stitchDecisions||[],sections:sections.map(s=>({name:s.name,audioStart:s.audioStart,audioEnd:s.audioEnd,analysisUsed:s.analysisUsed})),warnings:[...new Set(analysisWarnings)],
    performance:{computeSettings:task.execution,separationCompute:task.separationCompute||null,instrumentComputes:task.instrumentComputes||[],stageTimes:task.computeTimes,elapsedMs:performance.now()-task.started,cacheHits:auditWindows.filter(w=>w.cacheHit).length,windows:auditWindows.length,jsHeapUsedBytes:performance.memory?.usedJSHeapSize??null,decodedAudioBytes:[original,vocals,other,bass,drums,instrumental].filter(Boolean).reduce((sum,b)=>sum+b.length*b.numberOfChannels*4,0)}};
}
async function persistAudit(task){
  lastAuditId=null;if(!lastAudit)return;
  try{const result=await api('analysis/audits',lastAudit,task.controller.signal);lastAuditId=result.id;}
  catch(error){if(task.cancelled)throw error;lastAudit.warnings.push('诊断未保存到本机：'+error.message);toast('候选已生成，但诊断保存失败；请从预览导出诊断。',true);}
}
function renderDraftIssues(section){
  const element=$('draftIssues');if(!section){element.replaceChildren();return;}
  const {from,to}=sectionSeconds(localDraft,section),id=selectedDraftVariants.get(section.id),candidate=localDraftVariants.find(v=>v.id===id);
  const issues=selectedIssues(candidate,lastAudit?.windows||[],from,to,section.source);
  element.innerHTML=issues.length?'<span class="hint">当前候选需核对的位置；点击循环原音：</span>'+issues.slice(0,40).map(x=>`<button class="text-btn" title="${escapeXML(conflictText(x))}" data-review-second="${x.second}" data-review-end="${x.end||x.second+.5}">${diagnosticTime(x.second)} · ${escapeXML(conflictText(x))}</button>`).join(''):'<span class="hint">当前候选暂无已记录的疑点。</span>';
}
$('draftIssues').addEventListener('click',e=>{const button=e.target.closest('[data-review-second]');if(!button||!original)return;const from=Math.max(0,Number(button.dataset.reviewSecond)-.3),to=Math.min(original.duration,Math.max(from+.5,Number(button.dataset.reviewEnd)+.3));stopDraftPlayback();localDraftRange={from,to};draftIssueLoop=true;$('stopDraftIssueLoop').hidden=false;renderDraftScores();startDraftPlayback('original').catch(error=>toast(error.message,true));});
on('stopDraftIssueLoop','click',()=>{draftIssueLoop=false;$('stopDraftIssueLoop').hidden=true;stopDraftPlayback();renderDraftSection(localDraftSections.find(s=>s.id===$('draftSectionSelect').value),true);});
const displayReviewFlag=text=>String(text).replaceAll('音高冲突','两个候选音高不一致');
function diagnosticFlags(result){return [...new Set((result.diagnostics.issues||[]).map(x=>`${x.second.toFixed(1)}秒${displayReviewFlag(x.kind)}`))];}
const trackName=source=>sourceLabel[source]||'原曲';
function previewFlags(used){const flags=[...new Set(used.flatMap(x=>x.flags||[]).map(displayReviewFlag))];return flags.length?`${flags.slice(0,6).join('、')}${flags.length>6?`，另 ${flags.length-6} 处待查`:''}`:'';}
function checkpointCandidates(base,timed,words,sections,alternates,task,start,partial){
  const trace=[],notes=quantizeNotes(timed,60,0,EDIT_STEP,trace),lyrics=lyricsAfterQuantization(words,trace,notes);if(!notes.length)return;
  const end=sections.at(-1).audioEnd,bounds={start:Math.max(0,snap(beatAtTime(base,start),EDIT_STEP)),end:snap(beatAtTime(base,end),EDIT_STEP)};
  const next=!scorePending?replaceSectionCandidate(project,bounds,{notes,lyrics}):{...base,title:(loadedAudioName||'新曲').replace(/\.[^.]+$/,''),sourceName:loadedAudioName,notes,lyrics};
  const combined=!scorePending?integratePartialCandidates(project,sections,alternates,start,end):{sections,alternates};
  localDraft=validateProject({...next,...combined,audioResources});localDraft.alternates=preservePrimary(localDraft,sections,combined.alternates);localDraftBase=localDraft;localDraftVariants=localDraft.alternates;localDraftSections=[...sections];selectedDraftVariants=new Map();localDraftLabel='已完成区段候选';draftComparisonProject=structuredClone(project);draftNewSong=scorePending;draftShouldPersist=true;
  $('localDraftSummary').textContent=`已完成 ${sections.length} 个区段、${notes.length} 音。后续分析取消时，这些候选仍可恢复。`;$('localDraftSections').textContent=sections.map(s=>s.name).join(' · ');savePendingDraft();task.hasCheckpoint=true;
}
async function transcribe(){
  if(lyricsTask)throw Error('请等待歌词分析完成');if(!original||job)return;const start=Number($('rangeStart').value),end=$('rangeEnd').value?Number($('rangeEnd').value):original.duration,bpm=Number($('bpm').value);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>original.duration+.02)throw Error('请填写音频时长内的有效起止时间。');
  const options={minMidi:Number($('minMidi').value),maxMidi:Number($('maxMidi').value),strategy:$('strategy').value};if(options.minMidi<21||options.maxMidi>108||options.minMidi>=options.maxMidi)throw Error('音域范围应为 21–108，最低音须小于最高音。');
  const instrumentOptions={...options,minMidi:Number($('instrumentMinMidi').value)},instrumentStep=Number($('instrumentQuantize').value);
  if(instrumentOptions.minMidi<21||instrumentOptions.minMidi>=instrumentOptions.maxMidi||![.25,.5,1].includes(instrumentStep))throw Error('请检查器乐旋律音域与节奏设置。');
  const engine=$('engine').value;if(!['auto','basic','pitchy'].includes(engine))throw Error('请选择本机扒谱方式');
  stopPlayback();const task={cancelled:false,controller:new AbortController(),stitchDecisions:[],singingFine:$('singingFine').checked,lyricAssist:$('lyricAssist').checked,lyricLanguage:$('lyricsLanguage').value};job=task;transcribing=true;auditWindows=[];analysisWarnings=[];task.started=performance.now();setBusy(true,'准备本机扒谱');
  try{
    await prepareCompute(task);await ensureOriginalResource(task);if($('autoSeparate').checked)await separateForTask(task);
    const tempoAt=performance.now();const measured=await transcriptionTempo({manual:bpmManuallySet,bpm,analyze:()=>tempoForTask(task),signal:task.controller.signal}),tempoHint=measured.bpm,step=Number($('quantize').value);task.tempoWarning=measured.warning||'';if(task.tempoWarning)analysisWarnings.push(task.tempoWarning);
    task.computeTimes.tempoMs=performance.now()-tempoAt;
    const partial=start>.01||end<original.duration-.01;
    const base=partial&&!scorePending?project:{...project,bpm:tempoHint,offset:0,timeAnchors:makeTimeAnchors(original.duration,tempoHint,measured.beats),notes:[],lyrics:scorePending?[]:(project.lyrics||[]).filter(t=>t.reviewed)};
    const vocalSamples=vocals?await monoSamples(vocals,0,original.duration):null,otherSamples=other?await monoSamples(other,0,original.duration):null;
    const spans=automaticSpans(vocalSamples,otherSamples,original.duration,start,end);
    const raw=[],timed=[],alternates=[],sections=[],generatedWords=[];task.completedLyrics=[];
    for(let i=0;i<spans.length;i++){
      if(task.cancelled)return;const s=spans[i],id=uid(),windows=analysisWindows([s]),results=[];
      let words=[];if(s.source==='vocals'||!vocals&&s.source==='original'){task.workerBase=i/spans.length;task.workerScale=.2/spans.length;try{words=await generationLyrics(s,task);}catch(error){if(task.cancelled||error.name==='AbortError')throw error;analysisWarnings.push('歌词：'+error.message+'；保留现有分音');}}
      for(let w=0;w<windows.length;w++){
        if(task.cancelled)return;task.workerBase=(i+.2+.5*w/windows.length)/spans.length;task.workerScale=.5/(spans.length*windows.length);
        const part=windows[w],partOptions={...(s.source==='other'?instrumentOptions:options),analysisMode:'auto'};
        const result=await analyseWindow(part,s.source,partOptions,engine,task,`${i+1}/${spans.length} · ${s.name} · ${w+1}/${windows.length}`);
        if(s.source==='vocals'&&!result.primary.length){const fallback=await analyseWindow(part,'original',{...options,analysisMode:'dense'},'auto',task,`${s.name} · 原曲补识别`);if(fallback.primary.length){result.variants.push({id:'vocals',label:'人声轨',source:'vocals',notes:result.primary});result.primary=fallback.primary;result.source='original';result.mode='dense';}}
        results.push(result);
      }
      let primary=joinWindowNotes(results.flatMap(r=>r.primary));const usualStep=s.source==='other'?instrumentStep:step;let quantized=candidateNotes(primary,base,usualStep);
      if(words.length){task.workerBase=(i+.75)/spans.length;task.workerScale=.2/spans.length;const aided=await vocalCandidate(s,id,primary,words,base,usualStep,task);primary=aided.raw;quantized=aided;generatedWords.push(...aided.words);alternates.push(...aided.variants);}
      raw.push(...primary);timed.push(...quantizeTimed(primary,base,quantized.step));
      sections.push({id,name:s.name,kind:s.kind==='voice'||s.kind==='instrumental'?'other':s.kind,source:s.source==='vocals'?'vocals':s.source==='other'?'other':'original',audioStart:s.from,audioEnd:s.to,analysisMode:'auto',analysisUsed:mergeAnalysisUsed(windows.map((w,j)=>({from:w.from,to:w.to,mode:results[j].mode,source:results[j].source,flags:[...diagnosticFlags(results[j]),...(!results[j].primary.length?['无候选']:[]),...(quantized.lateRatio>.2?['节奏已细化']:[]),...(words.length?[quantized.changed?'歌词辅助分音':'歌词对应']:[])]})))});
      const variantIds=[...new Set(results.flatMap(r=>r.variants.map(v=>v.id)))];
      for(const variantId of variantIds){const all=joinWindowNotes(results.flatMap(r=>r.variants.find(v=>v.id===variantId)?.notes||r.primary)),sample=results.flatMap(r=>r.variants).find(v=>v.id===variantId),candidate=lyricCandidate(all,words,base,usualStep);if(candidate.notes.length)alternates.push({id:uid(),sectionId:id,source:sample?.source||s.source,method:sample?.label||variantId,notes:candidate.notes,lyrics:candidate.lyrics});}
      if(s.source==='other'&&other)alternates.push(...await instrumentAlternates(s,id,instrumentOptions,base,usualStep,task));
      if(s.source==='vocals'&&!words.length)alternates.push(...await singingAlternates(s,id,options,base,usualStep,task));
      checkpointCandidates(base,timed,generatedWords,sections,alternates,task,start,partial);
    }
    if(task.cancelled)return;
    task.workerLabel='';task.workerBase=0;task.workerScale=1;progress(1,'本机候选已完成，正在生成谱面');
    task.quantizationTrace=[];const notes=quantizeNotes(timed,60,0,EDIT_STEP,task.quantizationTrace);if(!notes.length&&!alternates.some(v=>v.notes.length))throw Error('没有检测到可用旋律。请换用原曲轨、扩大音域或更换扒谱方式。');
    lastRaw={raw,instrumentalRanges:spans.filter(s=>s.source==='other').map(s=>({from:s.from,to:s.to}))};
    showComputeTimes(task);lastAudit=buildAudit(raw,notes,base,{from:start,to:end},sections,task);await persistAudit(task);
    const generatedLyrics=lyricsAfterQuantization(generatedWords,task.quantizationTrace,notes);
    const title=(loadedAudioName||project.sourceName).replace(/\.[^.]+$/,'')||'我的旋律';
    const profileName=$('recognitionProfile').selectedOptions[0].textContent;
    localDraft=partial&&!scorePending?validateProject({...replaceSectionCandidate(project,{start:Math.max(0,snap(beatAtTime(project,start),step)),end:snap(beatAtTime(project,end),step)},{notes,lyrics:generatedLyrics}),engine:`原工程 + 本机选段候选 · ${profileName}`}):validateProject({...base,title,sourceName:loadedAudioName||project.sourceName,key:estimateKey(notes),keyChanges:[],sections,alternates,notes,lyrics:[...(base.lyrics||[]).filter(m=>!generatedLyrics.some(t=>t.id===m.id)),...generatedLyrics.filter(t=>!(base.lyrics||[]).some(m=>m.id!==t.id&&m.reviewed&&m.start!==null&&t.start!==null&&Math.min(m.end,t.end)-Math.max(m.start,t.start)>(t.end-t.start)*.5))],aiLog:scorePending?[]:project.aiLog,engine:`本机分段 · ${engine==='auto'?'自动策略':engine==='pitchy'?'Pitchy':'Basic Pitch'} · ${profileName}`});
    const combined=partial&&!scorePending?integratePartialCandidates(project,sections,alternates,start,end):{sections,alternates};localDraft.sections=combined.sections;
    localDraft.audioResources=audioResources;localDraft.alternates=preservePrimary(localDraft,sections,combined.alternates).map(v=>v.primary&&sections.some(s=>s.id===v.sectionId)?{...v,diagnostics:selectedIssues(null,auditWindows,v.audioStart,v.audioEnd,v.source)}:v);
    localDraftLabel='本机整曲候选';
    $('localDraftSummary').textContent=`${sections.length} 个段落，自动初稿 ${notes.length} 音，当前谱 ${scorePending?0:project.notes.length} 音，${alternates.length} 组可切换候选。${partial&&!scorePending?'仅替换所选音频范围，其他手改音符保留。':'整曲候选待确认。'}${generatedLyrics.length?'歌词 '+generatedLyrics.length+' 字词 · 未对应 '+generatedLyrics.filter(t=>!t.noteIds.length).length+' 项。':''}生成后仍需人工校对。收起此窗口不会丢失候选或覆盖现有乐谱。${task.tempoWarning?' '+task.tempoWarning:''}`;
    $('localDraftSections').textContent=sections.map(s=>{const {start,end}=sectionBeats(base,s),count=notes.filter(n=>n.start>=start&&n.start<end).length,seconds=Math.max(1,s.audioEnd-s.audioStart),modes=[...new Set(s.analysisUsed.map(x=>modeName[x.mode]))].join('／'),tracks=[...new Set(s.analysisUsed.map(x=>trackName(x.source)))].join('／'),flags=previewFlags(s.analysisUsed);return `${s.name}：${count} 音 · ${tracks} · ${modes}${!count?' · 无候选，需人工补写':count/seconds>4?' · 候选偏密，请重点听审':''}`;}).join('　');
    localDraftBase=localDraft;localDraftVariants=localDraft.alternates;selectedDraftVariants=new Map();localDraftSections=sections;
    draftComparisonProject=structuredClone(project);draftNewSong=scorePending;draftShouldPersist=true;pendingDraftMeta=null;
    $('draftSectionSelect').replaceChildren(...localDraftSections.map(s=>new Option(s.name,s.id)));
    renderDraftSection(localDraftSections[0]);
    transcribing=false;openDraftDialog();
  }finally{if(task.execution)showComputeTimes(task);closeWorker();transcribing=false;if(job===task){job=null;setBusy(false);}}
}
function renderDraftSection(section,keepSlice=false){
  if(!localDraft||!section)return;
  const variants=localDraftVariants.filter(v=>v.sectionId===section.id),active=selectedDraftVariants.get(section.id)||'primary',activeCandidate=variants.find(v=>v.id===active),activeSource=activeCandidate?.source||section.source;
  const sources=[...new Set([section.source,...variants.map(v=>v.source)])];
  $('draftTrackSelect').replaceChildren(...sources.map(source=>new Option(trackName(source),source)));$('draftTrackSelect').value=activeSource;
  $('draftVariantSelect').replaceChildren(...(activeSource===section.source?[new Option(section.analysisUsed?.some(w=>w.flags?.some(f=>f.startsWith('歌词')))?'自动首选 · 歌词对应':'自动首选','primary')]:[]),...variants.filter(v=>v.source===activeSource).map(v=>new Option(`${v.method} · ${v.notes.length?v.notes.length+' 音':'未检测到明显内容'}`,v.id)));
  $('draftSchemeHelp').textContent=candidateSchemeHelp(activeCandidate?.method||'自动首选');
  $('playDraftDrums').disabled=!audioResources.some(r=>r.source==='drums'&&r.audioStart<=section.audioStart&&r.audioEnd>=section.audioEnd);
  $('playDraftStem').disabled=activeSource==='original'||!audioResources.some(r=>r.source===activeSource&&r.audioStart<=section.audioStart&&r.audioEnd>=section.audioEnd); 
  $('draftVariantSelect').value=active;
  const range=sectionBeats(localDraft,section),count=localDraft.notes.filter(n=>n.start>=range.start&&n.start<range.end).length;
  const changed=JSON.stringify(project)!==JSON.stringify(draftComparisonProject);
  $('draftVariantStatus').textContent=`当前显示 ${count} 音；选择其他候选只改变预览。${changed?'工作区在生成后有修改，放入候选会先备份再替换当前谱。':'放入工作区后可逐音修改。'}`;
  const {from:sectionFrom,to:sectionEnd}=sectionSeconds(localDraft,section);
  const travel=Math.max(0,sectionEnd-sectionFrom-20),slider=$('draftSlice');
  slider.max=String(Math.ceil(travel));slider.disabled=travel<.5;
  if(!keepSlice)slider.value='0';
  const from=sectionFrom+Math.min(travel,Number(slider.value)),to=Math.min(sectionEnd,from+20);
  $('draftSliceStatus').textContent=`${timeText(from)}–${timeText(to)}`;
  const rangeChanged=localDraftRange&&(Math.abs(localDraftRange.from-from)>.001||Math.abs(localDraftRange.to-to)>.001);
  if(rangeChanged){stopDraftPlayback();$('localDraftScore').scrollTop=0;}
  localDraftRange={from,to};$('draftSectionSelect').value=section.id;
  renderDraftScores();
  $('playDraftOriginal').disabled=!original;
  $('playDraftNotes').disabled=!draftScoreWindow(localDraft,from,to,'').notes.some(n=>n.midi!==null);
  draftFollow=true;$('resumeDraftFollow').hidden=true;renderDraftIssues(section);updateDraftPlaybackUI();
}
function renderDraftScores(){
  if(!localDraft||!localDraftRange)return;
  const section=localDraftSections.find(s=>s.id===$('draftSectionSelect').value),name=section?.name||'所选段落';
  const {from,to}=localDraftRange;
  $('draftSliceStatus').textContent=`${timeText(from)}–${timeText(to)}`;
  for(const [id,p,label] of [['localDraftScore',localDraft,localDraftLabel]]){
    const element=$(id);
    const width=Math.max(260,element.clientWidth||360),zoom=(width-84)/draftBeatsPerRow,top=element.scrollTop;
    const preview=draftScoreWindow(p,from,to,`${name} · ${label}`);element.dataset.previewOrigin=preview.previewOrigin;
    element.innerHTML=freeScoreSVG(preview,{idPrefix:id+"-",compactHeader:true,flats:$('flats').checked,zoom,beatsPerRow:draftBeatsPerRow,measureText:s=>noteMeasureContext.measureText(s).width});
    element.scrollTop=top;
  }
  $('draftZoom').value=String(beatsZoomSlider(draftBeatsPerRow));$('draftBeatsInput').value=String(draftBeatsPerRow);
}
function openDraftDialog(){if(draftShouldPersist)savePendingDraft();$('exportAudit').hidden=!lastAudit;$('localDraftDialog').showModal();updatePendingDraftBar();requestAnimationFrame(renderDraftScores);}
on('exportAudit','click',()=>{if(!lastAudit)throw Error('当前没有原曲秒数诊断数据');return download(JSON.stringify(lastAudit,null,2),`分析诊断-${Date.now()}.json`,'application/json');});
on('draftSectionSelect','change',e=>{draftIssueLoop=false;$('stopDraftIssueLoop').hidden=true;renderDraftSection(localDraftSections.find(s=>s.id===e.target.value));});
on('draftTrackSelect','change',e=>{const section=localDraftSections.find(s=>s.id===$('draftSectionSelect').value),variant=localDraftVariants.find(v=>v.sectionId===section.id&&v.source===e.target.value);$('draftVariantSelect').replaceChildren(new Option('',variant?.id||'primary'));$('draftVariantSelect').value=variant?.id||'primary';$('draftVariantSelect').dispatchEvent(new Event('change'));});
on('draftVariantSelect','change',e=>{draftIssueLoop=false;$('stopDraftIssueLoop').hidden=true;const section=localDraftSections.find(s=>s.id===$('draftSectionSelect').value);if(!section||!localDraftBase)return;selectedDraftVariants.set(section.id,e.target.value);let next=localDraftBase;for(const s of localDraftSections){const id=selectedDraftVariants.get(s.id);if(!id||id==='primary')continue;const variant=localDraftVariants.find(v=>v.id===id&&v.sectionId===s.id);if(variant)next=replaceSectionCandidate(next,sectionBeats(next,s),variant);}localDraft=validateProject({...next,audioResources,alternates:localDraftVariants});stopDraftPlayback();renderDraftSection(section,true);savePendingDraft();});
on('draftSlice','input',()=>{draftIssueLoop=false;$('stopDraftIssueLoop').hidden=true;renderDraftSection(localDraftSections.find(s=>s.id===$('draftSectionSelect').value),true);});
on('draftZoom','input',e=>{draftBeatsPerRow=zoomSliderBeats(e.target.value);renderDraftScores();});
on('draftBeatsInput','change',e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<1||value>16)throw Error('每行拍数须在 1–16 之间');draftBeatsPerRow=snap(value,EDIT_STEP);renderDraftScores();});
on('applyLocalDraft','click',async()=>{if(!localDraft||$('applyLocalDraft').disabled)return;stopDraftPlayback();$('applyLocalDraft').disabled=true;try{await backupProject();}finally{$('applyLocalDraft').disabled=false;}scorePending=false;const adopted={...localDraft,sections:localDraft.sections.map(s=>{const id=selectedDraftVariants.get(s.id),candidate=localDraftVariants.find(v=>v.id===id&&v.sectionId===s.id);return candidate?{...s,source:candidate.source,candidateId:candidate.id}:s;})};lyricsPreview=null;commit(adopted,{resetLyrics:draftNewSong});selected=project.notes[0]?.id||null;$('localDraftDialog').close();if(draftShouldPersist)clearPendingDraft();localDraft=null;render();toast('候选已放入工作区，可直接改谱；原谱已备份。');});
function draftPosition(){const state=draftPlayback;if(!state)return localDraftRange?.from||0;return state.playing?clockPosition({position:state.position,startedAt:state.startedAt,speed:state.speed,end:state.to},ctx.currentTime):state.position;}
function updateDraftHighlight(){
  const second=draftPosition();
  for(const [id,p] of [['localDraftScore',localDraft]]){
    const view=$(id);if(!p)continue;let active=null;
    for(const node of view.querySelectorAll('[data-note]')){
      const start=Number(node.dataset.start),row=Number(node.dataset.row),svg=node.closest('svg'),rowStarts=svg.dataset.rowStarts.split(',').map(Number),note=p.notes.find(n=>n.id===node.dataset.note),origin=Number(view.dataset.previewOrigin||0);
      const end=Math.min(note?note.start+note.duration-origin:start,rowStarts[row+1]);
      const on=Boolean(draftPlayback)&&activeFragment(p,second,{id:node.dataset.note,start,duration:end-start},origin);
      node.classList.toggle('draft-active',on);if(on)active=node;
    }
    if(draftFollow&&draftPlayback?.playing&&active){const bounds=active.getBoundingClientRect(),viewport=view.getBoundingClientRect();if(bounds.bottom>viewport.bottom-20||bounds.top<viewport.top+8){draftAutoScroll=true;view.scrollTop+=bounds.top-viewport.top-24;requestAnimationFrame(()=>{draftAutoScroll=false;});}}
  }
}
for(const id of ['localDraftScore']){for(const event of ['wheel','pointerdown'])$(id).addEventListener(event,()=>{if(!draftAutoScroll){draftFollow=false;$('resumeDraftFollow').hidden=false;}},{passive:true});}
on('resumeDraftFollow','click',()=>{draftFollow=true;$('resumeDraftFollow').hidden=true;updateDraftHighlight();});
function updateDraftPlaybackUI(){
  if(draftFollow&&draftPlayback?.playing&&!draftIssueLoop&&localDraftRange.to<draftPlayback.to-.1&&draftPosition()>=localDraftRange.to-.05){const from=draftPosition(),to=Math.min(draftPlayback.to,from+20);localDraftRange={from,to};$('draftSliceStatus').textContent=`${timeText(from)}–${timeText(to)}`;const section=localDraftSections.find(s=>s.id===$('draftSectionSelect').value);$('draftSlice').value=String(from-sectionSeconds(localDraft,section).from);renderDraftScores();}
  updateDraftHighlight();const state=draftPlayback,range=localDraftRange;
  $('pauseDraft').disabled=!state;$('pauseDraft').textContent=state?.playing?'Ⅱ 暂停':'▶ 继续';
  $('draftPlayPosition').textContent=range?`${timeText(draftPosition())} / ${timeText(state?.to||range.to)}`:'00:00 / 00:00';
  for(const [id,kind] of [['playDraftOriginal','original'],['playDraftStem','stem'],['playDraftDrums','drums'],['playDraftNotes','notes']])$(id).setAttribute('aria-pressed',String(Boolean(state?.playing&&state.kind===kind)));
}
function stopDraftPlayback(keepPosition=false){
  draftPlaybackSerial++;
  if(draftPlayback){const position=draftPosition();clearInterval(draftPlayback.timer);for(const node of draftPlayback.nodes)try{node.stop();}catch{}if(keepPosition&&position<draftPlayback.to-.02)draftPlayback={...draftPlayback,position,playing:false,nodes:[],timer:null};else draftPlayback=null;}
  updateDraftPlaybackUI();
}
async function startDraftPlayback(kind,resume=false){
  if(!localDraftRange||!$('localDraftDialog').open)return;
  const {from,to:sliceEnd}=localDraftRange,previous=draftPlayback,section=localDraftSections.find(s=>s.id===$('draftSectionSelect').value),to=draftIssueLoop?sliceEnd:sectionSeconds(localDraft,section).to;
  const position=resume&&previous?.kind===kind?draftPosition():previous&&previous.kind!==kind?draftPosition():from;
  stopDraftPlayback();stopPlayback(false);
  const serial=draftPlaybackSerial;
  await ensureContext();await ensureSlowPlayback();
  if(serial!==draftPlaybackSerial||!$('localDraftDialog').open)return;
  let startedAt=ctx.currentTime+.05+audioLatency;const nodes=[],volume=Number($('volume').value),score=localDraft;
  try{
    if(kind==='original'||kind==='stem'||kind==='drums'){
      let buffer=original,origin=0;if(kind==='stem'||kind==='drums'){const section=localDraftSections.find(s=>s.id===$('draftSectionSelect').value),candidate=localDraftVariants.find(v=>v.id===selectedDraftVariants.get(section.id)),track=kind==='drums'?'drums':candidate?.source||section.source,resource=(kind==='stem'?audioResources.find(r=>r.id===candidate?.resourceId):null)||audioResources.filter(r=>r.source===track&&r.audioStart<=position&&r.audioEnd>=to).sort((a,b)=>(a.audioEnd-a.audioStart)-(b.audioEnd-b.audioStart))[0];if(!resource)throw Error('此候选没有可试听的分离音轨');buffer=await resourceBuffer(resource);origin=resource.audioStart;if(serial!==draftPlaybackSerial)return;}
      if(!buffer||position-origin>=buffer.duration)throw Error('此位置没有可试听的原曲音频');
      startedAt=ctx.currentTime+.05+audioLatency;
      const source=await createAudioPlayback(ctx,buffer,{when:startedAt-audioLatency,offset:position-origin,duration:Math.min(to-position,buffer.duration-(position-origin)),speed:playbackSpeed,gain:volume});if(serial!==draftPlaybackSerial||!$('localDraftDialog').open){source.stop();return;}nodes.push(source);


    }else{
      if(!score)throw Error('候选谱不可用');
      for(const note of score.notes){if(note.midi===null)continue;const a=timeAtBeat(score,note.start),b=timeAtBeat(score,note.start+note.duration);if(b<=position||a>=to)continue;const begin=Math.max(a,position),end=Math.min(b,to);nodes.push(synthNote(ctx,ctx.destination,note.midi,startedAt+(begin-position)/playbackSpeed,Math.max(.001,(end-begin)*.94/playbackSpeed),volume*.25));}
    }
  }catch(error){for(const node of nodes)try{node.stop();}catch{}throw error;}
  draftPlayback={kind,position,from,to,startedAt,speed:playbackSpeed,playing:true,nodes,timer:null};
  draftPlayback.timer=setInterval(()=>{if(!draftPlayback?.playing)return;updateDraftPlaybackUI();if(draftPosition()>=draftPlayback.to-.02){if(draftIssueLoop){startDraftPlayback(draftPlayback.kind).catch(error=>toast(error.message,true));}else stopDraftPlayback();}},45);
  updateDraftPlaybackUI();
}
on('playDraftOriginal','click',()=>startDraftPlayback('original'));
on('playDraftDrums','click',()=>startDraftPlayback('drums'));
on('playDraftStem','click',()=>startDraftPlayback('stem'));
on('playDraftNotes','click',()=>startDraftPlayback('notes'));
on('pauseDraft','click',()=>{if(!draftPlayback)return;if(draftPlayback.playing)stopDraftPlayback(true);else startDraftPlayback(draftPlayback.kind,true).catch(error=>toast(error.message,true));});
$('localDraftDialog').addEventListener('close',()=>{draftIssueLoop=false;stopDraftPlayback();updatePendingDraftBar();if(draftShouldPersist&&localDraft)toast('候选已收起，点击页面顶部“继续查看候选”即可恢复。');});
on('alignAtPlayhead','click',()=>{$('alignmentBeat').value=Math.max(0,snap(scoreBeat(playPosition)));$('alignmentSecond').value=(playPosition+project.offset).toFixed(2);});
on('addAlignment','click',()=>{
  const beat=Number($('alignmentBeat').value),second=Number($('alignmentSecond').value);
  if(!Number.isFinite(beat)||beat<0||Math.abs(snap(beat)-beat)>.001||!Number.isFinite(second))throw Error('请填写有效的四分之一拍和原曲秒数');
  const endBeat=Math.max(1,(project.notes.at(-1)?.start||0)+(project.notes.at(-1)?.duration||0));
  const existing=project.timeAnchors?.length?project.timeAnchors:[{beat:0,second:project.offset},{beat:endBeat,second:timeAtBeat(project,endBeat)}];
  const points=[...existing.filter(a=>a.beat!==beat),{beat,second}].sort((a,b)=>a.beat-b.beat);
  commit({...project,timeAnchors:points,offset:points[0].second});toast('对齐点已更新，试听和导出将使用新时间映射。');
});
on('removeAlignment','click',()=>{const beat=Number($('alignmentBeat').value),points=project.timeAnchors||[];if(points.length<=2||beat===points[0].beat||beat===points.at(-1).beat)throw Error('只能删除中间对齐点');commit({...project,timeAnchors:points.filter(a=>a.beat!==beat)});toast('已删除中间对齐点。');});
async function ensureContext(){ctx ||= new AudioContext();await ctx.resume();return ctx;}
function mainPosition(){return mainClock?clockPosition(mainClock,ctx.currentTime):playPosition;}
function stopPlayback(reset=true){mainPlaybackSerial++;playStarting=false;if(playing)playPosition=mainPosition();playing=false;clearInterval(timer);timer=null;for(const node of playNodes)try{node.stop();}catch{}playNodes=[];if(reset)playPosition=0;$('play').textContent='▶';updateTime();}
function updateTime(){const duration=totalSeconds();$('playTime').textContent=`${timeText(playPosition)} / ${timeText(duration)}`;$('seek').value=clamp(playPosition/duration*100,0,100);syncScoreAtPlayhead();syncScoreCursor();drawWavePointer();drawSectionPointer();syncLyricsAtPlayhead();}
async function play({continueLoop=false}={}){if(playing||playStarting){stopPlayback(false);return;}const serial=++mainPlaybackSerial;playStarting=true;try{stopDraftPlayback();if(transcribing)throw Error('正在生成新谱，请稍候');if(scorePending&&['synth','both'].includes($('playMode').value))throw Error('新歌曲还没有简谱，请先生成或查看上一份谱子。');if(!project.notes.length&&$('playMode').value==='synth')throw Error('请先添加或识别音符。');await ensureContext();await ensureSlowPlayback();if(serial!==mainPlaybackSerial)return;const mode=$('playMode').value;if(mode!=='synth'&&!original)throw Error('请先导入原始音频。');if(!['synth','both','original'].includes(mode)&&!playbackBuffer(mode)){const resource=audioResources.find(r=>r.source===mode&&r.audioStart===0&&r.audioEnd>=original.duration-.02);if(resource){const buffer=await resourceBuffer(resource);if(serial!==mainPlaybackSerial)return;if(mode==='vocals')vocals=buffer;else if(mode==='other')other=buffer;else if(mode==='bass')bass=buffer;else if(mode==='drums')drums=buffer;else if(mode==='instrumental')instrumental=buffer;}}if(!['synth','both','original'].includes(mode)&&!playbackBuffer(mode))throw Error('此音轨资源缺失；可重新分轨，或在候选窗口试听片段音轨。');
  if(!continueLoop){const note=currentNote();noteLoop=$('loop').checked&&note?{start:Math.max(0,scoreSecond(note.start)-1.5),end:Math.min(totalSeconds(),scoreSecond(note.start+note.duration)+2)}:null;selected=null;selectedGap=null;selectedIds.clear();render();}
  const loop=$('loop').checked&&noteLoop,loopStart=loop?noteLoop.start:0;
  if(barLoop){if(playPosition<barLoop.start||playPosition>=barLoop.end)playPosition=barLoop.start;}
  if(loop&&(playPosition<loopStart||playPosition>=noteLoop.end))playPosition=loopStart;if(playPosition>=totalSeconds()-.01)playPosition=0;
  playEnd=barLoop?Math.min(totalSeconds(),barLoop.end):loop?noteLoop.end:totalSeconds();playOrigin=playPosition;playStarted=ctx.currentTime+.045+audioLatency;playing=true;mainClock={position:playOrigin,startedAt:playStarted,speed:playbackSpeed,end:playEnd};
  const volume=Number($('volume').value);
  if(mode==='synth'||mode==='both')for(const n of project.notes){if(n.midi===null)continue;const start=scoreSecond(n.start),end=scoreSecond(n.start+n.duration);if(end<=playPosition||start>=playEnd)continue;const when=playStarted+Math.max(0,start-playPosition)/playbackSpeed,dur=(Math.min(end,playEnd)-Math.max(playPosition,start))/playbackSpeed;playNodes.push(synthNote(ctx,ctx.destination,n.midi,when,dur*.95,volume*.22));}
  if(mode!=='synth'){const audioBuffer=playbackBuffer(mode),offset=playPosition+(scorePending?0:project.offset),delay=Math.max(0,-offset),length=Math.min(playEnd-playPosition-delay,audioBuffer.duration-Math.max(0,offset));if(length>0){const source=await createAudioPlayback(ctx,audioBuffer,{when:playStarted-audioLatency+delay/playbackSpeed,offset:Math.max(0,offset),duration:length,speed:playbackSpeed,gain:volume*(mode==='both'?.6:1)});if(serial!==mainPlaybackSerial){source.stop();return;}playNodes.push(source);}}

  $('play').textContent='Ⅱ';updateTime();timer=setInterval(()=>{if(!playing)return;playPosition=mainPosition();updateTime();
    if(playPosition>=playEnd){if(loop||barLoop){stopPlayback(false);playPosition=barLoop?.start??loopStart;play({continueLoop:true}).catch(e=>toast(e.message,true));}else stopPlayback();}
  },35);
  }catch(error){if(serial===mainPlaybackSerial)stopPlayback(false);throw error;}finally{if(serial===mainPlaybackSerial)playStarting=false;}
}
function noteAtPlayhead(){
  const beat=scoreBeat(playPosition);
  return project.notes.find(n=>beat>=n.start&&beat<n.start+n.duration)||null;
}
function scorePartAtPlayhead(id){
  const parts=[...$('score').querySelectorAll(`[data-note="${id}"]`)],beat=scoreBeat(playPosition);
  return parts.filter(part=>Number(part.dataset.start)<=beat+1e-6).at(-1)||parts[0];
}
function scrollToScoreNote(id,force=false){
  if(!id||!force)return;
  const el=scorePartAtPlayhead(id),viewport=$('scoreViewport');if(!el)return;
  const box=el.getBoundingClientRect(),area=viewport.getBoundingClientRect(),timeline=$('play').closest('.timeline-panel').getBoundingClientRect();
  const visibleTop=timeline.bottom>area.top&&timeline.top<area.bottom?Math.max(area.top,timeline.bottom+8):area.top;
  if(force||box.top<visibleTop+35||box.bottom>area.bottom-35){
    viewport.scrollTop+=box.top-visibleTop-Math.max(20,(area.bottom-visibleTop)*.25);
  }
  if(project.layout==='free'&&(force||box.left<area.left+65||box.right>area.right-65))viewport.scrollLeft+=box.left-area.left-area.width*.32;
}
function syncScoreAtPlayhead(force=false){
  if(scorePending||transcribing)return;
  const active=playing?noteAtPlayhead()?.id:null,part=active?scorePartAtPlayhead(active):null,marker=part?`${active}:${part.dataset.start}`:null;
  if(marker!==playingNoteId||force){
    $('score').querySelectorAll('[data-playing]').forEach(el=>el.removeAttribute('data-playing'));
    if(part)part.dataset.playing='1';
    playingNoteId=marker;

  }
}
const cursorGeometry=new WeakMap();
function syncScoreCursor(){
  const svg=$('score').querySelector('svg'),cursor=$('scorePlaybackCursor');if(!svg||!cursor)return;
  const beat=scoreBeat(playPosition);let position=null;
  if(svg.classList.contains('graphical-score')){let geometry=cursorGeometry.get(svg);if(!geometry){geometry={starts:svg.dataset.rowStarts.split(',').map(Number),ys:svg.dataset.rowYs.split(',').map(Number),heights:svg.dataset.rowHeights.split(',').map(Number),left:Number(svg.dataset.left),zoom:Number(svg.dataset.zoom)};cursorGeometry.set(svg,geometry);}position=scoreCursorPosition(beat,geometry);}
  else{const n=noteAtPlayhead(),part=n?scorePartAtPlayhead(n.id):null,box=part?.querySelector('rect')?.getBBox();if(box)position={x:box.x+box.width*clamp((beat-Number(part.dataset.start))/n.duration,0,1),y1:box.y-6,y2:box.y+box.height+6};}
  cursor.style.display=position?'':'none';if(!position)return;
  const {x,y1,y2}=position,line=cursor.querySelector('line');for(const [key,value] of Object.entries({x1:x,x2:x,y1,y2}))line.setAttribute(key,value);
  cursor.querySelector('path').setAttribute('d',`M${x-4},${y1-5}h8l-4,5z`);cursor.dataset.beat=beat;cursor.dataset.row=position.row??'';
}
function seekTo(seconds,resume=playing){
  stopPlayback(false);playPosition=clamp(seconds,0,totalSeconds());updateTime();
  if(!scorePending&&!transcribing)$('freeStart').value=Math.max(1,snap(scoreBeat(playPosition),EDIT_STEP)+1);
  if(resume)play({continueLoop:true}).catch(err=>toast(err.message,true));
}
function focusPlayhead(){
  if(scorePending||transcribing){toast('此音频尚无可定位的简谱。');return;}
  stopPlayback(false);$('freeStart').value=Math.max(1,snap(scoreBeat(playPosition),EDIT_STEP)+1);
  const n=noteAtPlayhead();
  if(!n){toast('已定位空白位置；可在工作区直接写入音符。');return;}selectNote(n.id);scrollToScoreNote(n.id,true);
}
async function audition(){const n=currentNote();if(n?.midi===null||!n)return;await ensureContext();const seconds=timeAtBeat(project,n.start+n.duration)-timeAtBeat(project,n.start);synthNote(ctx,ctx.destination,n.midi,ctx.currentTime+.01,Math.max(.001,seconds*.95/playbackSpeed),Number($('volume').value)*.3);}
function freeStartBeat(){const start=Number($('freeStart').value)-1;if(!Number.isFinite(start)||start<0||start>14399||Math.abs(snap(start,EDIT_STEP)-start)>.00001)throw Error('起始拍须从 1 开始，以 1/16 拍递增');return start;}
function addNote(rest=false){
  const start=Number($('insertStart').value)-1,duration=Number($('insertDuration').value),midi=rest?null:$('insertPitch').value==='rest'?null:Number($('insertPitch').value);
  if(!Number.isFinite(start)||start<0||start>14399||Math.abs(snap(start,EDIT_STEP)-start)>1e-6)throw Error('起始拍须从 1 开始，以 1/16 拍递增');
  if(!Number.isFinite(duration)||duration<EDIT_STEP||duration>128||Math.abs(snap(duration,EDIT_STEP)-duration)>1e-6)throw Error('时长须为 1/16–128 拍，以 1/16 拍递增');
  if(start+duration>14400)throw Error('音符超出工程时间范围');
  if(midi===null){if(duration>64)throw Error('一次最多留出 64 拍空白');commit(replaceRange(project,start,start+duration,[]),{keepPlayback:true});$('insertStart').value=start+duration+1;toast('已留出空拍，可撤销。');return;}
  if(project.notes.some(n=>n.start<start+duration-1e-6&&n.start+n.duration>start+1e-6))throw Error('这里已有音符；请选空白处插入，或在谱面选中后修改原音符。');
  if(midi!==null&&(!Number.isInteger(midi)||midi<21||midi>108))throw Error('请选择有效音高');
  const added={id:uid(),start,duration,midi,confidence:1,reviewStatus:'reviewed',lyric:''};
  commit({...project,notes:[...project.notes,added].sort((a,b)=>a.start-b.start)},{keepPlayback:true});selectNote(added.id);$('insertStart').value=start+duration+1;
}
function removeNote(){if(selected)commit({...project,notes:project.notes.filter(n=>n.id!==selected)},{keepPlayback:true});}
function undoAction(back=false){if(job)return;const from=back?redo:undo,to=back?undo:redo;if(!from.length)return;const resume=playing;stopPlayback(false);to.push(historySnapshot());closeLyricPopup();const restored=from.pop();project=restored.project||restored;selected=restored.selection?.selected||null;selectedIds=new Set(restored.selection?.ids||[]);selectedGap=restored.selection?.gap??null;selectionAnchor=restored.selection?.anchor||null;selectedSectionId=null;lyricSelection=restored.lyricSelection||null;selectedLyricIds=new Set(restored.lyricIds||[]);lyricsPreview=restored.lyricsPreview??null;if(restored.audio)restoreAudioState(restored.audio);persist();render();if(resume)play({continueLoop:true}).catch(err=>toast(err.message,true));}

for(const id of ['key','targetKey'])KEYS.forEach((key,i)=>$(id).add(new Option(key,i)));
$('notePitch').add(new Option('0 · 休止符','rest'));for(let m=21;m<=108;m++)$('notePitch').add(new Option(`${pitchName(m)} · MIDI ${m}`,m));
$('insertPitch').add(new Option('0 · 休止符','rest'));for(let m=21;m<=108;m++)$('insertPitch').add(new Option(`${pitchName(m)} · MIDI ${m}`,m));$('insertPitch').value='60';
function svgPoint(e,svg){const box=svg.getBoundingClientRect(),scale=svg.viewBox.baseVal.width/box.width;return {x:(e.clientX-box.left)*scale,y:(e.clientY-box.top)*scale,scale};}
function rowAtPointer(e,svg){const point=svgPoint(e,svg),ys=svg.dataset.rowYs?.split(',').map(Number);if(!ys)return clamp(Math.floor((point.y-Number(svg.dataset.rowTop)+27)/Number(svg.dataset.rowHeight)),0,svg.dataset.rowStarts.split(',').length-2);return Math.max(0,ys.findLastIndex(y=>point.y>=y-27));}
function beatAtPointer(e,svg,row){const rows=svg.dataset.rowStarts.split(',').map(Number);return snap(rows[row]+(svgPoint(e,svg).x-Number(svg.dataset.left))/Number(svg.dataset.zoom),EDIT_STEP);}
function activateScoreItem(g,e){if(!g)return;const start=Number(g.dataset.start);if(g.dataset.note){if(e&&(e.ctrlKey||e.metaKey||e.shiftKey)){setNoteSelection(chooseNotes(project.notes,chosenIds(),g.dataset.note,{toggle:e.ctrlKey||e.metaKey,range:e.shiftKey,anchor:selectionAnchor}));if(!e.shiftKey)selectionAnchor=g.dataset.note;return;}selectNote(g.dataset.note);seekTo(scoreSecond(start));return;}const svg=g.closest('.graphical-score'),duration=Number(g.dataset.gapDuration),beat=e?.clientX!==undefined&&svg?clamp(beatAtPointer(e,svg,Number(g.dataset.row)),start,start+duration-EDIT_STEP):start;selectGap(beat);seekTo(scoreSecond(beat));}
function clickTimelineGap(e){const svg=e.target.closest('.graphical-score')||score.querySelector('.graphical-score');if(!svg)return;const grid=e.target.closest('[data-timeline-grid]'),rows=svg.dataset.rowStarts.split(',').map(Number),row=grid?Number(grid.dataset.timelineGrid):rowAtPointer(e,svg),beat=clamp(beatAtPointer(e,svg,row),rows[row],rows[row+1]-EDIT_STEP);selectGap(beat);seekTo(scoreSecond(beat));}
on('score','click',e=>{if(suppressScoreClick){suppressScoreClick=false;return;}const word=e.target.closest('.score-lyric-bar');if(word){selectScoreLyric(word.dataset.lyric,word,e);return;}if(marqueeMode)return;const item=e.target.closest('[data-note],[data-free-start]');if(item)activateScoreItem(item,e);else if(e.target.closest('.graphical-score'))clickTimelineGap(e);else clearSelection();});on('score','keydown',e=>{if(e.key==='Enter'&&!marqueeMode){e.preventDefault();const word=e.target.closest('.score-lyric-bar');if(word)selectScoreLyric(word.dataset.lyric,word);else activateScoreItem(e.target.closest('[data-note],[data-free-start]')); }});
function setNoteSelection(ids){if(!lyricLinking)clearLyricSelection();const valid=new Set(project.notes.map(n=>n.id));selectedIds=new Set([...ids].filter(id=>valid.has(id)));selected=selectedIds.size===1?[...selectedIds][0]:null;if(selected)selectedIds.clear();selectedGap=null;updateSelectionStyles();renderEditor();renderTimingReview();renderSelectionTools();renderLyrics();}
function updateSelectionStyles(){const ids=chosenIds();$('score').querySelectorAll('[data-note]').forEach(g=>g.classList.toggle('selected',ids.has(g.dataset.note)));}
function renderSelectionTools(){renderLinkedStatus();const ids=chosenIds(),busy=Boolean(job)||scorePending||transcribing,n=ids.size;for(const id of ['toolbarLyricSplit','noteLyricSplit','batchLyricSplit'])$(id).disabled=busy||Boolean(lyricsTask)||lyricsPreview!==null||!project.notes.some(n=>ids.has(n.id)&&n.midi!==null);document.querySelector('.insert-tool').hidden=false;document.querySelector('.clipboard-tool').hidden=n>0;document.querySelector('.inspector').classList.toggle('has-selection',n>0);$('selectionCount').textContent=n?`已选 ${n} 音`:selectedGap!==null?`插入第 ${+(selectedGap+1).toFixed(4)} 拍`:'未选择';$('noteLyricSave').disabled=busy||Boolean(lyricsTask)||n!==1;$('noteLyrics').disabled=busy||Boolean(lyricsTask)||n!==1;$('toolbarCopy').disabled=busy||!n;$('toolbarPaste').disabled=busy||!noteClipboard;$('toolbarSplit').disabled=busy||n!==1||currentNote()?.duration<EDIT_STEP*2;$('toolbarMerge').disabled=busy||!(continuousSelection(project.notes,ids)||n===1&&project.notes.indexOf(currentNote())<project.notes.length-1);$('toolbarDelete').disabled=busy||!n;$('clearSelection').disabled=!n&&selectedGap===null&&!lyricSelection;$('copyNotes').disabled=busy||!n;$('loopSelection').disabled=busy||!n;$('batchReplace').disabled=busy||n<2;$('contextEditor').hidden=lyricsOpen;$('lyricsPanel').hidden=!lyricsOpen;renderLyricTools();}
function marqueeRect(){const d=marqueeDrag,box=$('score').getBoundingClientRect(),x2=d.currentX-box.left,y2=d.currentY-box.top;return {left:Math.min(d.contentX,x2),top:Math.min(d.contentY,y2),width:Math.abs(x2-d.contentX),height:Math.abs(y2-d.contentY)};}
function updateMarquee(){if(!marqueeDrag?.moved)return;const r=marqueeRect(),el=$('marqueeBox');el.hidden=false;Object.assign(el.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});const box=$('score').getBoundingClientRect(),hits=[...$('score').querySelectorAll('.timeline-note[data-note]')].filter(g=>{const b=g.querySelector('.timeline-ribbon').getBoundingClientRect();return b.right>=box.left+r.left&&b.left<=box.left+r.left+r.width&&b.bottom>=box.top+r.top&&b.top<=box.top+r.top+r.height;}).map(g=>g.dataset.note);setNoteSelection(combineSelection(marqueeDrag.base,hits,marqueeDrag.mode));}
function autoScrollMarquee(){if(!marqueeDrag)return;const v=$('scoreViewport'),b=v.getBoundingClientRect(),d=marqueeDrag;if(d.moved){const delta=d.currentY<b.top+32?-10:d.currentY>b.bottom-32?10:0;if(delta){v.scrollTop+=delta;updateMarquee();}}marqueeFrame=requestAnimationFrame(autoScrollMarquee);}
function positionPreviewLabel(group){const ribbon=group.querySelector('.timeline-ribbon'),x=Number(ribbon.getAttribute('x')),y=Number(ribbon.getAttribute('y')),width=Number(ribbon.getAttribute('width')),label=group.querySelector('.timeline-label');let mark=group.querySelector('.timeline-tiny');if(label){const fits=width>=Math.max(18,noteMeasureContext.measureText(label.textContent).width+9);label.style.display=fits?'':'none';label.setAttribute('x',String(x+width/2));if(!fits&&!mark){mark=document.createElementNS('http://www.w3.org/2000/svg','path');mark.classList.add('timeline-tiny');mark.setAttribute('stroke','#324b3b');mark.setAttribute('stroke-width','1.4');mark.setAttribute('pointer-events','none');group.append(mark);}if(mark)mark.style.display=fits?'none':'';}if(mark)mark.setAttribute('d',`M${x+width/2} ${y+12}v13`);}
const scoreRoot=$('score');
scoreRoot.addEventListener('pointerdown',e=>{if(project.layout!=='free'||job||e.button!==0)return;e.preventDefault();document.getSelection()?.removeAllRanges();document.body.classList.add('score-dragging');const word=e.target.closest('.score-lyric-bar');if(word){if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey)beginLyricDrag(e,word);return;}const onNote=e.target.closest('.timeline-note[data-note]');if(onNote&&!marqueeMode&&(e.ctrlKey||e.metaKey||e.shiftKey))return;if(marqueeMode||!onNote){const box=$('score').getBoundingClientRect();marqueeDrag={x:e.clientX,y:e.clientY,contentX:e.clientX-box.left,contentY:e.clientY-box.top,currentX:e.clientX,currentY:e.clientY,base:chosenIds(),mode:e.ctrlKey||e.metaKey?'add':e.shiftKey?'subtract':'replace',downTarget:e.target,moved:false};$('score').setPointerCapture(e.pointerId);autoScrollMarquee();return;}const g=e.target.closest('.timeline-note[data-note]');if(!g)return;const n=project.notes.find(x=>x.id===g.dataset.note),svg=g.closest('.graphical-score');if(!n||!svg)return;const edge=e.target.closest('[data-resize]')?.dataset.resize;noteDrag={id:n.id,mode:edge==='start'?'resize-start':edge==='end'?'resize-end':'move',x:e.clientX,y:e.clientY,start:n.start,end:n.start+n.duration,fragmentStart:Number(g.dataset.start),duration:n.duration,element:g,target:e.target,row:Number(g.dataset.row),rowStarts:svg.dataset.rowStarts.split(',').map(Number),zoom:Number(svg.dataset.zoom)/svgPoint(e,svg).scale,rowYs:svg.dataset.rowYs.split(',').map(Number),svg,rowHeight:Number(svg.dataset.rowHeight),moved:false,previewStart:n.start,previewDuration:n.duration,linkedGroup:linkedActive()&&!edge?associatedGroup(project,{noteIds:[n.id]}):null};e.target.setPointerCapture(e.pointerId);});
scoreRoot.addEventListener('pointermove',e=>{if(lyricDrag){moveLyricDrag(e);return;}if(marqueeDrag&&scoreRoot===$('score')){marqueeDrag.currentX=e.clientX;marqueeDrag.currentY=e.clientY;if(Math.hypot(e.clientX-marqueeDrag.x,e.clientY-marqueeDrag.y)>4)marqueeDrag.moved=true;updateMarquee();return;}const d=noteDrag;if(!d||e.pointerId!==undefined&&!d.target.hasPointerCapture(e.pointerId))return;const targetRow=d.mode==='move'?clamp(rowAtPointer(e,d.svg),0,d.rowStarts.length-2):d.row,delta=snap((e.clientX-d.x)/d.zoom+d.rowStarts[targetRow]-d.rowStarts[d.row],EDIT_STEP),n=project.notes.find(x=>x.id===d.id),i=project.notes.indexOf(n),groupStart=d.linkedGroup?.notes.length?Math.min(...d.linkedGroup.notes.map(n=>n.start)):d.start,groupEnd=d.linkedGroup?.notes.length?Math.max(...d.linkedGroup.notes.map(n=>n.start+n.duration)):d.end,others=d.linkedGroup?project.notes.filter(n=>!d.linkedGroup.noteIds.has(n.id)):project.notes,prev=d.linkedGroup?[...others].reverse().find(n=>n.start+n.duration<=groupStart+1e-6):project.notes[i-1],next=d.linkedGroup?others.find(n=>n.start>=groupEnd-1e-6):project.notes[i+1];if(!n)return;if(Math.abs(e.clientX-d.x)>3||Math.abs(e.clientY-d.y)>8)d.moved=true;if(!d.moved)return;
  if(d.mode==='move'){d.previewStart=snap(clamp(d.start+delta,d.start-groupStart+(prev?prev.start+prev.duration:0),d.start+(next?.start??14400)-groupEnd),EDIT_STEP);const fragment=d.fragmentStart+d.previewStart-d.start,newRow=Math.max(0,d.rowStarts.findIndex((v,i)=>i<d.rowStarts.length-1&&fragment>=v-1e-6&&fragment<d.rowStarts[i+1]-1e-6)),dx=((fragment-d.rowStarts[newRow])-(d.fragmentStart-d.rowStarts[d.row]))*Number(d.svg.dataset.zoom),dy=d.rowYs[newRow]-d.rowYs[d.row];d.element.setAttribute('transform',`translate(${dx} ${dy})`);}
  else if(d.mode==='resize-start'){d.previewStart=snap(clamp(d.start+delta,prev?prev.start+prev.duration:0,d.end-EDIT_STEP),EDIT_STEP);d.previewDuration=d.end-d.previewStart;const shift=(d.previewStart-d.start)*Number(d.svg.dataset.zoom),ribbon=d.element.querySelector('.timeline-ribbon'),handle=d.element.querySelector('[data-resize="start"]'),baseX=Number(d.element.dataset.baseX||ribbon.getAttribute('x')),baseWidth=Number(d.element.dataset.baseWidth||ribbon.getAttribute('width'));d.element.dataset.baseX=baseX;d.element.dataset.baseWidth=baseWidth;ribbon.setAttribute('x',String(baseX+shift));ribbon.setAttribute('width',String(Math.max(2,baseWidth-shift)));positionPreviewLabel(d.element);handle?.setAttribute('x',String(baseX+shift-6));}
  else{const maxEnd=Math.min(14400,d.start+128,next?.start??14400);d.previewDuration=snap(clamp(d.duration+delta,EDIT_STEP,maxEnd-d.start),EDIT_STEP);const ribbon=d.element.querySelector('.timeline-ribbon'),handle=d.element.querySelector('[data-resize="end"]'),baseX=Number(d.element.dataset.baseX||ribbon.getAttribute('x')),width=Math.max(2,(d.start+d.previewDuration-d.fragmentStart)*Number(d.svg.dataset.zoom));d.element.dataset.baseX=baseX;ribbon.setAttribute('width',String(Math.max(2,width-2)));positionPreviewLabel(d.element);handle?.setAttribute('x',String(baseX+width-9));}
  previewLinkedDrag(d,'note',d.id,d.previewStart,d.previewStart+d.previewDuration);
});
scoreRoot.addEventListener('pointerup',e=>{document.body.classList.remove('score-dragging');if(lyricDrag){endLyricDrag(e);return;}if(marqueeDrag&&scoreRoot===$('score')){const moved=marqueeDrag.moved,downTarget=marqueeDrag.downTarget;marqueeDrag=null;cancelAnimationFrame(marqueeFrame);$('marqueeBox').hidden=true;if(moved){suppressScoreClick=true;setTimeout(()=>suppressScoreClick=false,0);renderSelectionTools();}else{suppressScoreClick=true;setTimeout(()=>suppressScoreClick=false,0);const item=downTarget.closest('[data-note],[data-free-start]');const pointer={clientX:e.clientX,clientY:e.clientY,target:downTarget,ctrlKey:e.ctrlKey,metaKey:e.metaKey,shiftKey:e.shiftKey};if(item)activateScoreItem(item,pointer);else if(downTarget.closest('.graphical-score'))clickTimelineGap(pointer);else clearSelection();}return;}const d=noteDrag;if(!d)return;noteDrag=null;if(!d.moved)return;suppressScoreClick=true;setTimeout(()=>suppressScoreClick=false,0);selected=d.id;selectedGap=null;try{const change=d.mode==='move'?{start:d.previewStart}:d.mode==='resize-start'?{start:d.previewStart,duration:d.previewDuration}:{duration:d.previewDuration};updateNote({...change,confidence:1});}catch(err){render();toast(err.message,true);}});
scoreRoot.addEventListener('pointercancel',()=>{document.body.classList.remove('score-dragging');if(noteDrag||marqueeDrag||lyricDrag){lyricDrag=null;noteDrag=null;marqueeDrag=null;cancelAnimationFrame(marqueeFrame);$('marqueeBox').hidden=true;render();}});
scoreRoot.addEventListener('dragstart',e=>e.preventDefault());window.addEventListener('pointerup',()=>document.body.classList.remove('score-dragging'));window.addEventListener('blur',()=>document.body.classList.remove('score-dragging'));
on('marqueeMode','click',()=>{marqueeMode=!marqueeMode;render();});on('clearSelection','click',clearSelection);
function copySelection(){clipboardKind='notes';if(scorePending||transcribing)throw Error('请先生成或显示简谱');const ids=selectedIds.size?selectedIds:[selected],chosen=new Set(ids);noteClipboard=copyNotes(project,chosen);const notes=project.notes.filter(note=>chosen.has(note.id));$('pasteStart').value=+(Math.max(...notes.map(note=>note.start+note.duration))+1).toFixed(4);marqueeMode=false;render();toast(`已复制 ${noteClipboard.notes.length} 个音符。`);}
function pasteSelection(){
  if(scorePending||transcribing)throw Error('请先生成或显示简谱');
  const start=selectedGap??(Number($('pasteStart').value)-1),{project:next,ids}=pasteNotes(project,noteClipboard,start,{overwrite:$('pasteMode').value==='overwrite'});
  commit(next,{keepPlayback:true});
  if(ids.length===1)selectNote(ids[0]);else{selected=null;selectedIds=new Set(ids);render();}
  $('pasteStart').value=+(start+noteClipboard.span+1).toFixed(4);
  toast(`已粘贴 ${ids.length} 个音符，可一次撤销。`);
}
on('copyNotes','click',copySelection);on('pasteNotes','click',pasteSelection);
for(const id of ['reviewShortSeconds','reviewLongSeconds','durationReviewKind'])on(id,'change',renderTimingReview);
on('durationPrevious','click',()=>locateDurationNote(-1));on('durationNext','click',()=>locateDurationNote(1));
on('durationSelectAll','click',()=>{const matches=timingCandidates();setNoteSelection(new Set(matches.map(n=>n.id)));renderTimingReview();renderLyrics();});
on('durationMergeShort','click',()=>{const result=mergeShortSamePitchRuns(project,Number($('reviewShortSeconds').value));if(!result.groups)throw Error('没有可合并的相邻同音短片段');commit(result.project,{keepPlayback:true});toast(`已合并${result.groups}组，减少${result.removed}个碎片；可一次撤销。`);});
on('loopSelection','click',loopSelection);on('cutAtPlayhead','click',cutAtPlayhead);
on('batchMerge','click',()=>requestMerge(chosenIds()));
on('pasteAtPlayhead','click',()=>selectGap(Math.max(0,snap(scoreBeat(playPosition),EDIT_STEP))));on('pasteStart','input',()=>{selectedGap=null;updateSelectionStyles();renderSelectionTools();});
on('batchDelete','click',()=>{if(!selectedIds.size)return;commit({...project,notes:project.notes.filter(n=>!selectedIds.has(n.id))});selectedIds.clear();render();});
for(const [id,shift] of [['batchDownOne',-1],['batchUpOne',1],['batchDownOctave',-12],['batchUpOctave',12]])on(id,'click',()=>{if(selectedIds.size)commit(shiftSelectedNotes(project,selectedIds,shift),{keepPlayback:true});});
on('batchReviewed','click',()=>{if(selectedIds.size)commit({...project,notes:project.notes.map(n=>selectedIds.has(n.id)?{...n,reviewStatus:'reviewed'}:n)},{keepPlayback:true});});
on('showPreviousScore','click',()=>{scorePending=false;render();toast('已显示上一份谱子；请确认它与当前原音属于同一首歌。');});
on('audioFile','change',e=>loadAudio(e.target.files[0]));on('dropzone','keydown',e=>{if(e.key==='Enter')$('audioFile').click();});
on('dropzone','dragover',e=>{e.preventDefault();$('dropzone').classList.add('drag');});on('dropzone','dragleave',()=>$('dropzone').classList.remove('drag'));on('dropzone','drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');return loadAudio(e.dataTransfer.files[0]);});
on('transcribe','click',transcribe);on('cancelJob','click',cancelJob);
on('requantize','click',async()=>{if(!lastRaw||job)return;const step=Number($('quantize').value),instrumentStep=Number($('instrumentQuantize').value),timed=lastRaw.raw.flatMap(n=>{const mid=(n.start+n.end)/2,instrumental=lastRaw.instrumentalRanges?.some(s=>mid>=s.from&&mid<s.to);return quantizeTimed([n],project,instrumental?instrumentStep:step);}),notes=quantizeNotes(timed,60,0,step);await backupProject();commit({...project,notes,key:estimateKey(notes)});toast('已按当前时间对齐点重建节奏；原谱已备份。');});
for(let k=0;k<12;k++)$('sectionKey').add(new Option(KEYS[k],k));
on('setSectionKey','click',()=>{const n=currentNote();if(!n||job)return;commit({...project,keyChanges:[...(project.keyChanges||[]).filter(c=>c.beat!==n.start),{beat:n.start,key:Number($('sectionKey').value)}]});});
on('removeSectionKey','click',()=>{const n=currentNote();if(!n||job)return;commit({...project,keyChanges:(project.keyChanges||[]).filter(c=>c.beat!==n.start)});});
on('title','change',e=>commit({...project,title:e.target.value}));on('key','change',e=>{commit({...project,key:Number(e.target.value)});toast('记谱基准已更改，实际音高不变。移动音高请使用“转调音高”。');});
on('layoutMode','change',e=>{marqueeMode=false;selectedIds.clear();commit({...project,layout:e.target.value});});
function applyScoreZoom(beats){
  const next=Math.max(1,Math.min(16,snap(beats,EDIT_STEP)));if(!Number.isFinite(next)||next===scoreZoom)return;
  const view=$('scoreViewport'),top=view.scrollTop,beat=top<89?0:Math.max(0,(top-89)/68*scoreBeatsPerRow);
  scoreZoom=next;render();view.scrollTop=beat===0?0:89+beat/scoreBeatsPerRow*68;
}
on('scoreZoom','input',e=>{const beats=zoomSliderBeats(e.target.value);$('scoreBeatsInput').value=String(beats);if(zoomFrame)cancelAnimationFrame(zoomFrame);zoomFrame=requestAnimationFrame(()=>{zoomFrame=null;applyScoreZoom(beats);});});
on('scoreBeatsInput','change',e=>{const beats=Number(e.target.value);if(!Number.isFinite(beats)||beats<1||beats>16){e.target.value=String(scoreZoom);throw Error('每行拍数须在 1–16 之间');}applyScoreZoom(beats);});
window.addEventListener('resize',()=>{if(Math.abs($('scoreViewport').clientWidth-lastScoreWidth)>8)render();});
on('meter','change',e=>commit({...project,meter:e.target.value}));on('bpm','input',()=>{bpmManuallySet=true;});on('bpm','change',e=>{try{bpmManuallySet=true;commit({...project,bpm:Number(e.target.value),timeAnchors:[]});toast('已按新 BPM 使用直线时间对齐；原对齐点可撤销恢复。');}finally{render();}});on('offset','change',e=>{try{const offset=Number(e.target.value),shift=offset-project.offset;commit({...project,offset,timeAnchors:(project.timeAnchors||[]).map(a=>({...a,second:a.second+shift}))});}finally{render();}});on('flats','change',render);
on('transposeBtn','click',()=>{$('targetKey').value=project.key;$('transposeDialog').showModal();});on('applyTranspose','click',()=>{commit(transpose(project,Number($('targetKey').value),$('direction').value));$('transposeDialog').close();toast('已转调，试听与 MIDI 将使用新音高。');});
async function shiftScore(direction){const step=Number($('globalPitchStep').value),next=shiftAllNotes(project,direction*step);await backupProject();commit(next,{keepPlayback:true});toast(`已整体${direction>0?'升':'降'}${step===12?'一个八度':'一个半音'}，可撤销。`);}
on('globalPitchDown','click',()=>shiftScore(-1));on('globalPitchUp','click',()=>shiftScore(1));
on('notePitch','change',e=>updateNote({midi:e.target.value==='rest'?null:Number(e.target.value),confidence:1}));on('noteStart','change',e=>{try{updateNote({start:Number(e.target.value)-1,confidence:1});}finally{renderEditor();}});on('noteDuration','change',e=>{try{updateNote({duration:Number(e.target.value),confidence:1});}finally{renderEditor();}});on('noteDurationSeconds','change',e=>{try{const n=currentNote(),seconds=Number(e.target.value);if(!n||!Number.isFinite(seconds)||seconds<=0)throw Error('请输入大于 0 的音符秒数');const beats=beatAtTime(project,timeAtBeat(project,n.start)+seconds)-n.start,duration=Math.max(EDIT_STEP,snap(beats,EDIT_STEP));updateNote({duration,confidence:1});}finally{renderEditor();}});function saveNoteLyric(){const n=currentNote();if(!n)return;const view=lyricViewProject(),text=$('noteLyric').value.trim();if(text===selectedLyricText(view,n.id))return;applyManualLyricProject(setNoteLyricText(view,n.id,text,{language:textLanguage(text,$('lyricsLanguage').value,view.lyrics||[])}));}on('noteLyric','change',saveNoteLyric);on('noteLyricSave','click',saveNoteLyric);on('noteLyric','keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveNoteLyric();}});
on('durationDown','click',()=>{const n=currentNote();if(n&&n.duration>EDIT_STEP)updateNote({duration:n.duration-EDIT_STEP,confidence:1});});on('durationUp','click',()=>{const n=currentNote();if(n&&n.duration<128)updateNote({duration:n.duration+EDIT_STEP,confidence:1});});
on('pitchUp','click',()=>{const n=currentNote();if(n&&n.midi!==null)updateNote({midi:Math.min(108,n.midi+1),confidence:1});});on('pitchDown','click',()=>{const n=currentNote();if(n&&n.midi!==null)updateNote({midi:Math.max(21,n.midi-1),confidence:1});});on('audition','click',audition);
on('prevNote','click',()=>moveSelection(-1));on('nextNote','click',()=>moveSelection(1));on('markReviewed','click',()=>updateNote({reviewStatus:'reviewed'}));on('nextUncertain','click',()=>{const i=project.notes.findIndex(n=>n.id===selected);const n=[...project.notes.slice(i+1),...project.notes.slice(0,i+1)].filter(n=>n.reviewStatus!=='reviewed').sort((a,b)=>a.confidence-b.confidence)[0];if(n){selectNote(n.id);$('score').querySelector(`[data-note="${n.id}"]`)?.scrollIntoView({block:'nearest'});}else toast('没有待校对的音符。');});
on('splitAtMiddle','click',()=>{const n=currentNote();if(n)$('splitAt').value=n.start+Math.max(EDIT_STEP,snap(n.duration/2,EDIT_STEP))+1;});
on('splitAtPlayhead','click',()=>{const n=currentNote();if(!n)return;const beat=snap(scoreBeat(playPosition),EDIT_STEP);if(beat<n.start+EDIT_STEP-1e-6||beat>n.start+n.duration-EDIT_STEP+1e-6)throw Error('播放位置不在选中音符内部');$('splitAt').value=beat+1;});
let lyricNoteSplitPreview=null;
function previewLyricNoteSplit(){
  if(job||lyricsTask||scorePending||transcribing)throw Error('请等待当前分析结束。');
  if(lyricsPreview!==null)throw Error('请先在歌词对照中采用对应，再按歌词切分音符。');
  const result=splitNotesByLyrics(project,chosenIds());
  lyricNoteSplitPreview={before:project,result};
  $('lyricNoteSplitSummary').textContent=`将 ${result.splitCount} 个长音切成 ${result.segments.length} 个音符，新增 ${result.addedCount} 音。音高、整段起止和歌词原音时间保持不变。`;
  $('lyricNoteSplitWarnings').textContent=result.warnings.join(' ');
  $('lyricNoteSplitRows').innerHTML=result.segments.map(n=>`<tr><td>${escapeXML(n.text)}</td><td>${pitchName(n.midi)}</td><td>${n.from.toFixed(3)}</td><td>${(n.to-n.from).toFixed(3)}</td></tr>`).join('');
  $('lyricNoteSplitDialog').showModal();
}
for(const id of ['toolbarLyricSplit','noteLyricSplit','batchLyricSplit'])on(id,'click',previewLyricNoteSplit);
on('lyricNoteSplitConfirm','click',()=>{
  const plan=lyricNoteSplitPreview;if(!plan)return;
  if(project!==plan.before||job||lyricsTask||lyricsPreview!==null)throw Error('工程已变化，请关闭预览后重新选择切分。');
  commit(plan.result.project,{keepPlayback:true});
  clearLyricSelection();selected=plan.result.ids[0];selectedIds=new Set(plan.result.ids);selectionAnchor=selected;marqueeMode=false;
  $('lyricNoteSplitDialog').close();render();toast(`已按歌词切分，新增 ${plan.result.addedCount} 音；切出的音高沿用原音，请逐字试听调整。可一次撤销。`);
});
$('lyricNoteSplitDialog').addEventListener('close',()=>{lyricNoteSplitPreview=null;});
on('splitNote','click',()=>{const n=currentNote();if(!n)return;const result=splitNoteAt(project,n.id,Number($('splitAt').value)-1);commit(result.project,{keepPlayback:true});selectNote(result.id);toast('已在指定拍位切成两个音符，可撤销。');});
on('mergeNote','click',()=>{const n=currentNote(),next=project.notes[project.notes.indexOf(n)+1];if(n&&next)requestMerge(new Set([n.id,next.id]));});
on('addNote','click',()=>addNote());on('addRest','click',()=>{$('insertPitch').value='rest';addNote(true);});on('insertAtPlayhead','click',()=>{$('insertStart').value=Math.max(1,snap(scoreBeat(playPosition),EDIT_STEP)+1);});on('insertAtSelection','click',()=>{$('insertStart').value=(currentNote()?.start??freeStartBeat())+1;});on('deleteNote','click',removeNote);on('undo','click',()=>undoAction());on('redo','click',()=>undoAction(true));
on('freeAtPlayhead','click',()=>{$('freeStart').value=Math.max(1,snap(scoreBeat(playPosition),EDIT_STEP)+1);$('freeInput').focus();});
on('freeAtSelection','click',()=>{const n=currentNote();if(!n)throw Error('先在谱面选择一个音符');$('freeStart').value=n.start+1;$('freeInput').focus();});
on('freeApply','click',()=>{
  const start=freeStartBeat(),{notes,beats}=parseFreeNotes($('freeInput').value,{key:keyAt(project,start)});
  if(start+beats>14400)throw Error('写入范围超出工程长度');
  commit(replaceRange(project,start,start+beats,notes),{keepPlayback:true});
  const first=project.notes.find(n=>n.start>=start&&n.start<start+beats);if(first)selectNote(first.id);
  $('freeStart').value=start+beats+1;toast(`已写入 ${beats} 拍；后面的音符位置未移动，可撤销。`);
});
function loadBarInput(){const number=Number($('barNumber').value),len=barLength(project.meter);if(!Number.isInteger(number)||number<1||number>3600)throw Error('请输入有效小节号');$('barInput').value=formatBar(project,(number-1)*len,number*len);}
on('loadBar','click',loadBarInput);
on('barAtPlayhead','click',()=>{$('barNumber').value=Math.floor(scoreBeat(playPosition)/barLength(project.meter))+1;loadBarInput();});
on('loopBar','click',()=>{const number=Number($('barNumber').value),len=barLength(project.meter);if(!Number.isInteger(number)||number<1)throw Error('请选择小节');barLoop={start:scoreSecond((number-1)*len),end:scoreSecond(number*len)};seekTo(barLoop.start,false);$('loop').checked=false;play().catch(e=>toast(e.message,true));});
on('applyBar','click',()=>{const number=Number($('barNumber').value),len=barLength(project.meter);if(!Number.isInteger(number)||number<1||number>3600)throw Error('请输入有效小节号');const start=(number-1)*len,notes=parseBar($('barInput').value,{key:keyAt(project,start),beats:len});commit(replaceRange(project,start,start+len,notes),{keepPlayback:true});toast(`第 ${number} 小节已替换，可撤销恢复。`);});
on('expandTimeline','click',()=>{if(!original)throw Error('请先导入整首歌曲');const previous=project.offset;commit(expandToSong(project),{keepPlayback:true});toast(`已把原音 ${previous.toFixed(2)} 秒之前的空白纳入谱面，现在可以添加前奏。`);});
function showSectionDraft(section,candidate,label,{analysisUsed=section.analysisUsed||[],variants=[],lyrics,phrase=false}={}){
  const bounds=sectionBeats(project,section),next=replaceSectionCandidate(project,bounds,lyrics?{notes:candidate,lyrics}:candidate);
  if(phrase){const combined=integratePartialCandidates(next,[section],variants,section.audioStart,section.audioEnd);next.sections=combined.sections;next.alternates=combined.alternates;}
  localDraft=validateProject({...next,sections:(next.sections||[]).map(s=>s.id===section.id?{...s,analysisUsed}:s),alternates:[...(next.alternates||[]).filter(a=>a.sectionId!==section.id),...variants],engine:'原工程 + 本机段落候选'});
  localDraft.audioResources=audioResources;localDraft.alternates=[...(phrase?next.alternates||[]:(project.alternates||[]).map(v=>v.id===`primary-${section.id}`?{...v,id:uid()}:v)).filter(v=>!variants.some(m=>m.id===v.id)),...preservePrimary(localDraft,[section],variants).map(v=>v.primary?{...v,diagnostics:selectedIssues(null,auditWindows,section.audioStart,section.audioEnd,section.source)}:v)];localDraftBase=localDraft;localDraftVariants=localDraft.alternates;selectedDraftVariants=new Map();localDraftLabel=label;localDraftSections=[section];draftComparisonProject=structuredClone(project);draftNewSong=false;draftShouldPersist=true;pendingDraftMeta=null;$('draftSectionSelect').replaceChildren(new Option(section.name,section.id));
  const before=project.notes.filter(n=>n.start>=bounds.start&&n.start<bounds.end),after=localDraft.notes.filter(n=>n.start>=bounds.start&&n.start<bounds.end);
  renderDraftSection(section);
  $('localDraftSummary').textContent=`${section.name}：当前 ${before.length} 音 → ${after.length} 音。采用后仅替换本段，其他段落和人工修改保留；原谱会备份。`;
  $('localDraftSections').textContent=`${label}。${previewFlags(analysisUsed)} 请对照原曲试听；新音符仍标为待校对。`;
  openDraftDialog();
}
function showSavedAlternates(section){
  const variants=project.alternates||[];if(!variants.some(a=>a.sectionId===section.id))return;
  lastAudit=null;lastAuditId=null;draftComparisonProject=structuredClone(project);draftNewSong=false;draftShouldPersist=false;
  localDraftBase=project;localDraftVariants=variants;selectedDraftVariants=new Map(section.candidateId?[[section.id,section.candidateId]]:[]);
  localDraft=project;
  localDraftLabel='已保存的候选';localDraftSections=[section];$('draftSectionSelect').replaceChildren(new Option(section.name,section.id));
  $('localDraftSummary').textContent=`${section.name}：选择候选并与原曲对照。采用前保留工程备份。`;
  $('localDraftSections').textContent=`可切换 ${variants.length} 份候选；所有替换音符均待人工校对。`;
  renderDraftSection(section);openDraftDialog();
}
async function regenerateLocalSection(section){
  if(!original||job)return;const {from,to}=sectionSeconds(project,section);
  if(from<0||to>original.duration+.02||to-from>.1*3600)throw Error('段落范围超出原曲');
  const task={cancelled:false,controller:new AbortController(),stitchDecisions:[],singingFine:$('singingFine').checked,lyricAssist:$('lyricAssist').checked,lyricLanguage:$('lyricsLanguage').value};job=task;auditWindows=[];analysisWarnings=[];task.started=performance.now();setBusy(true,`本机重识别 ${section.name}`);
  try{
    await prepareCompute(task);await ensureOriginalResource(task);if($('autoSeparate').checked)await separateForTask(task);task.completedLyrics=[];
    const instrumental=section.source==='other'||['intro','interlude','outro'].includes(section.kind),source=section.source||'original';
    const options={minMidi:Number(instrumental?$('instrumentMinMidi').value:$('minMidi').value),maxMidi:Number($('maxMidi').value),strategy:$('strategy').value,analysisMode:section.analysisMode||'auto'};
    if(options.minMidi<21||options.maxMidi>108||options.minMidi>=options.maxMidi)throw Error('请检查选段识别音域');
    let words=[];if(!instrumental){try{words=await generationLyrics({from,to,name:section.name,source},task);}catch(error){if(task.cancelled||error.name==='AbortError')throw error;analysisWarnings.push('歌词：'+error.message);}}
    const windows=analysisWindows([{from,to}]),results=[];
    for(let i=0;i<windows.length;i++){if(task.cancelled)return;task.workerBase=i/windows.length;task.workerScale=1/windows.length;results.push(await analyseWindow(windows[i],source,options,'auto',task,`${section.name} · ${i+1}/${windows.length}`));}
    if(task.cancelled)return;
    task.quantizationTrace=[];const usualStep=Number(instrumental?$('instrumentQuantize').value:$('quantize').value);let raw=joinWindowNotes(results.flatMap(r=>r.primary)),candidate=candidateNotes(raw,project,usualStep,task.quantizationTrace).notes,lyrics=[],aided=null;
    if(words.length){aided=await vocalCandidate({from,to,name:section.name,source},section.id,raw,words,project,usualStep,task);raw=aided.raw;candidate=aided.notes;lyrics=aided.lyrics;}
    lastAudit=null;
    const variants=[...(aided?.variants||[])];for(const id of [...new Set(results.flatMap(r=>r.variants.map(v=>v.id)))]){const sample=results.flatMap(r=>r.variants).find(v=>v.id===id),events=joinWindowNotes(results.flatMap(r=>r.variants.find(v=>v.id===id)?.notes||r.primary)),notes=candidateNotes(events,project,usualStep).notes;if(notes.length)variants.push({id:uid(),sectionId:section.id,source:sample.source,method:sample.label,notes});}
    if(instrumental&&other)variants.push(...await instrumentAlternates({from,to,name:section.name},section.id,options,project,usualStep,task));
    if(source==='vocals'&&!words.length)variants.push(...await singingAlternates({from,to,name:section.name},section.id,options,project,usualStep,task));
    const analysisUsed=mergeAnalysisUsed(windows.map((w,i)=>({from:w.from,to:w.to,mode:results[i].mode,source:results[i].source,flags:[...diagnosticFlags(results[i]),...(!results[i].primary.length?['无候选']:[])]})));
    lastAudit=buildAudit(raw,candidate,project,{from,to},[section],task);await persistAudit(task);
    showSectionDraft(section,candidate,`${source==='other'?'器乐轨':source==='vocals'?'人声轨':'原曲'} · ${[...new Set(results.map(r=>modeName[r.mode]))].join('／')}`,{analysisUsed,variants,lyrics});
  }finally{if(task.execution)showComputeTimes(task);closeWorker();if(job===task){job=null;setBusy(false);}}
}
on('sectionList','click',async e=>{
  const regenId=e.target.closest('[data-local-regenerate]')?.dataset.localRegenerate;
  if(regenId){const section=project.sections?.find(x=>x.id===regenId);if(section)await regenerateLocalSection(section);return;}
  const altId=e.target.closest('[data-alternate]')?.dataset.alternate;
  if(altId){const section=project.sections?.find(x=>x.id===altId);if(section)showSavedAlternates(section);return;}
  const id=e.target.closest('[data-section]')?.dataset.section,section=project.sections?.find(x=>x.id===id);if(!section)return;selectSection(id);
  const {from}=sectionSeconds(project,section),{start}=sectionBeats(project,section);seekTo(from-project.offset,false);$('freeStart').value=start+1;const len=barLength(project.meter),first=Math.floor(start/len)+1;$('barNumber').value=first;if(project.layout==='barred')loadBarInput();toast(`已定位 ${section.name}；可直接写入音符或重识别本段。`);
});
on('play','click',play);on('stop','click',()=>{barLoop=null;stopPlayback();});on('backThree','click',()=>seekTo(playPosition-3));on('forwardThree','click',()=>seekTo(playPosition+3));on('focusPlayhead','click',focusPlayhead);on('seek','input',e=>{barLoop=null;seekTo(Number(e.target.value)/100*totalSeconds(),false);});on('playMode','change',()=>{const resume=playing||playStarting;stopPlayback(false);if(resume)play({continueLoop:true}).catch(e=>toast(e.message,true));});on('volume','change',()=>{const resume=playing||playStarting;stopPlayback(false);if(resume)play({continueLoop:true}).catch(e=>toast(e.message,true));});
on('saveProject','click',saveProject);on('openProject','click',()=>$('projectFile').click());on('projectFile','change',async e=>{if(lyricsTask)throw Error('请先取消歌词分析，再更换工程');const file=e.target.files[0];e.target.value='';if(!file)return;const next=await readProjectFile(file);scorePending=false;lyricsPreview=null;lyricSelection=null;commit(next,{resetLyrics:true});lastRaw=null;await restoreResources(next);rememberProjectName(next.title,importedProjectStem(file.name));toast('工程已载入；缺失的原音可重新导入关联。');});
on('demoBtn','click',()=>{scorePending=false;lyricsPreview=null;lyricSelection=null;commit(makeDemo(),{resetLyrics:true});lastRaw=null;toast('示例已载入，可撤销恢复上一份乐谱。');});on('newBtn','click',()=>{scorePending=false;lyricsPreview=null;lyricSelection=null;commit({...makeDemo(),title:'未命名乐谱',notes:[],engine:'手工编写'},{resetLyrics:true});lastRaw=null;});
installHelp();on('exportBtn','click',()=>$('exportDialog').showModal());
on('engine','change',()=>{$('engineHelp').textContent=$('engine').value==='auto'?'自动按音频段选择识别策略；不需要判断曲风。':$('engine').value==='pitchy'?'Pitchy 适合清唱、口哨和单音乐器。':'Basic Pitch 在本机生成歌曲主旋律初稿。';});
on('exportSVG','click',()=>download(scoreSVG(project,{flats:$('flats').checked}),filename('svg'),'image/svg+xml'));on('exportMidi','click',()=>download(midiFile(project),filename('mid'),'audio/midi'));on('exportJSON','click',saveProject);on('exportWav','click',async()=>{toast('正在合成 WAV…');await download(await renderWav(project),filename('wav'),'audio/wav');});
on('exportPDF','click',()=>{
  const win=window.open('','_blank');if(!win)throw Error('请允许弹出打印窗口后重试。');const svg=scoreSVG(project,{flats:$('flats').checked}),height=Number(svg.match(/height="(\d+)"/)[1]),pageHeight=882;let pages='';
  for(let y=0;y<height;y+=pageHeight){const h=Math.min(pageHeight,height-y);const crop=svg.replace(/viewBox="[^"]+"/,`viewBox="0 ${y} 1000 ${h}"`).replace(/height="\d+"/,`height="${h}"`);pages+=`<section>${y?`<h3>${escapeXML(project.title)} · 1=${KEYS[project.key]}</h3>`:''}${crop}</section>`;}
  win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeXML(project.title)}</title><style>body{margin:0;font-family:sans-serif}svg{width:100%;height:auto}section{break-after:page}section:last-child{break-after:auto}h3{font-size:14px;color:#56634e}@page{size:A4;margin:12mm}</style></head><body>${pages}</body></html>`);win.document.close();setTimeout(()=>{win.focus();win.print();},300);
});
on('detectTempo','click',async()=>{if(!original||job)return;const task={cancelled:false,controller:new AbortController()};job=task;setBusy(true,'本机分析节拍');try{const result=await tempoForTask(task);if(!task.cancelled){bpmManuallySet=true;commit({...project,bpm:result.bpm,timeAnchors:[]});toast(`本机估计 ${result.bpm} BPM；旧谱保留原音偏移，请试听核对。`);}}finally{if(job===task){job=null;setBusy(false);}}});
on('importMidi','click',()=>$('midiFile').click());on('midiFile','change',async e=>{if(lyricsTask)throw Error('请先取消歌词分析，再更换工程');const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>5*1024*1024)throw Error('MIDI 文件过大');const {Midi}=await import('/vendor/midi.js');importedMidi=new Midi(await file.arrayBuffer());importedMidiName=file.name.replace(/\.[^.]+$/,'');$('midiTrack').innerHTML='';importedMidi.tracks.forEach((t,i)=>{if(t.notes.length&&!t.instrument.percussion)$('midiTrack').add(new Option(`${i+1}. ${t.name||t.instrument.name} · ${t.notes.length} 音`,i));});if(!$('midiTrack').options.length)throw Error('没有可用的旋律轨');$('midiDialog').showModal();});
on('applyMidi','click',()=>{
  const trackIndex=Number($('midiTrack').value),track=importedMidi.tracks[trackIndex];
  lastAudit=null;localDraft=projectFromMidiTrack(importedMidi,trackIndex,{title:loadedAudioName?loadedAudioName.replace(/\.[^.]+$/,''):importedMidiName,sourceName:loadedAudioName||project.sourceName,strategy:$('strategy').value});
  localDraftBase=localDraft;localDraftVariants=[];selectedDraftVariants=new Map();draftComparisonProject=structuredClone(project);draftNewSong=scorePending||Boolean(project.notes.length&&stem(project.sourceName)!==stem(localDraft.sourceName));draftShouldPersist=true;pendingDraftMeta=null;
  localDraftLabel='MIDI 轨道候选';localDraftSections=[{id:'midi-track',name:track.name||track.instrument.name||'整曲 MIDI 轨道',start:0,end:localDraft.timeAnchors.at(-1).beat}];
  $('draftSectionSelect').replaceChildren(new Option(localDraftSections[0].name,localDraftSections[0].id));
  $('localDraftSummary').textContent=`所选轨道 ${track.notes.length} 个原始音符 → ${localDraft.notes.length} 个单声部候选；${localDraft.timeAnchors.length} 个时间对齐点。先听 MIDI 与原曲是否对齐，再决定是否采用。`;
  $('localDraftSections').textContent='复杂和弦会压成一条旋律；外部 MIDI 的音准仍需人工校对。确认前不会覆盖当前工程。';
  $('midiDialog').close();renderDraftSection(localDraftSections[0]);openDraftDialog();
});
const SHORTCUT_KEY='jianpu-shortcuts-enabled-v1';
let shortcutsEnabled=true;
try{shortcutsEnabled=localStorage.getItem(SHORTCUT_KEY)!=='false';}catch{}
function renderShortcutSettings(){
  $('shortcutsEnabled').checked=shortcutsEnabled;
  $('shortcutsBtn').textContent='快捷键：'+(shortcutsEnabled?'开':'关');
  $('shortcutsBtn').setAttribute('aria-label','快捷键设置，当前'+(shortcutsEnabled?'开启':'关闭'));
}
function setShortcutsEnabled(enabled){shortcutsEnabled=enabled;try{localStorage.setItem(SHORTCUT_KEY,String(enabled));}catch{}renderShortcutSettings();}
$('shortcutRows').innerHTML=SHORTCUTS.map(([group,keys,action])=>`<tr><td>${escapeXML(group)}</td><td><kbd>${escapeXML(keys)}</kbd></td><td>${escapeXML(action)}</td></tr>`).join('');
renderShortcutSettings();
on('shortcutsBtn','click',()=>$('shortcutsDialog').showModal());
on('shortcutsEnabled','change',e=>setShortcutsEnabled(e.target.checked));
function shortcutClick(id){const button=$(id);if(!button||button.disabled)return false;button.click();return true;}
document.addEventListener('keydown',e=>{
  if(['Control','Meta','Shift'].includes(e.key)&&lyricPopupOpen){closeLyricPopup();return;}
  const action=shortcutAction(e,{enabled:shortcutsEnabled,editing:Boolean(e.target.closest?.('input,select,textarea,[contenteditable="true"],[contenteditable=""]')),dialog:Boolean(document.querySelector('dialog[open]')),busy:Boolean(job)||Boolean(lyricsTask)||scorePending||transcribing});
  if(!action)return;
  if(action==='toggle'){e.preventDefault();setShortcutsEnabled(!shortcutsEnabled);toast('快捷键已'+(shortcutsEnabled?'开启':'关闭'));return;}
  const words=chosenLyricIds().size;
  if(words&&['previous','next','up','down','upOctave','downOctave','shorter','longer','review','lyricSplit','splitPlayhead','splitMiddle','loop'].includes(action))return;
  e.preventDefault();
  try{
    const buttons={copy:'toolbarCopy',cut:'toolbarCut',paste:'toolbarPaste',delete:'toolbarDelete',merge:'toolbarMerge',lyricSplit:'toolbarLyricSplit',marquee:'marqueeMode',loop:'loopSelection',backThree:'backThree',forwardThree:'forwardThree',shorter:'durationDown',longer:'durationUp'};
    if(buttons[action]){if(['shorter','longer'].includes(action)&&chosenIds().size!==1)return;shortcutClick(buttons[action]);return;}
    if(['up','down','upOctave','downOctave'].includes(action)){
      const ids=chosenIds();if(!ids.size)return;const delta={up:1,down:-1,upOctave:12,downOctave:-12}[action];commit(shiftSelectedNotes(project,ids,delta),{keepPlayback:true});return;
    }
    switch(action){
      case 'selectAll':
        closeLyricPopup();if(words){selectedLyricIds=new Set(scoreLyricTokens().map(t=>t.id));lyricSelection=[...selectedLyricIds][0]||null;}
        else{clearLyricSelection();selectedIds=new Set(project.notes.map(n=>n.id));selected=project.notes[0]?.id||null;selectionAnchor=selected;selectedGap=null;}render();break;
      case 'undo':undoAction();break;case 'redo':undoAction(true);break;case 'save':saveProject();break;
      case 'play':play().catch(error=>toast(error.message,true));break;
      case 'clear':closeLyricPopup();clearSelection();break;
      case 'previous':moveSelection(-1);break;case 'next':moveSelection(1);break;
      case 'splitPlayhead':cutAtPlayhead();break;
      case 'splitMiddle':if(chosenIds().size===1&&shortcutClick('splitAtMiddle'))shortcutClick('splitNote');break;
      case 'review':if(chosenIds().size)shortcutClick(chosenIds().size>1?'batchReviewed':'markReviewed');break;
      case 'slower':changeSpeed(+clamp(playbackSpeed-.05,.1,2).toFixed(2));break;
      case 'faster':changeSpeed(+clamp(playbackSpeed+.05,.1,2).toFixed(2));break;
      case 'insert':$('insertDisclosure').open=true;if(selectedGap===null){if(currentNote())$('insertStart').value=currentNote().start+1;else shortcutClick('insertAtPlayhead');}$('insertPitch').focus();break;
      case 'help':$('shortcutsDialog').showModal();break;
    }
  }catch(error){toast(error.message,true);}
});

window.addEventListener('beforeunload',e=>{if(job||dirty||(draftShouldPersist&&localDraft&&!pendingDraftSaved)){e.preventDefault();e.returnValue='';}});window.addEventListener('resize',()=>{drawWave();drawSectionTrack();if($('localDraftDialog').open)renderDraftScores();});
function setDrawer(open){$('audioDrawer').hidden=!open;$('drawerBackdrop').hidden=!open;$('audioDrawerToggle').ariaExpanded=String(open);}
on('audioDrawerToggle','click',()=>setDrawer($('audioDrawer').hidden));on('audioDrawerClose','click',()=>setDrawer(false));on('drawerBackdrop','click',()=>setDrawer(false));
on('sectionsToggle','click',()=>{$('sectionsPanel').open=!$('sectionsPanel').open;$('sectionsToggle').ariaExpanded=String($('sectionsPanel').open);if($('sectionsPanel').open){for(let parent=$('sectionsPanel').parentElement.closest('details');parent;parent=parent.parentElement.closest('details'))parent.open=true;$('sectionsPanel').scrollIntoView({block:'nearest'});drawSectionTrack();}});
on('toolbarCopy','click',()=>chosenLyricIds().size?copySelectedLyrics():copySelection());on('toolbarCut','click',()=>{if(chosenLyricIds().size)copySelectedLyrics(true);else{copySelection();if(selectedIds.size)$('batchDelete').click();else removeNote();}});on('toolbarPaste','click',()=>clipboardKind==='lyrics'?pasteSelectedLyrics():pasteSelection());on('toolbarSplit','click',()=>chosenLyricIds().size?$('lyricSplitWord').click():$('splitNote').click());on('toolbarMerge','click',()=>{if(chosenLyricIds().size){$('lyricMergeWord').click();return;}if(chosenIds().size>1)requestMerge(chosenIds());else $('mergeNote').click();});on('toolbarDelete','click',()=>{if(chosenLyricIds().size){deleteSelectedLyric();return;}if(selectedIds.size)$('batchDelete').click();else removeNote();});
for(const id of ['batchPitch','mergePitch']){const menu=$(id);menu.add(new Option('0 · 休止符','rest'));for(let m=21;m<=108;m++)menu.add(new Option(`${pitchName(m)} · MIDI ${m}`,m));menu.value='60';}
on('batchReplace','click',()=>{const ids=chosenIds(),midi=$('batchPitch').value==='rest'?null:Number($('batchPitch').value);if(ids.size<2)return;commit({...project,notes:project.notes.map(n=>ids.has(n.id)?{...n,midi,confidence:1,reviewStatus:'reviewed',reviewFlags:[]}:n)},{keepPlayback:true});toast('已替换所选音高，可一次撤销。');});
function requestMerge(ids){
  if(!continuousSelection(project.notes,ids))throw Error('合并需要连续选择；分散选择可删除、复制或替换音高');
  const notes=project.notes.filter(n=>ids.has(n.id)),same=notes.every(n=>n.midi===notes[0].midi),gaps=notes.slice(1).some((n,i)=>n.start>notes[i].start+notes[i].duration+1e-6);
  if(same&&(!gaps||$('batchFillGaps').checked)){applyMerge(ids,{fillGaps:$('batchFillGaps').checked});return;}
  pendingMerge={ids:new Set(ids),project};$('mergeMidiInput').value='';$('mergePitch').value=notes[0].midi===null?'rest':String(notes[0].midi);$('mergeFillGaps').checked=$('batchFillGaps').checked;$('mergeFillGaps').disabled=!gaps;
  $('mergeSummary').textContent=`合并 ${notes.length} 音；原音高：${[...new Set(notes.map(n=>pitchName(n.midi)))].join('、')}。${gaps?'中间含空拍，需要明确勾选填入。':''}`;$('mergeDialog').showModal();
}
function applyMerge(ids,options){const result=mergeSelectedNotes(project,ids,options);marqueeMode=false;commit(result.project,{keepPlayback:true});selectNote(result.id);toast(`已将 ${result.count} 音合为一音，可一次撤销。`);}
on('mergeConfirm','click',()=>{if(!pendingMerge||pendingMerge.project!==project)throw Error('工程已变化，请重新选择');const typed=$('mergeMidiInput').value,midi=typed!==''?Number(typed):$('mergePitch').value==='rest'?null:Number($('mergePitch').value);applyMerge(pendingMerge.ids,{midi,fillGaps:$('mergeFillGaps').checked});$('mergeDialog').close();});$('mergeDialog').addEventListener('close',()=>pendingMerge=null);
let audioLatency=0;
function syncSpeedControls(){for(const prefix of ['main','draft']){$(prefix+'Speed').value=String(playbackSpeed);$(prefix+'SpeedValue').value=String(playbackSpeed);}}
async function ensureSlowPlayback(){if(playbackSpeed===1){audioLatency=0;return;}try{const m=await prepareAudioPlayback(ctx);audioLatency=await m.playbackLatency(ctx,playbackSpeed);}catch(error){playbackSpeed=1;audioLatency=0;localStorage.setItem('jianpu-playback-speed','1');syncSpeedControls();toast('保音高慢放不可用，已恢复 1 倍：'+error.message,true);}}
function changeSpeed(value){const speed=validSpeed(value);if(speed===playbackSpeed){syncSpeedControls();return;}const mainWas=playing||playStarting,draftWas=draftPlayback?.playing,kind=draftPlayback?.kind;stopPlayback(false);if(draftWas)stopDraftPlayback(true);playbackSpeed=speed;localStorage.setItem('jianpu-playback-speed',String(speed));syncSpeedControls();if(mainWas)play({continueLoop:true}).catch(error=>toast(error.message,true));else if(draftWas)startDraftPlayback(kind,true).catch(error=>toast(error.message,true));}
for(const prefix of ['main','draft']){on(prefix+'Speed','input',e=>changeSpeed(e.target.value));on(prefix+'SpeedValue','input',e=>{const value=Number(e.target.value);if(e.target.value!==''&&Number.isFinite(value)&&value>=.1&&value<=2)changeSpeed(value);});on(prefix+'SpeedValue','change',e=>changeSpeed(e.target.value));on(prefix+'SpeedReset','click',()=>changeSpeed(1));}syncSpeedControls();
on('lyricsToggle','click',()=>{lyricsOpen=!lyricsOpen;if(!lyricsOpen)lyricLinking=false;if(lyricsOpen&&!audioResources.some(r=>r.source==='vocals'))$('lyricsSource').value='original';$('lyricsToggle').ariaPressed=String(lyricsOpen);renderSelectionTools();renderLyrics();if(lyricsOpen&&!lyricsTask)checkLyricsStatus();});on('lyricsClose','click',()=>{lyricLinking=false;lyricsOpen=false;$('lyricsToggle').ariaPressed='false';renderSelectionTools();});
const EMPTY_LYRICS=[];
const visibleLyrics=()=>lyricsPreview??project.lyrics??EMPTY_LYRICS;
function lyricViewProject(){return lyricsPreview===null?project:{...project,notes:project.notes.map(n=>({...n,lyric:""})),lyrics:normalizeLyrics(lyricsPreview,project.notes)};}
let lyricTimelineCache=null;const scoreLyricTokens=()=>{const tokens=visibleLyrics();if(lyricTimelineCache?.project===project&&lyricTimelineCache?.tokens===tokens)return lyricTimelineCache.result;const result=timelineLyrics(lyricViewProject());lyricTimelineCache={project,tokens,result};return result;};
const chosenLyricIds=()=>new Set(selectedLyricIds.size?selectedLyricIds:lyricSelection?[lyricSelection]:[]);
function clearLyricSelection(){lyricSelection=null;selectedLyricIds.clear();lyricAnchor=null;}
function selectedLyricToken(){return scoreLyricTokens().find(t=>t.id===lyricSelection);}
function renderLyricTools(){
  const list=scoreLyricTokens(),valid=new Set(list.map(t=>t.id));selectedLyricIds=new Set([...selectedLyricIds].filter(id=>valid.has(id)));if(lyricSelection&&!valid.has(lyricSelection))lyricSelection=null;
  const n=chosenLyricIds().size,busy=Boolean(job)||Boolean(lyricsTask)||scorePending||transcribing;
  $('lyricClipboardSummary').textContent=lyricClipboard?`已复制 ${lyricClipboard.tokens.length} 条歌词 · ${lyricClipboard.span.toFixed(2)} 秒`:'可在谱面或字词列表 Ctrl 多选；Shift 选择连续歌词';
  for(const id of ['lyricCopy','lyricCut','lyricDeleteSelection','lyricShiftApply'])$(id).disabled=busy||!n;
  $('lyricPaste').disabled=busy||!lyricClipboard;
  $('toolbarCut').disabled=busy||(!n&&!chosenIds().size);
  if(n){$('selectionCount').textContent=`已选 ${n} 条歌词`;$('toolbarCopy').disabled=busy;$('toolbarDelete').disabled=busy;$('toolbarSplit').disabled=busy||n!==1||selectedLyricToken()?.start===null;$('toolbarMerge').disabled=busy||n!==1;}
  $('toolbarPaste').disabled=busy||(clipboardKind==='lyrics'?!lyricClipboard:!noteClipboard);
  for(const id of ['toolbarCopy','toolbarCut','toolbarDelete','toolbarSplit','toolbarMerge','toolbarPaste']){$(id).title=CONTROL_HELP[id];$(id).dataset.uiHelp=CONTROL_HELP[id];}
}
function copySelectedLyrics(cut=false){if(job||lyricsTask)throw Error('请等待分析结束');lyricClipboard=copyLyrics(scoreLyricTokens(),chosenLyricIds());clipboardKind='lyrics';const end=Math.max(...scoreLyricTokens().filter(t=>chosenLyricIds().has(t.id)).map(t=>t.end));$('lyricPasteSecond').value=+end.toFixed(3);if(cut)deleteSelectedLyric();renderLyricTools();toast(`已${cut?'剪切':'复制'} ${lyricClipboard.tokens.length} 条歌词；点谱面空白后粘贴。`);}
function pasteSelectedLyrics(){if(job||lyricsTask)throw Error('请等待分析结束');const start=selectedGap!==null?timeAtBeat(project,selectedGap):Number($('lyricPasteSecond').value),result=pasteLyrics(project,scoreLyricTokens(),lyricClipboard,start,{overwrite:$('lyricPasteOverwrite').checked,maxSeconds:original?.duration||3600});writeLyrics(result.tokens);selectedLyricIds=new Set(result.ids);lyricSelection=result.ids[0];selectedGap=null;$('lyricPasteSecond').value=+(start+lyricClipboard.span).toFixed(3);render();toast('歌词已粘贴，时间间隔保持不变；可一次撤销。');}
on('lyricCopy','click',()=>copySelectedLyrics());on('lyricCut','click',()=>copySelectedLyrics(true));on('lyricPaste','click',pasteSelectedLyrics);on('lyricDeleteSelection','click',deleteSelectedLyric);
on('lyricPasteAtPlayhead','click',()=>{clearLyricSelection();selectedGap=null;$('lyricPasteSecond').value=+(playPosition+project.offset).toFixed(3);render();});on('lyricPasteSecond','input',()=>{selectedGap=null;renderSelectionTools();});
function applyLyricShift(seconds,ids=chosenLyricIds()){
  if(linkedActive())commit(moveAssociatedLyrics(project,ids,seconds,{maxSeconds:original?.duration||3600}).project,{keepPlayback:true});
  else writeLyrics(shiftLyrics(project,scoreLyricTokens(),ids,seconds,{maxSeconds:original?.duration||3600}));
}
on('lyricShiftApply','click',()=>{if(job||lyricsTask)throw Error('请等待分析结束');applyLyricShift(Number($('lyricShiftSeconds').value));toast(linkedActive()?'所选歌词及对应组已一起移动，可一次撤销。':'所选歌词已独立移动，可一次撤销。');});
function currentLyricRanges(){return lyricRanges(project,original?.duration,{mode:$('lyricsScope').value,manual:$('lyricsManualRange').checked,from:$('lyricsFrom').value,to:$('lyricsTo').value});}
function renderLyrics(){renderLinkedStatus();
  if(!$('lyricsList'))return;const list=scoreLyricTokens();$('lyricsPreviewBar').hidden=lyricsPreview===null;
  const signature=JSON.stringify(list.map(t=>[t.id,t.text,t.noteIds,t.start,t.end]));if($('lyricsList').dataset.signature!==signature){$('lyricsList').dataset.signature=signature;$('lyricsList').innerHTML=list.map(t=>`<button data-lyric="${escapeXML(t.id)}" class="${t.noteIds.length?'':'unlinked'}">${escapeXML(t.text)}</button>`).join('')||'<p class="hint">尚无歌词。可识别、导入或手工添加。</p>';}
  document.querySelectorAll('#lyricsList [data-lyric],#score .score-lyric-bar').forEach(el=>el.classList.toggle('active',chosenLyricIds().has(el.dataset.lyric)));const token=list.find(t=>t.id===lyricSelection);$('lyricEditor').hidden=!token||chosenLyricIds().size>1;
  if(token&&document.activeElement?.id!=='lyricText'){$('lyricText').value=token.text;$('lyricStart').value=token.start??'';$('lyricEnd').value=token.end??'';}
  const scope=$('lyricsScope'),scopeSignature=JSON.stringify((project.sections||[]).map(s=>[s.id,s.name]));if(scope.dataset.signature!==scopeSignature){const value=scope.value;scope.dataset.signature=scopeSignature;scope.replaceChildren(new Option('自动 · 全部人声区段','auto'),new Option('整曲','whole'),...(project.sections||[]).map(s=>new Option(s.name,s.id)));scope.value=[...scope.options].some(o=>o.value===value)?value:'auto';}
  try{const ranges=currentLyricRanges();$('lyricsRangeSummary').textContent=ranges.map(r=>`${r.name} ${timeText(r.from)}–${timeText(r.to)}`).join('；');}catch(error){$('lyricsRangeSummary').textContent=original?error.message:'导入原音后自动选择人声区段，无需填写时间。';}
  for(const id of ['lyricsTranscribe','lyricsAlign','lyricsImport','lyricsRematch','lyricsNew','lyricsApply','lyricsOpenFile','lyricsDiscard','lyricsSource','lyricsLanguage','lyricsFrom','lyricsTo','lyricsScope','lyricsManualRange','lyricSave','lyricLink','lyricUnlink','lyricPrev','lyricNext','lyricDelete','inlineLyricSave','inlineLyricDelete','inlineLyricLink','inlineLyricUnlink','inlineLyricPrev','inlineLyricNext','lyricsChooseNotes','lyricsLinkSelection','inlineLyricChoose','lyricBatchAssign','lyricBatchReplace','lyricBatchText','lyricBatchMode','lyricReplaceScope','lyricBatchFind','lyricBatchReplacement'])$(id).disabled=Boolean(job)||Boolean(lyricsTask);
  for(const id of ['openProject','newBtn','demoBtn','importMidi','restoreBackup','applyLocalDraft','audioFile'])$(id).disabled=Boolean(job)||Boolean(lyricsTask);
  for(const id of ['lyricRemapPhrase','inlineLyricRemap','lyricResplitPhrase','inlineLyricResplit','lyricSplitWord','lyricMergeWord'])$(id).disabled=Boolean(job)||Boolean(lyricsTask)||!token||token.start===null;
  const selectedNotes=project.notes.filter(n=>chosenIds().has(n.id)&&n.midi!==null),busy=Boolean(job)||Boolean(lyricsTask);$('lyricSelectionStatus').textContent=token?`为“${token.text}”选择对应音符 · 已选${selectedNotes.length}音${lyricLinking?' · 点击谱面或Ctrl多选，然后点关联':''}`:`已选${selectedNotes.length}音 · 先点字词，或展开手工输入`;for(const id of ['lyricLink','inlineLyricLink','lyricsLinkSelection'])$(id).disabled=busy||!token||!selectedNotes.length;for(const id of ['lyricsChooseNotes','inlineLyricChoose'])$(id).disabled=busy||!token;$('lyricBatchAssign').disabled=busy||!selectedNotes.length;$('lyricBatchCount').textContent=`已选${selectedNotes.length}个有音高的音符，按谱面起点排序；休止符不填歌词。`;if(!token)closeLyricPopup();$('clearSelection').disabled=!chosenIds().size&&selectedGap===null&&!lyricSelection;renderLyricTools();syncLyricsAtPlayhead();
}
function syncLyricsAtPlayhead(){const second=playPosition+project.offset,tokens=scoreLyricTokens(),active=playing?tokens.filter(t=>{const a=t.start??(t.beatStart!==null?timeAtBeat(project,t.beatStart):null),b=t.end??(t.beatEnd!==null?timeAtBeat(project,t.beatEnd):null);return a!==null&&second>=a&&second<b;}).map(t=>t.id):[],currentRow=rowForBeat(scoreBeat(playPosition));document.querySelectorAll('#lyricsList [data-lyric],#score .score-lyric-bar').forEach(el=>{const current=active.includes(el.dataset.lyric),fragment=el.classList.contains('score-lyric-bar')?scoreBeat(playPosition)>=Number(el.dataset.start)&&Number(el.dataset.row)===currentRow:true;el.toggleAttribute('data-playing-lyric',current&&fragment);});}
function rowForBeat(beat){const rows=$('score').querySelector('.graphical-score')?.dataset.rowStarts.split(',').map(Number)||[];return rows.findIndex((r,i)=>i<rows.length-1&&beat>=r-1e-6&&beat<rows[i+1]-1e-6);}
function writeLyrics(tokens){if(lyricsPreview!==null){undo.push(historySnapshot());redo=[];lyricsPreview=normalizeLyrics(tokens,project.notes);render();}else commit({...project,notes:project.notes.map(n=>({...n,lyric:''})),lyrics:tokens},{keepPlayback:true});}
function editLyric(change,{linkedMove}={}){const t=selectedLyricToken();if(!t)throw Error('先选中字词');
  const hasTime=Number.isFinite(change.start)&&Number.isFinite(change.end),changedTime=hasTime&&(Math.abs(change.start-(t.start??timeAtBeat(project,t.beatStart)))>1e-6||Math.abs(change.end-(t.end??timeAtBeat(project,t.beatEnd)))>1e-6);
  if(linkedActive()&&t.noteIds.length&&changedTime&&(linkedMove??(Math.abs((change.end-change.start)-((t.end??timeAtBeat(project,t.beatEnd))-(t.start??timeAtBeat(project,t.beatStart))))<.001))){
    const result=retimeAssociated(project,{kind:'lyric',id:t.id,start:beatAtTime(project,change.start),end:beatAtTime(project,change.end),maxSeconds:original?.duration||3600});
    commit({...result.project,lyrics:result.project.lyrics.map(x=>x.id===t.id?{...x,text:change.text??t.text}:x)},{keepPlayback:true});return;
  }
const tokens=scoreLyricTokens().map(x=>x.id===t.id?{...x,...change,source:x.legacyNoteId?'manual':x.source,reviewed:true}:x);if(lyricsPreview!==null)writeLyrics(tokens);else commit({...project,notes:project.notes.map(n=>({...n,lyric:""})),lyrics:tokens},{keepPlayback:true});}
function closeLyricPopup(){lyricPopupOpen=false;$('scoreLyricEditor').hidden=true;}
function selectScoreLyric(id,element,event){const list=scoreLyricTokens().sort((a,b)=>(a.start??Infinity)-(b.start??Infinity));selectedLyricIds=chooseNotes(list,chosenLyricIds(),id,{toggle:Boolean(event?.ctrlKey||event?.metaKey),range:Boolean(event?.shiftKey),anchor:lyricAnchor});if(!event?.shiftKey)lyricAnchor=id;lyricSelection=selectedLyricIds.has(id)?id:[...selectedLyricIds].at(-1)||null;if(!lyricLinking){selected=null;selectedIds.clear();selectedGap=null;updateSelectionStyles();}clipboardKind='lyrics';const t=selectedLyricToken();renderSelectionTools();renderLyrics();if(!t||selectedLyricIds.size>1){if(selectedLyricIds.size>1){lyricsOpen=true;$('lyricsToggle').ariaPressed='true';renderSelectionTools();}closeLyricPopup();return;}lyricPopupOpen=true;const popup=$('scoreLyricEditor');popup.hidden=false;$('inlineLyricText').value=t.text;const fallback=currentNote()?.start??selectedGap??scoreBeat(playPosition),start=t.start??timeAtBeat(project,t.beatStart??fallback),end=t.end??timeAtBeat(project,t.beatEnd??(fallback+1));$('inlineLyricStart').value=+start.toFixed(3);$('inlineLyricDuration').value=+(end-start).toFixed(3);const g=element||$('score').querySelector(`[data-lyric="${id}"]`),rect=g?.getBoundingClientRect();const width=popup.offsetWidth,height=popup.offsetHeight,left=rect&&rect.right+width+16<window.innerWidth?rect.right+8:rect&&rect.left>width+16?rect.left-width-8:window.innerWidth-width-16;popup.style.left=Math.max(8,Math.min(window.innerWidth-width-8,left))+'px';popup.style.top=Math.max(68,Math.min(window.innerHeight-height-8,(rect?.top??300)-36))+'px';const sidebar=document.querySelector('.inspector').getBoundingClientRect();if(sidebar.width>=width+16){popup.style.left=Math.min(window.innerWidth-width-8,sidebar.left+8)+'px';popup.style.top=Math.max(68,Math.min(window.innerHeight-height-8,sidebar.top+44))+'px';}}
function updateInlineLyric(){const t=selectedLyricToken();if(!t)return;const start=Number($('inlineLyricStart').value),end=start+Number($('inlineLyricDuration').value),changed=Math.abs(start-(t.start??timeAtBeat(project,t.beatStart)))<.001&&Math.abs(end-(t.end??timeAtBeat(project,t.beatEnd)))<.001?t:retimeLyric(project,t,start,end,{maxSeconds:original?.duration||3600});editLyric({...changed,text:$('inlineLyricText').value});const g=$('score').querySelector(`[data-lyric="${lyricSelection}"]`);selectScoreLyric(lyricSelection,g);}
function deleteSelectedLyric(){const ids=chosenLyricIds();if(!ids.size)return;const tokens=scoreLyricTokens().filter(t=>!ids.has(t.id));if(lyricsPreview!==null)writeLyrics(tokens);else commit({...project,notes:project.notes.map(n=>({...n,lyric:""})),lyrics:tokens},{keepPlayback:true});clearLyricSelection();closeLyricPopup();renderSelectionTools();renderLyrics();}
function loopSelectedLyric(){const t=selectedLyricToken();if(!t||!original)throw Error('需要原音和字词的起止时间');const a=t.start??timeAtBeat(project,t.beatStart),b=t.end??timeAtBeat(project,t.beatEnd);if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('先给歌词定位');$('playMode').value='original';barLoop={start:Math.max(0,a-project.offset-.25),end:Math.min(totalSeconds(),b-project.offset+.25)};seekTo(barLoop.start,false);return play({continueLoop:true});}
function previewLinkedDrag(d,kind,id,start,end){
  if(d.mode!=='move'||!d.linkedGroup?.lyricIds.size)return;
  const signature=start+':'+end;if(d.linkedSignature===signature)return;d.linkedSignature=signature;
  try{
    const next=retimeAssociated(project,{kind,id,start,end,group:d.linkedGroup,maxSeconds:original?.duration||3600}).project;
    const svg=d.svg;
    d.linkedElements ||= [...svg.querySelectorAll('[data-note],.score-lyric-bar')].filter(el=>d.linkedGroup.noteIds.has(el.dataset.note)||d.linkedGroup.lyricIds.has(el.dataset.lyric));
    for(const el of d.linkedElements)el.style.opacity='.2';
    let ghost=svg.querySelector('[data-linked-preview]');if(!ghost){ghost=document.createElementNS('http://www.w3.org/2000/svg','g');ghost.dataset.linkedPreview='1';ghost.setAttribute('aria-hidden','true');ghost.setAttribute('pointer-events','none');svg.append(ghost);}
    ghost.innerHTML=linkedPreviewSVG(next,d.linkedGroup,{starts:svg.dataset.rowStarts.split(',').map(Number),ys:svg.dataset.rowYs.split(',').map(Number),left:Number(svg.dataset.left),zoom:Number(svg.dataset.zoom),flats:$('flats').checked});
  }catch{d.svg.querySelector('[data-linked-preview]')?.remove();for(const el of d.linkedElements||[])el.style.opacity='';}
}
function beginLyricDrag(e,g){if(job||lyricsTask)return;const t=scoreLyricTokens().find(t=>t.id===g.dataset.lyric);if(!t||t.beatStart===null)return;closeLyricPopup();const svg=g.closest('.graphical-score');lyricDrag={token:t,element:g,svg,mode:e.target.closest('[data-lyric-resize]')?.dataset.lyricResize||'move',x:e.clientX,y:e.clientY,row:Number(g.dataset.row),zoom:Number(svg.dataset.zoom)/svgPoint(e,svg).scale,start:t.beatStart,end:t.beatEnd,previewStart:t.beatStart,previewEnd:t.beatEnd,moved:false,linkedGroup:linkedActive()&&t.noteIds.length&&!e.target.closest('[data-lyric-resize]')?associatedGroup(project,{lyricIds:[t.id]}):null};g.setPointerCapture(e.pointerId);}
function moveLyricDrag(e){const d=lyricDrag;if(!d)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<4&&!d.moved)return;d.moved=true;const rows=d.svg.dataset.rowStarts.split(',').map(Number),row=d.mode==='move'?rowAtPointer(e,d.svg):d.row,delta=snap((e.clientX-d.x)/d.zoom+rows[row]-rows[d.row],EDIT_STEP),maxBeat=beatAtTime(project,original?.duration||3600),minimum=Math.max(.0001,beatAtTime(project,timeAtBeat(project,d.start)+.02)-d.start);if(d.mode==='move'){d.previewStart=clamp(d.start+delta,0,Math.max(0,maxBeat-(d.end-d.start)));d.previewEnd=d.previewStart+d.end-d.start;}else if(d.mode==='start'){d.previewStart=clamp(d.start+delta,0,d.end-minimum);d.previewEnd=d.end;}else{d.previewStart=d.start;d.previewEnd=clamp(d.end+delta,d.start+minimum,maxBeat);}const ribbon=d.element.querySelector('.lyric-ribbon');if(d.mode==='move'){const ys=d.svg.dataset.rowYs.split(',').map(Number),dx=(d.previewStart-d.start-rows[row]+rows[d.row])*Number(d.svg.dataset.zoom),dy=ys[row]-ys[d.row];d.element.setAttribute('transform',`translate(${dx} ${dy})`);}else{const width=d.svg.dataset.zoom*(d.previewEnd-d.previewStart),baseX=Number(d.element.dataset.baseX||ribbon.getAttribute('x'));d.element.dataset.baseX=baseX;const x=baseX+(d.previewStart-d.start)*Number(d.svg.dataset.zoom);ribbon.setAttribute('x',x);ribbon.setAttribute('width',Math.max(3,width-2));d.element.querySelector('.score-lyric').setAttribute('x',x+width/2);const clip=d.element.querySelector('clipPath rect');clip.setAttribute('x',x+3);clip.setAttribute('width',Math.max(0,width-6));d.element.querySelector('[data-lyric-resize="start"]').setAttribute('x',x);d.element.querySelector('[data-lyric-resize="end"]').setAttribute('x',x+Math.max(0,width-10));}previewLinkedDrag(d,'lyric',d.token.id,d.previewStart,d.previewEnd);}
function endLyricDrag(){const d=lyricDrag;lyricDrag=null;if(!d)return;suppressScoreClick=true;setTimeout(()=>suppressScoreClick=false,0);lyricSelection=d.token.id;if(!d.moved){selectScoreLyric(d.token.id,d.element);return;}if(d.mode==='move'&&chosenLyricIds().size>1&&chosenLyricIds().has(d.token.id)){try{const delta=timeAtBeat(project,d.previewStart)-timeAtBeat(project,d.start);applyLyricShift(delta);}catch(error){render();toast(error.message,true);}return;}selectedLyricIds=new Set([d.token.id]);try{const changed=retimeLyric(project,d.token,timeAtBeat(project,d.previewStart),timeAtBeat(project,d.previewEnd),{maxSeconds:original?.duration||3600});editLyric(changed,{linkedMove:d.mode==='move'});}catch(error){render();toast(error.message,true);}}
$('lyricsList').addEventListener('click',e=>{const el=e.target.closest('[data-lyric]');if(!el)return;const id=el.dataset.lyric,t=scoreLyricTokens().find(t=>t.id===id);if(t.start!==null)seekTo(Math.max(0,t.start-project.offset),false);renderLyrics();const g=$('score').querySelector(`[data-lyric="${id}"]`);if(g)g.scrollIntoView({block:'nearest'});selectScoreLyric(id,g,e);});
for(const [a,b] of [['inlineLyricLink','lyricLink'],['inlineLyricUnlink','lyricUnlink'],['inlineLyricPrev','lyricPrev'],['inlineLyricNext','lyricNext']])on(a,'click',()=>{$(b).click();selectScoreLyric(lyricSelection);});on('inlineLyricClose','click',closeLyricPopup);on('inlineLyricSave','click',updateInlineLyric);on('inlineLyricDelete','click',deleteSelectedLyric);on('inlineLyricLoop','click',loopSelectedLyric);on('inlineLyricText','keydown',e=>{if(e.key==='Enter'){e.preventDefault();updateInlineLyric();}});
function beginLyricNoteSelection(){if(!selectedLyricToken())throw Error('先点击要对应的字词');lyricsOpen=true;lyricLinking=true;closeLyricPopup();$('lyricsToggle').ariaPressed='true';renderSelectionTools();renderLyrics();}
on('lyricsChooseNotes','click',beginLyricNoteSelection);on('inlineLyricChoose','click',beginLyricNoteSelection);on('lyricsLinkSelection','click',()=>$('lyricLink').click());
on('batchLyrics','click',()=>{lyricsOpen=true;$('lyricsToggle').ariaPressed='true';$('lyricManualTools').open=true;renderSelectionTools();renderLyrics();});
on('noteLyrics','click',()=>{lyricsOpen=true;$('lyricsToggle').ariaPressed='true';const t=scoreLyricTokens().find(t=>t.noteIds.includes(selected));if(t)lyricSelection=t.id;renderSelectionTools();renderLyrics();if(!t)$('lyricsNew').click();});
function applyManualLyricProject(next){if(lyricsPreview!==null)writeLyrics(next.lyrics);else commit(next,{keepPlayback:true});}
on('lyricBatchAssign','click',()=>{applyManualLyricProject(assignNoteLyrics(lyricViewProject(),chosenIds(),$('lyricBatchText').value,{mode:$('lyricBatchMode').value,language:textLanguage($('lyricBatchText').value,$('lyricsLanguage').value,scoreLyricTokens())}));toast('歌词已填入所选音符，可一次撤销。');});
on('lyricBatchReplace','click',()=>{const result=replaceLyricText(lyricViewProject(),$('lyricBatchFind').value,$('lyricBatchReplacement').value,{ids:$('lyricReplaceScope').value==='all'?null:chosenIds()});applyManualLyricProject(result.project);toast(`已修改${result.count}条文字，可一次撤销。`);});
on('lyricsNew','click',()=>{const id=uid(),note=currentNote(),a=note?.start??selectedGap??scoreBeat(playPosition),b=note?note.start+note.duration:a+1,max=original?.duration||3600,start=Math.min(max-.02,Math.max(0,timeAtBeat(project,a))),end=Math.max(start+.02,Math.min(max,timeAtBeat(project,b)));lyricSelection=id;const tokens=[...scoreLyricTokens(),{id,text:'字',start,end,noteIds:note?[note.id]:[],source:'manual',language:textLanguage('',$('lyricsLanguage').value,scoreLyricTokens()),reviewed:true}];if(lyricsPreview!==null)writeLyrics(tokens);else commit({...project,notes:project.notes.map(n=>({...n,lyric:""})),lyrics:tokens},{keepPlayback:true});selectScoreLyric(id);});
on('lyricSave','click',()=>{const start=$('lyricStart').value===''?null:Number($('lyricStart').value),end=$('lyricEnd').value===''?null:Number($('lyricEnd').value);editLyric({text:$('lyricText').value,start,end});});
on('lyricLink','click',()=>{const notes=project.notes.filter(n=>chosenIds().has(n.id)&&n.midi!==null);if(!notes.length)throw Error('先点击谱面音符；Ctrl点击可多选');const change={noteIds:notes.map(n=>n.id)};if($('lyricLinkFollowTime').checked){const a=timeAtBeat(project,notes[0].start),b=timeAtBeat(project,notes.at(-1).start+notes.at(-1).duration);change.start=a>=0&&b>a?a:null;change.end=change.start===null?null:b;}editLyric(change);lyricLinking=false;renderLyrics();toast(`已关联${notes.length}音，可一次撤销。`);});on('lyricUnlink','click',()=>editLyric({noteIds:[]}));
for(const [id,delta] of [['lyricPrev',-1],['lyricNext',1]])on(id,'click',()=>{const t=selectedLyricToken(),notes=project.notes.filter(n=>n.midi!==null);if(!t?.noteIds.length)throw Error('先关联一个音符');const indices=t.noteIds.map(id=>notes.findIndex(n=>n.id===id));if(indices.some(i=>i+delta<0||i+delta>=notes.length))throw Error('对应已到谱面边界');editLyric({noteIds:indices.map(i=>notes[i+delta].id)});});
on('lyricDelete','click',deleteSelectedLyric);on('lyricLoop','click',loopSelectedLyric);
for(const id of ['lyricsScope','lyricsManualRange','lyricsFrom','lyricsTo'])on(id,'change',renderLyrics);
on('lyricsImport','click',()=>{const text=$('lyricsImportText').value,range=original?currentLyricRanges()[0]:{from:0,to:timeAtBeat(project,(project.notes.at(-1)?.start||0)+(project.notes.at(-1)?.duration||1))};const tokens=importLyrics(text,{start:range.from,end:range.to,language:textLanguage(text,$('lyricsLanguage').value,scoreLyricTokens())});lyricsPreview=normalizeLyrics([...scoreLyricTokens(),...tokens],project.notes);lyricSelection=tokens[0]?.id;render();});
on('lyricsOpenFile','click',()=>$('lyricsFile').click());on('lyricsFile','change',async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1024*1024)throw Error('歌词文件过大');$('lyricsImportText').value=await file.text();});
on('lyricsRematch','click',()=>{lyricsPreview=matchLyrics(project,scoreLyricTokens());render();});
on('lyricsApply','click',()=>{if(lyricsPreview===null)return;const tokens=lyricsPreview;lyricsPreview=null;commit({...project,notes:project.notes.map(n=>({...n,lyric:""})),lyrics:tokens},{keepPlayback:true});toast('歌词对应已采用，可一次撤销。');});
on('lyricsDiscard','click',()=>{lyricsPreview=null;closeLyricPopup();render();});
function lyricProgress(value,label){if(lyricsTask)lyricsTask.progress=value;$('lyricsProgressArea').hidden=false;$('lyricsProgress').value=Math.max(0,Math.min(100,value*100));$('lyricsProgressText').textContent=Math.round(value*100)+'% · '+label;}
async function lyricsAnalysis(kind){
  if(job||lyricsTask)throw Error('请等待当前分析结束');if(!original)throw Error('先导入原音');
  let chosen=selectedLyricToken(),alignIds=new Set();let ranges;
  if(kind==='align'){
    const tokens=scoreLyricTokens(),selection=tokens.filter(t=>chosenLyricIds().has(t.id));let phrase;
    if(selection.length>1){const positioned=selection.filter(t=>t.start!==null);if(positioned.length!==selection.length&&!$('lyricsManualRange').checked)throw Error('未定位歌词请在高级设置指定本句原音范围');phrase={tokens:selection,text:selection.map(t=>t.text).join(['zh','yue','ja'].includes(chosen?.language)?'':' '),from:Math.min(...positioned.map(t=>t.start)),to:Math.max(...positioned.map(t=>t.end)),language:chosen?.language};}
    else if($('lyricsManualRange').checked&&chosen)phrase={tokens:[chosen],text:chosen.text,language:chosen.language};
    else phrase=lyricPhrase(tokens,chosen);
    alignIds=new Set(phrase.tokens.map(t=>t.id));chosen={...chosen,text:phrase.text,language:phrase.language};
    ranges=$('lyricsManualRange').checked?[{from:Number($('lyricsFrom').value),to:Number($('lyricsTo').value),name:'手动本句范围'}]:[{from:Math.max(0,phrase.from-.4),to:Math.min(original.duration,phrase.to+.4),name:'本句原音对齐'}];
  }else ranges=currentLyricRanges();
  if(ranges.some(r=>!Number.isFinite(r.from)||!Number.isFinite(r.to)||r.from<0||r.to<=r.from||r.to>original.duration+.01))throw Error('先给所选句子定位');
  const execution=selectedCompute(),source=$('lyricsSource').value,language=kind==='align'?alignmentLanguage($('lyricsLanguage').value,chosen):$('lyricsLanguage').value,total=ranges.reduce((sum,r)=>sum+r.to-r.from,0),task={controller:new AbortController(),index:0,completed:0};lyricsTask=task;closeLyricPopup();lyricProgress(0,'准备音频');
  const progressTimer=setInterval(async()=>{try{const r=await fetch('/api/lyrics/status',{headers:{'X-Studio-Token':token}}),s=await r.json();if(lyricsTask===task&&s.job){const range=ranges[task.index],value=(task.completed+(range.to-range.from)*Math.min(.99,s.job.progress))/total;lyricProgress(value,range.name+' · '+s.job.stage);$('lyricsStatus').textContent=`第 ${task.index+1}/${ranges.length} 段 · ${s.job.stage}`;}}catch{}},700);$('lyricsCancel').hidden=false;renderLyrics();
  const retained=kind==='align'?scoreLyricTokens().filter(t=>!alignIds.has(t.id)):scoreLyricTokens().filter(t=>t.reviewed||t.start===null||!ranges.some(r=>t.start<r.to&&t.end>r.from)),protectedWords=retained.filter(t=>t.reviewed&&t.start!==null),collected=[],warnings=new Set(),devices=new Set();
  try{
    await ensureOriginalResource(task);const device=execution.mode==='performance'&&execution.device!=='cpu'&&computeStatus?.torchCUDA?'cuda':'cpu';
    for(let i=0;i<ranges.length;i++){task.index=i;const {from,to,name}=ranges[i];task.controller.signal.throwIfAborted();lyricProgress(task.completed/total,name+' · 准备识别');let actualSource=source,resource=audioResources.filter(r=>r.source===source&&r.audioStart<=from&&r.audioEnd>=to).sort((a,b)=>(a.audioEnd-a.audioStart)-(b.audioEnd-b.audioStart))[0];
      if(!resource){actualSource='original';resource=audioResources.find(r=>r.source==='original');if(source==='vocals')warnings.add('部分区段无人声资源，使用原曲');}if(!resource)throw Error('原音资源尚未就绪');
      const result=await api('lyrics/'+kind,{resourceId:resource.id,from,to,source:actualSource,language,text:chosen?.text,device,threads:execution.threads},task.controller.signal);task.controller.signal.throwIfAborted();collected.push(...wordsFromSegments(result.segments,result.language).filter(t=>kind==='align'||t.start===null||!protectedWords.some(m=>Math.min(m.end,t.end)-Math.max(m.start,t.start)>(t.end-t.start)*.5)));if(result.warning)warnings.add(result.warning);devices.add(result.device);task.completed+=to-from;lyricProgress(task.completed/total,name+' · 已完成');
    }
    const mappingProject={...project,lyrics:kind==='align'?(project.lyrics||[]).filter(t=>!alignIds.has(t.id)):project.lyrics};lyricsPreview=normalizeLyrics([...retained,...matchLyrics(mappingProject,collected)].sort((a,b)=>(a.start??Infinity)-(b.start??Infinity)),project.notes);lyricSelection=collected[0]?.id;render();$('lyricsStatus').textContent=`Qwen · ${ranges.length} 段 · ${[...devices].map(d=>d==='cuda'?'显卡':d==='mixed'?'显卡/CPU':'CPU').join('/')} · ${collected.length} 字词 · 在谱面检查后采用${warnings.size?' · '+[...warnings].join('；'):''}`;
  }catch(error){const cancelled=error.name==='AbortError';$('lyricsStatus').textContent=cancelled?'歌词分析已取消':error.message;lyricProgress(Math.max(task.completed/total,task.progress||0),cancelled?'已取消':'分析失败');if(!cancelled)throw error;}
  finally{clearInterval(progressTimer);lyricsTask=null;$('lyricsCancel').hidden=true;renderLyrics();}
}
on('lyricSplitWord','click',()=>{const t=selectedLyricToken();if(!t||t.start===null)throw Error('先给字词定位');const chars=Array.from(t.text),middle=Math.max(1,Math.floor(chars.length/2));$('lyricSplitLeft').value=chars.slice(0,middle).join('');$('lyricSplitRight').value=chars.slice(middle).join('');const position=playPosition+project.offset;$('lyricSplitSecond').value=position>t.start+.02&&position<t.end-.02?position.toFixed(3):((t.start+t.end)/2).toFixed(3);$('lyricSplitDialog').showModal();});
on('lyricSplitConfirm','click',()=>{if(job||lyricsTask)throw Error('请等待分析结束');const raw=project.notes.filter(n=>n.midi!==null).map(n=>({evidenceId:n.id,midi:n.midi,start:timeAtBeat(project,n.start),end:timeAtBeat(project,n.start+n.duration)})),tokens=splitLyricWord(scoreLyricTokens(),lyricSelection,{at:Number($('lyricSplitSecond').value),left:$('lyricSplitLeft').value,right:$('lyricSplitRight').value},raw);if(lyricsPreview!==null)writeLyrics(tokens);else commit({...project,notes:project.notes.map(n=>({...n,lyric:''})),lyrics:tokens},{keepPlayback:true});$('lyricSplitDialog').close();toast('字词已拆分，音符保持原样，可撤销。');});
on('lyricMergeWord','click',()=>{const tokens=mergeLyricWords(scoreLyricTokens(),lyricSelection);if(lyricsPreview!==null)writeLyrics(tokens);else commit({...project,notes:project.notes.map(n=>({...n,lyric:''})),lyrics:tokens},{keepPlayback:true});toast('已合并文字及其对应，可撤销。');});
function rematchLyricPhrase(){
  if(job||lyricsTask)throw Error('请等待当前分析结束');const phrase=lyricPhrase(scoreLyricTokens(),selectedLyricToken()),ids=new Set(phrase.tokens.map(t=>t.id));
  const matched=matchLyrics({...project,notes:project.notes.map(n=>({...n,lyric:''})),lyrics:(project.lyrics||[]).filter(t=>!ids.has(t.id))},phrase.tokens.map(t=>({...t,reviewed:false})),{preserve:false});
  lyricsPreview=[...scoreLyricTokens().filter(t=>!ids.has(t.id)),...matched.map(t=>({...t,reviewed:true}))].sort((a,b)=>(a.start??Infinity)-(b.start??Infinity));render();toast('本句对应已重新计算；在谱面检查后点“采用对应”。');
}
async function resplitLyricPhrase(){
  if(job||lyricsTask)throw Error('请等待当前分析结束');if(lyricsPreview!==null)throw Error('先采用或取消文字预览，再重新分音');if(!original)throw Error('先导入原音');
  const phrase=lyricPhrase(scoreLyricTokens(),selectedLyricToken()),from=phrase.from,to=phrase.to;if(to-from<.25)throw Error('本句不足0.25秒，请先调整文字范围');
  const task={cancelled:false,controller:new AbortController(),stitchDecisions:[],lyricAssist:true,lyricResplit:true,lyricLanguage:phrase.language,singingFine:$('singingFine').checked,completedLyrics:[]};job=task;task.started=performance.now();auditWindows=[];analysisWarnings=[];stopPlayback();setBusy(true,'按歌词重新分音本句');
  try{
    await prepareCompute(task);await ensureOriginalResource(task);const resource=lyricResource(from,to),source=resource?.source||'original',options={minMidi:21,maxMidi:108,strategy:$('strategy').value,analysisMode:'vocal'},results=[];
    for(const [i,w] of analysisWindows([{from,to}]).entries()){task.workerBase=i/Math.ceil((to-from)/8)*.6;task.workerScale=.1;results.push(await analyseWindow(w,source,options,'auto',task,'本句 · 声学起音证据'));}
    // Keep edited pitches as the baseline; only unsupported/empty score gaps use ASR notes.
    const present=project.notes.filter(n=>n.midi!==null&&timeAtBeat(project,n.start)<to&&timeAtBeat(project,n.start+n.duration)>from).map(n=>({start:Math.max(from,timeAtBeat(project,n.start)),end:Math.min(to,timeAtBeat(project,n.start+n.duration)),midi:n.midi,confidence:n.confidence,source,evidenceId:'edited-'+n.id}));
    const raw=present.length?present:joinWindowNotes(results.flatMap(r=>r.primary)),section={id:uid(),name:'歌词句 · '+phrase.text.slice(0,16),kind:'verse',source,audioStart:from,audioEnd:to,analysisMode:'vocal',analysisUsed:[]};
    task.workerBase=.65;task.workerScale=.3;const candidate=await vocalCandidate({from,to,name:section.name,source},section.id,raw,phrase.tokens,project,EDIT_STEP,task);task.controller.signal.throwIfAborted();
    lastAudit=buildAudit(candidate.raw,candidate.notes,project,{from,to},[section],task);await persistAudit(task);showSectionDraft(section,candidate.notes,'歌词辅助本句分音',{variants:candidate.variants,lyrics:candidate.lyrics,phrase:true});
  }finally{closeWorker();if(job===task){job=null;setBusy(false);}}
}
on('lyricRemapPhrase','click',rematchLyricPhrase);on('inlineLyricRemap','click',rematchLyricPhrase);on('lyricResplitPhrase','click',resplitLyricPhrase);on('inlineLyricResplit','click',resplitLyricPhrase);
on('lyricsTranscribe','click',()=>lyricsAnalysis('transcribe'));on('lyricsAlign','click',()=>lyricsAnalysis('align'));on('lyricsCancel','click',()=>lyricsTask?.controller.abort());
function checkLyricsStatus(){return fetch('/api/lyrics/status',{headers:{'X-Studio-Token':token}}).then(r=>r.json()).then(s=>{$('lyricsStatus').textContent=s.ready?`${s.model} · 本机转写与逐字对齐已就绪`:'可手工添加歌词；Qwen 自动识别组件待安装（scripts/安装歌词组件.ps1）';}).catch(()=>$('lyricsStatus').textContent='可手工添加歌词；服务暂未连接');}

render();drawWave();
try{const saved=localStorage.getItem(PENDING_DRAFT_KEY);if(saved){loadPendingDraft(await readPendingSnapshot(JSON.parse(saved)));pendingDraftSaved=true;updatePendingDraftBar();}}catch{try{localStorage.removeItem(PENDING_DRAFT_KEY);}catch{}pendingDraftMeta=null;updatePendingDraftBar();}
fetch('/api/status').then(r=>r.json()).then(async s=>{token=s.token;checkLyricsStatus();await linkedProjectReady;if(!audioUnloaded&&!new URLSearchParams(location.search).get('audio'))await restoreResources(restorableAudioProject(project,localDraft));const singing=await fetch('/api/singing/status',{headers:{'X-Studio-Token':token}});singingReady=(await singing.json()).ready===true;$('singingStatus').textContent=singingReady?'演唱精细分音已就绪':'可选组件尚未安装：scripts/安装候选组件.ps1';if($('computeMode').value==='performance')await refreshCompute();}).catch(()=>toast('本地服务未连接，请通过启动脚本运行。',true));

// Optional native separation API is discovered rather than assumed installed.
async function checkSeparation(){try{const r=await fetch('/api/separation/status'),s=await r.json();window.separationReady=s.ready===true;window.separationModels=s.models||['htdemucs'];if(!s.ready)$('autoSeparate').checked=false;$('separationState').textContent=s.ready?'本地 Demucs 已就绪；处理整曲可能需要几分钟。':'分轨未安装，已取消分轨；试用时请手填 BPM。需要分轨可双击“Download-Components.cmd”。';$('separate').disabled=!original||!window.separationReady;}catch{window.separationReady=false;$('autoSeparate').checked=false;$('separationState').textContent='分轨状态不可用；试用时请手填 BPM。';}}
on('separate','click',async()=>{if(lyricsTask)throw Error('请等待歌词分析完成');if(!original||job)return;stopPlayback();const task={cancelled:false,controller:new AbortController()};job=task;setBusy(true,'准备分离音频');try{task.started=performance.now();await prepareCompute(task);await separateForTask(task);showComputeTimes(task);if(!task.cancelled)toast('人声与器乐轨已就绪，点击“生成简谱”。');}finally{if(task.cancelled&&task.separationId)api('separation/cancel',{id:task.separationId}).catch(()=>{});if(job===task){job=null;setBusy(false);}}});
checkSeparation();

// A local exported project can be opened directly; never fetch external links.
async function openLinkedProject(){
  const params=new URLSearchParams(location.search),projectPath=params.get('project'),audioPath=params.get('audio');
  const valid=p=>isExportPath(p)&&/\.(json|wav)$/i.test(p);
  if(!projectPath)return;if(!valid(projectPath)||!projectPath.endsWith('.json')||(audioPath&&(!valid(audioPath)||!audioPath.endsWith('.wav'))))throw Error('无效本机工程链接');
  const response=await fetch(projectPath);if(!response.ok)throw Error('本机工程文件不存在');scorePending=false;lyricsPreview=null;commit(parseProjectText(await response.text()),{resetLyrics:true});
  if(audioPath){const audio=await fetch(audioPath);if(!audio.ok)throw Error('对照音频文件不存在');await loadAudio(new File([await audio.blob()],project.sourceName||'对照音频.wav',{type:'audio/wav'}));}
  toast('已打开本机工程，可直接试听、转调与微调。');
}
const linkedProjectReady=openLinkedProject().catch(e=>toast(e.message,true));

// Component status is independent of score selection and saved projects.
let componentStatus=null,componentManager=null;
function enforceComponentState(){if(componentStatus)applyComponentAvailability(componentStatus);}
async function componentStateChanged(value){
  componentStatus=value;
  await checkSeparation();await checkLyricsStatus();
  const singing=value.components?.find(c=>c.id==='singing');singingReady=singing?.ready===true;
  $('singingStatus').textContent=singingReady?'演唱精细分音已就绪':'演唱精细分音未安装，可在“组件管理”添加。';
  render();renderLyrics();enforceComponentState();
  if($('computeMode').value==='performance'&&!value.busy)await refreshCompute(undefined,true).catch(()=>{});
}
on('componentsTop','click',async()=>{
  $('componentsDialog').showModal();
  if(!componentManager)componentManager=await createComponentManager($('componentsHost'),{onChanged:componentStateChanged});
  else await componentManager.refresh();
});
// Existing renderers keep managing normal audio/selection conditions. Missing components
// additionally keep their controls muted even when those renderers update disabled state.
new MutationObserver(enforceComponentState).observe(document.body,{subtree:true,attributes:true,attributeFilter:['disabled']});
fetch('/api/status').then(r=>r.json()).then(s=>fetch('/api/components/status',{headers:{'X-Studio-Token':s.token}})).then(r=>r.ok?r.json():Promise.reject(Error('组件状态不可用'))).then(componentStateChanged).catch(()=>{});
