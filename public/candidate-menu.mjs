import {isMuTrackCandidate,muInstrumentLabel} from './muscriptor-tracks.mjs';
import {tr,getLanguage} from './i18n.mjs';
// Translate display copies only. Stored method identifiers remain unchanged.
export function candidateMethodLabel(method='备选'){
  if(method.startsWith('MuScriptor 局部重识别 '))return method.replace('局部重识别',tr('局部重识别','Partial retranscription'));
  method=method.replace('人声音高校正',tr('人声音高校正','Vocal pitch correction'));
  if(getLanguage()!=='en')return method;
  const words=[['Pitchy 连续音高分音','Pitchy continuous pitch segmentation'],['无连续性约束','without continuity constraints'],['原始候选旋律（含短音）','Raw melody candidate (including short notes)'],['整理前备份','Before reprocessing (backup)'],['历史候选（已停用）','Historical candidate (retired)'],['改进分音','Improved segmentation'],['连续声部','Continuous voice'],['高声部','Higher voice'],['低声部','Lower voice'],['连续旋律','Continuous melody'],['较高旋律','Higher melody'],['较低旋律','Lower melody'],['密集器乐追踪','Dense-instrument tracking'],['自动旋律','Automatic melody'],['原始候选旋律','Raw melody candidate'],['自动首选','Automatic first choice'],['原首选','Previous first choice'],['字词条件','Word-conditioned'],['字词对应','Word-matched'],['字词对齐','Word-aligned'],['原始分音','Raw note segmentation'],['歌词边界辅助','Lyric-boundary assistance'],['原分音','Previous note segmentation'],['备选','Alternative']];
  for(const [source,target] of words)method=method.split(source).join(target);
  return method;
}
// Describe the actual input, not MuScriptor's predicted instrument labels.
export function candidateInput(candidate,resources=[]){
  if(candidate.source==='original')return tr('原曲','Original');
  const resource=resources.find(r=>r.id===candidate.resourceId),model=candidate.inputModel||resource?.model;
  if(model==='htdemucs_6s')return tr('六轨分离','Six-stem separation');
  if(model==='htdemucs')return tr('四轨分离','Four-stem separation');
  if(candidate.analysisId&&!candidate.resourceId&&['vocals','other'].includes(candidate.source))return tr('人声／器乐分离','Vocal/instrumental separation');
  return '';
}

export function candidateMenuLabel(candidate,resources=[]){
  let method=candidate.method||'备选';
  if(method==='Pitchy')method='Pitchy · 历史候选（已停用）';
  else if(method==='Pitchy 连续音高分音')method='Pitchy 改进分音 · 历史候选（已停用）';
  if(isMuTrackCandidate(candidate))method='MuScriptor · '+muInstrumentLabel(candidate.instrument||'');
  else if(candidate.model==='muscriptor-review-retry'&&candidate.instrument)method+=' · '+muInstrumentLabel(candidate.instrument);
  const input=candidateInput(candidate,resources);
  return `${candidateMethodLabel(method)}${input?' · '+input:''} · ${candidate.notes.length?candidate.notes.length+tr(' 音',' notes'):tr('无音符','No notes')}`;
}

export function visibleCandidates(variants,{all=false,active='primary'}={}){
  const result=[],seen=new Map();
  for(const v of variants){
    const comparison=v.primary||/^Pitchy(?:$|[ ·])/.test(v.method)||/无连续性|原始候选|整理前备份/.test(v.method);
    const oldMuChoice=/^MuScriptor/.test(v.method)&&/连续旋律|较高旋律|较低旋律|连续声部|高声部|低声部/.test(v.method);
    if(!all&&(comparison||oldMuChoice)&&v.id!==active)continue;
    // Same title with different notes/inputs is not a duplicate. Never discard data.
    const key=[v.method,v.resourceId||'',v.inputModel||'',v.analysisId||'',v.instrument||'',v.notes.map(n=>[n.start,n.duration,n.midi].join(':')).join('|')].join('/');
    if(seen.has(key)){if(v.id===active)result[seen.get(key)]=v;continue;}
    seen.set(key,result.length);result.push(v);
  }
  return result;
}
