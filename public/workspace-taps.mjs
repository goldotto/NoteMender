import {tr,onLanguageChange} from './i18n.mjs';
import {analyseTappedBars,tappedTempo} from './downbeat-layout.mjs';

export function installWorkspaceTaps({anchor,waveform,getAudio,getPosition,getMeter,playAudio,onPosition,onApply,onError}){
  const toggle=document.createElement('button'),panel=document.createElement('div');
  toggle.type='button';toggle.id='workspaceTapToggle';
  toggle.setAttribute('aria-controls','workspaceTaps');toggle.setAttribute('aria-expanded','false');
  panel.id='workspaceTaps';panel.hidden=true;
  panel.innerHTML=`<label><span data-start-label></span><input data-start type="number" min="0" step="0.01"></label>
    <button data-cursor type="button"></button><label><span data-meter-label></span><select data-meter><option>2/4</option><option>3/4</option><option>4/4</option><option>6/8</option></select></label>
    <button data-record type="button"></button><button data-hit type="button"></button><button data-undo type="button"></button>
    <label><span data-phase-label></span><select data-phase><option value=""></option></select></label>
    <button data-apply type="button"></button><button data-listen type="button"></button><button data-clear type="button"></button>
    <output data-status aria-live="off"></output><small data-hint></small>
    <details data-adjust hidden><summary data-adjust-label></summary>
      <div class="tap-adjust-controls">
        <label><span data-tap-label></span><select data-tap></select></label>
        <label><span data-tap-time-label></span><input data-tap-time type="number" min="0" step="0.001"></label>
        <button data-tap-earlier type="button"></button><button data-tap-later type="button"></button>
        <button data-tap-reset type="button"></button><button data-tap-preview type="button"></button>
        <small data-adjust-hint role="status"></small>
      </div>
    </details>`;
  anchor.after(toggle);waveform.before(panel);
  const $=name=>panel.querySelector(`[data-${name}]`);
  let audio,active,taps=[],recordedTaps=[],applied,invalidAdjustment=false;

  const selectedTap=()=>$('tap').selectedIndex;
  const tapText=(index,second)=>`${index+1} · ${second.toFixed(3)} s`;
  function refreshAdjustment(){
    const index=selectedTap();
    $('tap-time').value=taps[index]?.toFixed(3)??'';
    invalidAdjustment=false;
  }
  function moveTap(second){
    const index=selectedTap();
    if(index<0)return;
    const previous=taps[index-1]??-Infinity,next=taps[index+1]??audio.duration;
    if(!Number.isFinite(second)||second<0||second<=previous||second>=next){
      refreshAdjustment();invalidAdjustment=true;draw();return;
    }
    taps[index]=second;
    updatePhases();draw();
  }
  function nudgeTap(milliseconds){
    const second=taps[selectedTap()];
    moveTap((Math.round(second*1000)+milliseconds)/1000);
  }

  function draw(){
    const meter=$('meter').value,tempo=tappedTempo(taps,meter),recording=Boolean(active?.recording);
    const tap=selectedTap(),stopAudition=tr('停止试听','Stop audition','試聴を停止');
    toggle.textContent=tr('手打拍子','Tap beats','手打ちで拍を取る');
    toggle.disabled=!audio;
    $('start-label').textContent=tr('起听（秒）','Start (seconds)','開始位置（秒）');
    $('cursor').textContent=tr('取光标位置','Use cursor','カーソル位置');
    $('meter-label').textContent=tr('拍号','Meter','拍子');
    $('record').textContent=active?.recording?tr('停止录制','Stop recording','記録を停止')
      : taps.length?tr('重新录制','Record again','録り直す'):tr('播放并录制','Play and record','再生して記録');
    $('hit').textContent=tr('打拍（空格）','Tap (Space)','タップ（Space）');
    $('undo').textContent=tr('撤销上一拍','Undo last tap','直前のタップを取り消す');
    $('phase-label').textContent=tr('小节第一拍','Bar first beat','小節の第1拍');
    $('phase').options[0].textContent=tr('第 1 次拍击','First tap','最初のタップ');
    $('apply').textContent=tr('使用手打结果','Use tapped beats','手打ちの拍を使う');
    $('listen').textContent=active&&!recording&&!active.tapPreview?stopAudition
      : tr('试听小节提示音','Hear bar clicks','小節クリックを試聴');
    $('clear').textContent=tr('清除手打小节线','Clear tapped bar lines','手打ちの小節線を消去');
    $('status').textContent=tr(`${taps.length} 拍`,`${taps.length} taps`,`${taps.length} タップ`)+(tempo===null?'':` · ${tempo} BPM`);
    $('hint').textContent=applied
      ? tr(`已应用手打小节线 · 拍点 ${applied.from.toFixed(2)}–${applied.to.toFixed(2)} 秒 · 仅标记实拍范围。`,`Tapped bar lines applied · Taps ${applied.from.toFixed(2)}–${applied.to.toFixed(2)} s · Markers are limited to the tapped range.`,`手打ちの小節線を適用済み · 拍の範囲 ${applied.from.toFixed(2)}～${applied.to.toFixed(2)} 秒 · 記録した範囲内だけに小節線を表示します。`)
      : tr('听到小节第一拍时开始，之后每拍按一次，至少打 3 拍。6/8 每小节按两次。','Start on a bar’s first beat, then tap every beat. Tap at least 3 times. For 6/8, tap twice per bar.','小節の第1拍から拍ごとにタップします。最低3回、6/8拍子は1小節に2回です。');
    $('start').disabled=$('cursor').disabled=Boolean(active);
    $('hit').disabled=!active?.recording||!active.clock;
    $('undo').disabled=!taps.length;
    $('phase').disabled=tempo===null||Boolean(active?.recording);
    $('phase').closest('label').hidden=tempo===null;
    $('apply').disabled=tempo===null;
    $('listen').hidden=$('clear').hidden=!applied;
    $('listen').disabled=recording||Boolean(active?.tapPreview);
    $('adjust').hidden=recording||!taps.length;
    $('adjust-label').textContent=tr('微调拍点','Fine-tune taps','拍の位置を微調整');
    $('tap-label').textContent=tr('拍点','Tap','タップ');
    $('tap-time-label').textContent=tr('原曲秒数','Audio time (s)','原曲の秒数');
    $('tap-earlier').textContent=tr('提前 10 毫秒','10 ms earlier','10 ms 早める');
    $('tap-later').textContent=tr('推后 10 毫秒','10 ms later','10 ms 遅らせる');
    $('tap-reset').textContent=tr('还原此拍','Reset tap','元の位置に戻す');
    $('tap-preview').textContent=active?.tapPreview?stopAudition:tr('试听此拍','Audition tap','この拍を試聴');
    $('tap').disabled=$('tap-time').disabled=$('tap-earlier').disabled=$('tap-later').disabled=Boolean(active);
    $('tap-reset').disabled=Boolean(active)||taps[tap]===recordedTaps[tap];
    $('tap-preview').disabled=Boolean(active&&!active.tapPreview);
    const changed=applied&&!recording&&(applied.meter!==meter||applied.downbeat!==Number($('phase').value)
      ||applied.grid.choices.length!==taps.length||taps.some((second,index)=>applied.grid.choices[index].second!==second));
    $('adjust-hint').textContent=invalidAdjustment
      ? tr('请在原曲范围内调整，拍点不能重合或越过相邻拍点。','Keep the tap within the audio and between adjacent taps.','原曲の範囲内で、隣の拍を越えたり重なったりしない位置を指定してください。')
      : changed?tr('点“使用手打结果”更新小节线。','Choose Use tapped beats to update bar lines.','「手打ちの拍を使う」で小節線を更新します。'):'';
  }
  function setStart(second){
    const max=Math.max(0,Math.floor((audio.duration-.01)*100)/100);
    $('start').max=max;
    $('start').value=Math.min(max,Math.max(0,second||0)).toFixed(2);
  }
  function updatePhases(){
    const phase=$('phase'),selected=phase.value,tap=$('tap'),indexToKeep=tap.selectedIndex;
    phase.length=1;tap.length=0;
    for(const [index,second] of taps.entries()){
      if(index>0)phase.add(new Option(tapText(index,second),index));
      tap.add(new Option(tapText(index,second),index));
    }
    phase.value=taps[Number(selected)]===undefined?'':selected;
    tap.selectedIndex=Math.min(Math.max(0,indexToKeep),taps.length-1);
    refreshAdjustment();
  }
  function stop(){
    if(!active)return;
    active.controller.abort();
    cancelAnimationFrame(active.frame);
    active=null;onPosition(null);updatePhases();draw();
  }
  function sync(){
    const next=getAudio();
    if(next===audio)return;
    stop();audio=next;taps=[];recordedTaps=[];applied=null;$('adjust').open=false;
    panel.hidden=true;toggle.setAttribute('aria-expanded','false');
    $('start').value='';$('meter').value=getMeter();updatePhases();draw();
  }
  function hit(eventTime){
    if(!active?.recording||!active.clock)return;
    const second=active.clock(eventTime);
    if(!Number.isFinite(second)||second<active.from||second>=audio.duration||second-(taps.at(-1)??-Infinity)<.12)return;
    taps.push(second);recordedTaps.push(second);draw();
  }
  async function run(marks,recording,previewFrom){
    stop();
    if(previewFrom===undefined)setStart(Number($('start').value));
    const run={from:previewFrom??Number($('start').value),controller:new AbortController(),recording,tapPreview:previewFrom!==undefined};
    active=run;draw();
    try{
      await playAudio(audio,run.from,marks,run.controller.signal,{whole:recording,onClock:clock=>{
        if(active!==run)return;
        run.clock=clock;draw();
        if(recording)$('hit').focus({preventScroll:true});
        let lastUpdate=-Infinity;
        const tick=now=>{
          if(active!==run)return;
          if(now-lastUpdate>=32){
            onPosition(Math.max(run.from,Math.min(audio.duration,clock(now))));
            lastUpdate=now;
          }
          run.frame=requestAnimationFrame(tick);
        };
        run.frame=requestAnimationFrame(tick);
      }});
    }catch(error){if(!run.controller.signal.aborted)onError(error);}
    finally{if(active===run)stop();}
  }
  toggle.onclick=()=>{
    panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));
    if(panel.hidden)stop();
    else if($('start').value===''){setStart(getPosition()-2);$('meter').value=getMeter();}
  };
  $('cursor').onclick=()=>setStart(getPosition());
  $('record').onclick=()=>{
    if(active?.recording){stop();return;}
    taps=[];recordedTaps=[];updatePhases();run([],true);
  };
  $('hit').onpointerdown=event=>{if(event.button===0)hit(event.timeStamp);};
  $('hit').onclick=event=>{if(event.detail===0)hit(event.timeStamp);};
  $('undo').onclick=()=>{taps.pop();recordedTaps.pop();updatePhases();draw();if(active?.recording)$('hit').focus({preventScroll:true});};
  $('meter').onchange=$('phase').onchange=draw;
  $('tap').onchange=()=>{refreshAdjustment();draw();};
  $('tap-time').onchange=()=>moveTap($('tap-time').valueAsNumber);
  $('tap-earlier').onclick=()=>nudgeTap(-10);
  $('tap-later').onclick=()=>nudgeTap(10);
  $('tap-reset').onclick=()=>moveTap(recordedTaps[selectedTap()]);
  $('tap-preview').onclick=()=>{
    if(active){stop();return;}
    const second=taps[selectedTap()];
    if(second!==undefined)run([second],false,Math.max(0,second-1));
  };
  $('apply').onclick=()=>{
    stop();
    const meter=$('meter').value,downbeat=Number($('phase').value);
    const grid=analyseTappedBars(taps,meter,taps[downbeat]);
    if(!grid)return;
    applied={grid,meter,downbeat,from:taps[0],to:taps.at(-1)};
    onApply(grid,meter);draw();
  };
  $('listen').onclick=()=>{
    if(active){stop();return;}
    if(applied)run(applied.grid.marks.map(mark=>mark.second),false);
  };
  $('clear').onclick=()=>{stop();applied=null;onApply(null);draw();};
  onLanguageChange(draw);draw();sync();
  return {
    sync,stop,
    tapKey(event){
      if(event.code!=='Space'||!active?.recording||event.ctrlKey||event.altKey||event.metaKey)return false;
      if(event.target!==$('hit')&&event.target.closest?.('dialog, input, select, textarea, button, [contenteditable]'))return false;
      event.preventDefault();
      if(!event.repeat)hit(event.timeStamp);
      return true;
    }
  };
}
