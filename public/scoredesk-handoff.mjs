import {prepareEngraving,engravingBars} from './engraving.mjs';
import {scoreMusicXML} from './score-musicxml.mjs';
import {anchorsFor,beatAtTime,timeAtBeat} from './time-map.mjs';
import {exportStem} from './export-name.mjs';
import {stereoWav} from './audio.mjs';
import {tr} from './i18n.mjs';

const AUDIO_LIMIT=200*1024*1024;
const SCORE_LIMIT=8*1024*1024;
const EPS=1e-7;

export function scoreDeskAnchors(project,bars,audioDuration){
  const last=bars.at(-1),end=last.start+last.duration;
  const from=Math.max(0,beatAtTime(project,0)),to=Math.min(end,beatAtTime(project,audioDuration));
  if(to-from<=EPS)return [];
  const beats=[from,...anchorsFor(project).filter(a=>a.beat>from+EPS&&a.beat<to-EPS).map(a=>a.beat),to];
  let bar=0;
  return beats.map(beat=>{
    while(bar<bars.length&&beat>=bars[bar].start+bars[bar].duration-EPS)bar++;
    return {bar,beat:bar===bars.length?0:Math.max(0,beat-bars[bar].start),
      seconds:Math.max(0,Math.min(audioDuration,timeAtBeat(project,beat)))};
  });
}

export async function scoreDeskFile(project,{audio,flats=false}={}){
  const prepared=prepareEngraving(project,{step:0,pickup:project.engraving?.pickup??0,flats});
  const {zipSync,strToU8}=await import('./vendor/scoredesk-zip.js');
  const score=strToU8(scoreMusicXML(prepared));
  if(score.length>SCORE_LIMIT)throw Error(tr('谱面超过改谱台的 8 MiB 限制。','The score exceeds ScoreDesk’s 8 MiB limit.'));
  const manifest={kind:'ScoreDesk',version:1,format:'musicxml',name:project.title,
    layout:{paper:'A4',size:12.5,margin:18,bars:5},anchors:[],pendingFrom:null,audio:null};
  const files={'score.txt':score};
  if(audio){
    const size=44+Math.ceil(audio.duration*22050)*4;
    if(size>AUDIO_LIMIT)throw Error(tr('原音超过改谱台的 200 MiB 限制。可取消携带原音后再试。','The original audio exceeds ScoreDesk’s 200 MiB limit. Try again with audio unchecked.'));
    manifest.anchors=scoreDeskAnchors(project,engravingBars(prepared),audio.duration);
    if(!manifest.anchors.length)throw Error(tr('谱面和原音的时间范围没有重合。请检查原音对齐点，或取消携带原音。','The score and audio do not overlap. Check the alignment or uncheck audio.'));
    const wav=await stereoWav(audio);
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',wav));
    manifest.audioHash=Array.from(hash,byte=>byte.toString(16).padStart(2,'0')).join('');
    manifest.audio={name:exportStem((project.sourceName||'').replace(/\.[^.]+$/,'')||project.title)+'.wav',type:'audio/wav'};
    files.original=wav;
  }
  files['manifest.json']=strToU8(JSON.stringify(manifest));
  return new File([zipSync(files,{level:0})],exportStem(project.title)+'.scoredesk',{type:'application/zip'});
}

