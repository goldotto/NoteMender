import {tr} from './i18n.mjs';
import {analyseBarPulses,projectOnBarPulses} from './downbeat-layout.mjs';
import {timeAtBeat} from './time-map.mjs';
import {barLength} from './music.mjs';

const stamp=second=>Math.floor(second/60)+':'+(second%60).toFixed(2).padStart(5,'0');

export function installDownbeatPreview($,{getAudio,getProject,detect,audition,onChange,onMarkers,audioSuggestions=true}){
  let audio,controller,listener,meter,tempo,grid,projection,notice,markerKey;
  let detected,manual,choice,confirmed=false;
  const errors={
    'component-missing':()=>tr('缺少节拍分析组件。请在程序目录运行 node scripts/install-downbeats.mjs。','Install the beat tracker with node scripts/install-downbeats.mjs.','node scripts/install-downbeats.mjs で拍検出をインストールしてください。'),
    'component-invalid':()=>tr('节拍模型校验失败，请重装节拍分析组件。','Beat model verification failed. Reinstall the beat tracker.','拍モデルの検証に失敗しました。再インストールしてください。'),
    'busy':()=>tr('请等待当前分析、安装或更新完成。','Wait for the current analysis, installation or update to finish.','分析・インストール・更新が終わるまでお待ちください。'),
    'analysis-timeout':()=>tr('节拍分析超时。','Beat tracking timed out.','拍検出がタイムアウトしました。'),
    'audio-too-long':()=>tr('节拍分析最长支持 20 分钟。','Beat tracking supports up to 20 minutes.','拍検出は20分までです。'),
    'old-server':()=>tr('请保存工作并重启 NoteMender，使节拍分析入口生效。','Save your work and restart NoteMender to enable beat tracking.','作業を保存して NoteMender を再起動してください。'),
    'analysis-failed':()=>tr('节拍分析失败。请检查原曲和本地节拍分析组件。','Beat tracking failed. Check the original audio and the local beat tracker.','拍検出に失敗しました。原曲と拍検出機能をご確認ください。')
  };
  function labels(){
    const copy=[
      ['beats-heading',tr('小节线','Bar lines','小節線')],
      ['beats-apply',tr('使用原曲建议','Apply suggested bars','提案した小節線を適用')],
      ['beats-scan',controller?tr('取消分析','Cancel analysis','分析を中止'):tr('从原曲建议小节线','Suggest bars from audio','原曲から小節線を提案')],
      ['beats-label-source',tr('来源','Source','参照元')],
      ['beats-label-meter',tr('拍号','Meter','拍子')],
      ['beats-label-phase',tr('确认第一拍','Set a bar’s first beat','小節の第1拍を指定')],
      ['beats-label-at',tr('试听位置','Listen from','試聴位置')],
      ['beats-listen',listener?tr('停止试听','Stop audition','試聴を停止'):tr('试听原曲＋小节提示音','Hear audio with bar clicks','原曲と小節クリックを試聴')]
    ];
    for(const [name,value] of copy)$(name).textContent=value;
    $('beats-source').options[0].textContent=tr('当前排版','Current layout','現在のレイアウト');
    $('beats-source').options[1].textContent=tr('原曲建议','Audio suggestion','原曲からの提案');
    $('beats-source').options[2].textContent=tr('按手打节奏排整谱','Lay out entire score from taps','手打ちの拍で全曲を整譜');
    $('beats-phase').options[0].textContent=tr('自动判断','Automatic','自動判定');
  }
  function stopListening(){listener?.abort();listener=null;labels();}
  function publishMarkers(){
    const active=confirmed&&$('beats-source').value==='detected'?projection:null;
    const marks=active?active.barMarkers.filter(a=>a.beat>=0).map(a=>({
      second:a.second,number:1+Math.round((a.beat-active.pickup)/barLength(active.project.meter))
    })):(manual?.marks||[]);
    const key=JSON.stringify(marks);
    if(key!==markerKey){markerKey=key;onMarkers(marks);}
  }
  $('beats-scan').hidden=!audioSuggestions;
  $('beats-source').options[1].hidden=!audioSuggestions;
  function sync(){
    const next=getAudio(),p=getProject();
    if(next!==audio){
      controller?.abort();controller=null;detected=null;manual=null;choice=null;grid=null;projection=null;notice=null;confirmed=false;
      audio=next;
      $('beats-source').value='current';stopListening();
    }
    $('beats-scan').disabled=!controller&&(!audio||!p.notes.length);
    if(!audioSuggestions)$('beats-section').hidden=!manual;
    $('beats-tools').hidden=!choice&&!manual;
    const source=$('beats-source').value,auto=source==='detected'&&choice?.kind==='detected';
    $('beats-apply').hidden=!auto||confirmed;
    $('beats-apply').disabled=!projection||Boolean(controller);
    $('beats-listen').hidden=$('beats-at').closest('label').hidden=source==='current'||!grid?.choices.length;
    $('beats-listen').disabled=!grid?.choices.length;
    $('beats-meter').closest('label').hidden=$('beats-phase').closest('label').hidden=!auto;
    $('beats-source').options[1].disabled=!detected;
    $('beats-source').options[2].disabled=!manual;
    $('beats-info').textContent=notice?.()||'';
    labels();publishMarkers();
  }
  function refreshGrid(resetChoices=false){
    const p=getProject(),chosen=choice.meter,requested=choice.phase;
    tempo=p.bpm;
    const phaseSecond=requested===''?undefined:Number(requested);
    grid=choice.kind==='manual'
      ? choice.grid
      : analyseBarPulses(choice.data,chosen,phaseSecond,p.bpm);
    projection=grid?projectOnBarPulses({...p,meter:chosen},grid):null;
    if(resetChoices){
      const phase=$('beats-phase');
      phase.length=1;
      for(const beat of grid?.choices||[])phase.add(new Option(stamp(beat.second)+(choice.kind==='detected'&&beat.downbeat?' ★':''),beat.second));
      phase.value=requested;
      if(phase.selectedIndex<0){phase.selectedIndex=0;choice.phase='';}
    }
    const position=$('beats-at'),previous=position.value;
    position.length=0;
    const ranges=grid?.inspect.slice()||[];
    if(choice.kind==='detected'&&grid&&!grid.automatic&&!ranges.length){
      ranges.push({from:grid.choices[0].second,to:grid.choices.at(-1).second});
    }
    const inspect=new Map(ranges.map(range=>[range.from,range.to]));
    const entries=(grid?.marks.length?grid.marks:grid?.choices)||[];
    for(const second of [...new Set([...entries.map(mark=>mark.second),...inspect.keys()])].sort((a,b)=>a-b)){
      position.add(new Option(stamp(second)+(inspect.has(second)?'–'+stamp(inspect.get(second))+' · '+tr('待核对','Review','要確認'):''),second));
    }
    const first=timeAtBeat(p,p.notes[0]?.start||0),near=grid?.marks.find(mark=>mark.second>=first-.5);
    position.value=previous;
    if(position.selectedIndex<0&&near)position.value=near.second;
    if(position.selectedIndex<0&&position.length)position.selectedIndex=0;
    notice=()=>{
      if(!grid)return tr('原曲里没有足够的稳定拍点，继续使用当前排版。','Too few stable beats. The current layout is still available.','安定した拍が不足しています。現在のレイアウトを使えます。');
      if(choice.kind==='manual'){
        return tr(`使用工作区的手打小节线 · ${choice.meter} · ${grid.bpm} BPM`,`Using tapped bars from the workspace · ${choice.meter} · ${grid.bpm} BPM`,`作業エリアで手打ちした小節線 · ${choice.meter} · ${grid.bpm} BPM`);
      }
      if(!projection){
        const {from,to}=ranges[0]||{from:grid.choices[0].second,to:grid.choices.at(-1).second};
        return tr(`${stamp(from)}–${stamp(to)} 的小节第一拍无法可靠确定。可试听后指定第一拍。`,`Bar starts are uncertain at ${stamp(from)}–${stamp(to)}. Listen and set a bar’s first beat.`,`${stamp(from)}–${stamp(to)} の小節頭が不確かです。試聴して第1拍を指定してください。`);
      }
      if(grid.fixed)return tr('当前拍点不一致。按你选的第一拍和工程速度划分，请试听核对。','Detected beats disagree. Audition the bars based on your chosen downbeat and project tempo.','検出された拍が不安定です。指定の第1拍とプロジェクトのテンポで区切った結果を試聴してください。');
      const summary=tr(`划分速度 ♩=${grid.bpm} · 小节线 ${grid.marks.length} 处 · 记谱舍入最大 ${Math.round(projection.maxMs)} 毫秒。`,`♩=${grid.bpm} · ${grid.marks.length} bar markers · Up to ${Math.round(projection.maxMs)} ms of notation rounding.`,`♩=${grid.bpm} · 小節線 ${grid.marks.length} か所 · 記譜の丸めは最大 ${Math.round(projection.maxMs)} ms。`);
      const range=grid.inspect[0];
      return range?summary+' '+tr(`${stamp(range.from)}–${stamp(range.to)} 的第一拍有分歧，请试听核对。`,`Bar starts disagree at ${stamp(range.from)}–${stamp(range.to)}. Check by ear.`,`${stamp(range.from)}–${stamp(range.to)} の小節頭が不確かです。試聴でご確認ください。`):summary;
    };
    sync();
  }
  function choose(next){
    confirmed=false;choice=next;meter=getProject().meter;
    $('beats-source').value=choice.kind;
    $('beats-meter').value=choice.meter;
    refreshGrid(true);
    onChange();
  }
  async function scan(){
    if(controller){controller.abort();return;}
    sync();
    if(!audioSuggestions||!audio)return;
    const target=audio,task=new AbortController();
    controller=task;
    notice=()=>tr('正在查找拍点和小节第一拍…','Finding beats and bar starts…','拍と小節頭を検出中…');
    sync();
    try{
      const data=await detect(target,task.signal);
      if(getAudio()!==target||task.signal.aborted)return;
      stopListening();
      detected={kind:'detected',data,meter:getProject().meter,phase:''};
      choose(detected);
    }catch(error){
      if(controller!==task)return;
      if(task.signal.aborted)notice=null;
      else notice=errors[error.message]||errors['analysis-failed'];
    }finally{
      if(controller===task){controller=null;sync();}
    }
  }
  $('beats-scan').onclick=scan;
  $('beats-source').onchange=()=>{
    stopListening();const source=$('beats-source').value;
    if(source!=='current'){choose(source==='manual'?manual:detected);return;}
    confirmed=false;notice=null;sync();onChange();
  };
  for(const [name,setting] of [['beats-meter','meter'],['beats-phase','phase']])$(name).onchange=()=>{
    stopListening();confirmed=false;choice[setting]=$(name).value;
    refreshGrid(name==='beats-meter');onChange();
  };
  $('beats-apply').onclick=()=>{
    if(!projection||controller||$('beats-source').value!=='detected')return;
    confirmed=true;sync();onChange();
  };
  $('beats-listen').onclick=async()=>{
    if(listener){stopListening();return;}
    if(!audio||!grid?.choices.length)return;
    const second=Number($('beats-at').value||$('beats-phase').value||grid.choices[0].second);
    const task=new AbortController();listener=task;labels();
    try{await audition(audio,Math.max(0,second-1.25),grid.marks.map(mark=>mark.second),task.signal);}
    catch{if(!task.signal.aborted){notice=errors['analysis-failed'];sync();}}
    finally{if(listener===task)stopListening();}
  };
  $('beats-at').onchange=stopListening;
  labels();
  return {
    setManual(next,meter){
      sync();
      manual=next&&{kind:'manual',grid:next,meter,phase:'',marks:next.marks.map(({second},index)=>({second,number:index+1}))};
      if(choice?.kind==='manual'){
        stopListening();
        if(manual&&$('beats-source').value==='manual'){choose(manual);return;}
        choice=null;grid=null;projection=null;notice=null;$('beats-source').value='current';
      }
      sync();onChange();
    },
    copy(project){
      sync();
      const source=$('beats-source').value;
      if(source==='current'||!choice)return null;
      if(choice.kind==='detected'&&(meter!==project.meter||(grid?.fixed&&tempo!==project.bpm))){
        if(meter!==project.meter){
          meter=project.meter;choice.meter=meter;$('beats-meter').value=meter;
        }
        confirmed=false;refreshGrid(true);
      }else if(grid){
        projection=projectOnBarPulses({...project,meter:choice.meter},grid);
        sync();
      }
      if(!projection)return null;
      return {...projection,reviewing:source==='detected'&&!confirmed,applied:source==='detected'&&confirmed,
        project:{...projection.project,bpm:Math.min(300,Math.max(30,grid.bpm))}};
    },
    close(){stopListening();controller?.abort();sync();},stopAudio:stopListening,sync,labels
  };
}