function downloadProject(file){
  const url=URL.createObjectURL(file),link=document.createElement('a');
  link.href=url;link.download=file.name;link.hidden=true;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

function openProjectInDesk(tab,file){
  if(tab.closed)return Promise.resolve(false);
  const origin=location.origin;
  const id=crypto.randomUUID();
  const fragment=new URLSearchParams({notemender:id,origin:location.origin});
  return new Promise(resolve=>{
    let timer,uploaded=false;
    function finish(ok){
      clearTimeout(timer);clearInterval(watch);
      window.removeEventListener('message',receive);
      resolve(ok);
    }
    function receive(event){
      if(event.source!==tab||event.origin!==origin||event.data?.id!==id)return;
      if(event.data.type==='scoredesk-ready'&&!uploaded){
        uploaded=true;
        clearTimeout(timer);timer=setTimeout(()=>finish(false),120000);
        try{tab.postMessage({type:'notemender-project',id,file},origin);}catch{finish(false);}
      }else if(uploaded&&event.data.type==='scoredesk-opened')finish(true);
      else if(uploaded&&event.data.type==='scoredesk-rejected')finish(false);
    }
    const watch=setInterval(()=>{if(tab.closed)finish(false);},250);
    window.addEventListener('message',receive);
    timer=setTimeout(()=>finish(false),15000);
    try{tab.location.replace('/scoredesk/#'+fragment);}catch{finish(false);}
  });
}

export function installScoreDeskHandoff({getSnapshot,onStatus,onError}){
  const byId=id=>document.getElementById(id),dialog=byId('scoreDeskDialog'),audio=byId('scoreDeskIncludeAudio');
  const status=byId('scoreDeskStatus'),send=byId('scoreDeskSend'),save=byId('scoreDeskSave'),close=byId('scoreDeskClose');
  const top=byId('scoreDeskTop');
  let busy=false;
  function snapshotOrWarn(displayed=false){
    const snapshot=getSnapshot({displayed});
    if(!snapshot)onError(tr('工作区还没有可交接的谱。请先采用候选或添加音符。','Adopt a candidate or add notes to the workspace first.'));
    return snapshot;
  }
  byId('exportScoreDesk').onclick=()=>{
    const snapshot=snapshotOrWarn();
    if(!snapshot)return;
    audio.checked=false;
    audio.disabled=!snapshot.audio;
    status.textContent=audio.disabled?tr('当前工程没有已加载的原音。','No original audio is loaded for this project.'):'';
    byId('exportDialog').close();
    dialog.showModal();
  };
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  async function transfer({tryOpen,settings}){
    if(busy)return;
    const snapshot=snapshotOrWarn(!settings);
    if(!snapshot)return;
    const includeAudio=settings&&audio.checked&&!audio.disabled;
    let tab=null,opened=false;
    busy=true;top.disabled=send.disabled=save.disabled=close.disabled=audio.disabled=true;
    if(settings)status.textContent=tr('正在准备工程…','Preparing the project…');
    try{
      if(tryOpen){
        tab=window.open('about:blank','_blank');
        if(tab&&!tab.closed){
          tab.document.title='ScoreDesk';
          tab.document.body.textContent=tr('正在准备交接谱面…','Preparing the score for ScoreDesk…');
        }
      }
      const file=await scoreDeskFile(snapshot.project,{flats:snapshot.flats,audio:includeAudio?snapshot.audio:null});
      opened=Boolean(tab&&await openProjectInDesk(tab,file));
      if(opened){
        if(settings)dialog.close();
        return;
      }
      downloadProject(file);
      const message=tryOpen
        ?tr('未能直接打开改谱台，已请求下载工程。可在改谱台手动打开。','Could not open ScoreDesk directly. The project download has been requested. Open the file in ScoreDesk.')
        :tr('已请求下载工程。可在改谱台手动打开。','The project download has been requested. Open the file in ScoreDesk.');
      if(settings)status.textContent=message;
      else onStatus(message);
    }catch(error){
      if(settings)status.textContent=error.message;
      onError(error.message);
    }finally{
      if(!opened&&tab&&!tab.closed)tab.close();
      busy=false;top.disabled=send.disabled=save.disabled=close.disabled=false;audio.disabled=!snapshot.audio;
    }
  }
  top.onclick=()=>void transfer({tryOpen:true,settings:false});
  send.onclick=()=>void transfer({tryOpen:true,settings:true});
  save.onclick=()=>void transfer({tryOpen:false,settings:true});
}
