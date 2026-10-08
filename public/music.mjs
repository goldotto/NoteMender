import {anchorsFor,timeAtBeat} from './time-map.mjs';
import {validateSectionRange} from './sections.mjs';
import {normalizeLyrics,lyricLabels} from './lyrics.mjs';
import {timelineLyrics,lyricRows} from './lyric-score.mjs';
export const KEYS = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
export const mod = (n,m) => ((n%m)+m)%m;
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export const snap = (x,step=.25) => Math.round(x/step)*step;
export const EDIT_STEP = .0625;
export const uid = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
export const escapeXML = s => String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export const pitchName = midi => midi === null ? '休止' : ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][mod(midi,12)]+(Math.floor(midi/12)-1);
export function keyAt(project,beat){let key=project.key;for(const change of project.keyChanges||[]){if(change.beat>beat+1e-6)break;key=change.key;}return key;}
export function numberPitch(midi, key=0, flats=false) {
  if(midi===null) return {digit:'0',accidental:'',octave:0};
  const delta=midi-(60+key), pc=mod(delta,12);
  const sharp=[[1,''],[1,'♯'],[2,''],[2,'♯'],[3,''],[4,''],[4,'♯'],[5,''],[5,'♯'],[6,''],[6,'♯'],[7,'']];
  const flat=[[1,''],[2,'♭'],[2,''],[3,'♭'],[3,''],[4,''],[5,'♭'],[5,''],[6,'♭'],[6,''],[7,'♭'],[7,'']];
  const [digit,accidental]=(flats?flat:sharp)[pc];
  return {digit:String(digit),accidental,octave:Math.floor(delta/12)};
}
export function validateProject(value) {
  if (!value || value.version!==1 || !Array.isArray(value.notes) || value.notes.length>12000) throw Error('不是有效的简谱工程（需要 version: 1，最多 12000 个音符）。');
  const number=(v,a,b,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<a||v>b)throw Error(label+'超出范围');return v;};
  const bpm=number(value.bpm,30,300,'速度');
  const key=number(value.key,0,11,'调号');if(!Number.isInteger(key)) throw Error('调号必须是整数');
  const meter=value.meter||'4/4';if(!['2/4','3/4','4/4','6/8'].includes(meter))throw Error('不支持的拍号');
  const notes=value.notes.map(n=>{
    const start=number(n.start,0,14400,'起始拍'),duration=number(n.duration,EDIT_STEP,128,'时值');
    if(Math.abs(snap(start,EDIT_STEP)-start)>1e-5||Math.abs(snap(duration,EDIT_STEP)-duration)>1e-5)throw Error('音符需对齐到 1/16 拍网格');
    if(n.midi!==null && (!Number.isInteger(n.midi)||n.midi<21||n.midi>108))throw Error('音高须为 MIDI 21–108 或休止');
    return {id:typeof n.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(n.id)?n.id:uid(),start,duration,midi:n.midi,confidence:typeof n.confidence==='number'&&Number.isFinite(n.confidence)?clamp(n.confidence,0,1):1,reviewStatus:n.reviewStatus==='reviewed'?'reviewed':'pending',reviewFlags:Array.isArray(n.reviewFlags)?n.reviewFlags.slice(0,4).map(x=>String(x).slice(0,30)):[],lyric:String(n.lyric||'').slice(0,40)};
  }).sort((a,b)=>a.start-b.start);
  if(new Set(notes.map(n=>n.id)).size!==notes.length)throw Error('音符 ID 重复');
  for(let i=1;i<notes.length;i++) if(notes[i].start<notes[i-1].start+notes[i-1].duration-1e-5) throw Error('主旋律音符不能重叠，请调整起始拍与时值。');
  const end=notes.length ? notes.at(-1).start+notes.at(-1).duration : 0;
  if(end>14400)throw Error('工程太长');
  const aiLog=Array.isArray(value.aiLog)?value.aiLog.slice(-50).filter(x=>x&&typeof x==='object').map(x=>({at:String(x.at||'').slice(0,40),type:String(x.type||'').slice(0,30),model:String(x.model||'').slice(0,60),summary:String(x.summary||'').slice(0,1200),tokens:Number.isFinite(x.tokens)?Math.max(0,Math.floor(x.tokens)):0})):[];
  const keyChanges=(value.keyChanges||[]).map(c=>{const beat=number(c.beat,0,14400,'转调位置'),k=number(c.key,0,11,'段落调号');if(!Number.isInteger(k)||Math.abs(snap(beat)-beat)>1e-5)throw Error('无效段落调号');return {beat,key:k};}).sort((a,b)=>a.beat-b.beat);
  if(keyChanges.length>100||new Set(keyChanges.map(c=>c.beat)).size!==keyChanges.length)throw Error('段落调号过多或位置重复');
  const sections=(value.sections||[]).map(s=>{const audioStart=number(s.audioStart??Math.max(0,timeAtBeat(value,number(s.start,0,14400,'旧段落起始拍'))),0,3600,'区块起始秒'),audioEnd=number(s.audioEnd??Math.max(0,timeAtBeat(value,number(s.end,0,14400,'旧段落结束拍'))),0,3600,'区块结束秒');return {id:typeof s.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(s.id)?s.id:uid(),candidateId:typeof s.candidateId==='string'?s.candidateId.slice(0,80):null,name:String(s.name||'未命名段落').slice(0,40),kind:['intro','interlude','outro','verse','chorus','other'].includes(s.kind)?s.kind:'other',source:['original','vocals','other','bass','drums','instrumental','guitar','piano'].includes(s.source)?s.source:['intro','interlude','outro'].includes(s.kind)?'other':'vocals',audioStart,audioEnd,analysisMode:['auto','vocal','solo','dense'].includes(s.analysisMode)?s.analysisMode:'auto',analysisUsed:Array.isArray(s.analysisUsed)?s.analysisUsed.slice(0,120).filter(x=>x&&Number.isFinite(x.from)&&Number.isFinite(x.to)&&x.to>x.from).map(x=>({from:x.from,to:x.to,mode:['vocal','solo','dense'].includes(x.mode)?x.mode:'dense',source:['original','vocals','other','bass','drums','instrumental','guitar','piano'].includes(x.source)?x.source:'original',flags:Array.isArray(x.flags)?x.flags.slice(0,12).map(y=>String(y).slice(0,30)):[]})):[]};}).sort((a,b)=>a.audioStart-b.audioStart);
  if(sections.length>100||new Set(sections.map(s=>s.id)).size!==sections.length)throw Error('段落过多或 ID 重复');
  sections.forEach(s=>validateSectionRange(sections,s,s.id));
  const offset=number(value.offset??0,-60,3600,'原音偏移');
  const timeAnchors=Array.isArray(value.timeAnchors)?value.timeAnchors.map(a=>({beat:number(a.beat,0,14400,'对齐拍'),second:number(a.second,-60,3600,'对齐秒')})):[];
  if(timeAnchors.length===1||timeAnchors.length>1200||timeAnchors.some((a,i)=>i&&(a.beat<=timeAnchors[i-1].beat||a.second<=timeAnchors[i-1].second)))throw Error('对齐点须按拍数和原音秒数递增');
  if(timeAnchors.length&&timeAnchors[0].beat!==0)throw Error('第一个对齐点必须从第 0 拍开始');
  const audioResources=Array.isArray(value.audioResources)?value.audioResources.slice(0,800).filter(r=>r&&/^[a-f0-9]{64}$/.test(r.id)&&['original','vocals','other','bass','drums','instrumental','guitar','piano'].includes(r.source)&&Number.isFinite(r.audioStart)&&Number.isFinite(r.audioEnd)&&r.audioStart>=0&&r.audioEnd>r.audioStart&&r.audioEnd<=3600).map(r=>({id:r.id,source:r.source,audioStart:r.audioStart,audioEnd:r.audioEnd,model:String(r.model||'').slice(0,80)})):[];
  if(Array.isArray(value.alternates)&&value.alternates.length>2000)throw Error('备选谱最多 2000 份，请另存精简工程；不会截断导入。');
  const alternates=Array.isArray(value.alternates)?value.alternates.map(c=>{if(Array.isArray(c.notes)&&c.notes.length>12000)throw Error('单份备选谱最多 12000 个音符；不会截断导入。');const notes=Array.isArray(c.notes)?c.notes.filter(n=>Number.isFinite(n.start)&&Number.isFinite(n.duration)&&n.start>=0&&n.duration>=EDIT_STEP&&Number.isInteger(n.midi)&&n.midi>=21&&n.midi<=108).map(n=>({...n,id:typeof n.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(n.id)?n.id:uid(),start:n.start,duration:n.duration,midi:n.midi,lyric:String(n.lyric||'').slice(0,40),confidence:clamp(n.confidence??.5,0,1),reviewFlags:Array.isArray(n.reviewFlags)?n.reviewFlags.slice(0,4).map(x=>String(x).slice(0,30)):[]})):[];return ({id:String(c.id||uid()).slice(0,80),sectionId:String(c.sectionId||'').slice(0,80),source:['original','other','vocals','bass','drums','instrumental','guitar','piano'].includes(c.source)?c.source:'original',method:String(c.method||'备选').slice(0,60),model:String(c.model||'').slice(0,80),primary:Boolean(c.primary),resourceId:typeof c.resourceId==='string'&&/^[a-f0-9]{64}$/.test(c.resourceId)?c.resourceId:null,audioStart:Number.isFinite(c.audioStart)?c.audioStart:null,audioEnd:Number.isFinite(c.audioEnd)?c.audioEnd:null,diagnostics:Array.isArray(c.diagnostics)?c.diagnostics.slice(0,200).filter(x=>Number.isFinite(x.second)).map(x=>({second:x.second,end:Number.isFinite(x.end)?x.end:undefined,kind:String(x.kind||'待核对').slice(0,60),pitches:(x.pitches||[]).slice(0,4).filter(p=>Number.isInteger(p.midi)&&p.midi>=21&&p.midi<=108).map(p=>({engine:String(p.engine).slice(0,50),midi:p.midi}))})):[],notes,lyricAssist:Boolean(c.lyricAssist),...(Array.isArray(c.lyrics)?{lyrics:normalizeLyrics(c.lyrics,notes)}:{})});}):[];
  return {version:1,title:String(value.title||'未命名乐谱').slice(0,120),bpm,key,meter,layout:value.layout==='barred'?'barred':'free',keyChanges,sections,offset,timeAnchors,alternates,audioResources,notes,...(Array.isArray(value.lyrics)?{lyrics:normalizeLyrics(value.lyrics,notes)}:{}),sourceName:String(value.sourceName||'').slice(0,200),engine:String(value.engine||'手工编写').slice(0,100),aiLog};
}
export function transpose(project, target, direction='nearest') {
  let shift=mod(target-project.key,12);
  if(direction==='nearest' && shift>6)shift-=12;
  if(direction==='down'&&shift>0)shift-=12;
  if(project.notes.some(n=>n.midi!==null&&(n.midi+shift<21||n.midi+shift>108)))throw Error('转调将超出可编辑音域，请改选方向。');
  return {...project,key:target,keyChanges:(project.keyChanges||[]).map(c=>({...c,key:mod(c.key+shift,12)})),notes:project.notes.map(n=>({...n,midi:n.midi===null?null:n.midi+shift}))};
}
export function shiftAllNotes(project,semitones){
  if(!Number.isInteger(semitones)||semitones===0||Math.abs(semitones)>24)throw Error('整体升降音须为 1–24 个半音');
  if(project.notes.some(n=>n.midi!==null&&(n.midi+semitones<21||n.midi+semitones>108)))throw Error('整体升降音会超出 MIDI 21–108，请缩小幅度');
  return {...project,key:mod(project.key+semitones,12),keyChanges:(project.keyChanges||[]).map(c=>({...c,key:mod(c.key+semitones,12)})),notes:project.notes.map(n=>({...n,midi:n.midi===null?null:n.midi+semitones}))};
}
export function estimateKey(notes) {
  const profile=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],chroma=Array(12).fill(0);
  for(const n of notes)if(n.midi!==null)chroma[mod(n.midi,12)]+=n.duration;
  let best=0,max=-Infinity;
  for(let k=0;k<12;k++){let score=0;for(let p=0;p<12;p++)score+=chroma[p]*profile[mod(p-k,12)];if(score>max){max=score;best=k;}}
  return best;
}
export function quantizeNotes(raw,bpm,offset=0,step=.25,trace=null) {
  const notes=[];
  for(const r of [...raw].sort((a,b)=>a.start-b.start)) {
    if(!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.end<=r.start||!Number.isFinite(r.midi))continue;
    let start=Math.max(0,snap((r.start-offset)*bpm/60,step));
    const end=Math.max(start+step,snap((r.end-offset)*bpm/60,step));
    if(notes.length && start<notes.at(-1).start+notes.at(-1).duration) {
      const prev=notes.at(-1);if(start<=prev.start) {if((r.confidence??0)>(prev.confidence??0))notes.pop();else continue;}
      else prev.duration=start-prev.start;
    }
    const note={id:uid(),start,duration:Math.min(128,end-start),midi:clamp(Math.round(r.midi),21,108),confidence:clamp(r.confidence??.5,0,1),reviewStatus:'pending',reviewFlags:Array.isArray(r.reviewFlags)?r.reviewFlags:[],lyric:''};
    notes.push(note);if(trace&&r.evidenceId)trace.push({evidenceId:r.evidenceId,noteId:note.id});
  }
  return notes;
}
export const barLength = meter => {const [n,d]=meter.split('/').map(Number);return n*4/d;};
export function scoreSegments(project) {
  const len=barLength(project.meter),total=project.notes.length?project.notes.at(-1).start+project.notes.at(-1).duration:len;
  const bars=Array.from({length:Math.max(1,Math.ceil(total/len))},()=>[]);
  const all=[];let cursor=0;
  for(const n of project.notes){if(n.start>cursor)all.push({start:cursor,duration:n.start-cursor,midi:null});all.push(n);cursor=n.start+n.duration;}
  if(cursor<bars.length*len)all.push({start:cursor,duration:bars.length*len-cursor,midi:null});
  for(const n of all){let t=n.start,left=n.duration,continued=false;
    while(left>1e-6){const bi=Math.floor((t+1e-6)/len),room=len-mod(t,len);let d=Math.min(left,room);
      if(![.0625,.125,.1875,.25,.375,.5,.75,1,1.5,2,3,4].includes(d))d=[4,3,2,1.5,1,.75,.5,.375,.25,.1875,.125,.0625].find(x=>x<=d+1e-6)||.0625;
      bars[bi]?.push({...n,start:t,duration:d,continued,tieNext:left>d+1e-6});
      t+=d;left-=d;continued=true;
    }
  }
  return bars;
}
export function scoreSVG(project,{selected=null,flats=false,active=null}={}) {
  const bars=scoreSegments(project),len=barLength(project.meter),rowHeight=126,layout=[];let rows=0;
  if(bars.some(bar=>bar.length>12||bar.some(n=>n.duration<.25)))return denseBarScoreSVG(project,bars,{selected,flats,active});
  for(let i=0;i<bars.length;){let count=4;if(bars.slice(i,i+4).some(b=>b.length>7))count=2;if(bars.slice(i,i+count).some(b=>b.length>12))count=1;for(let col=0;col<count&&i<bars.length;col++,i++)layout.push({row:rows,col,count});rows++;}
  const width=1000,height=180+rows*rowHeight,margin=56;
  let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXML(project.title)}简谱"><rect width="100%" height="100%" fill="#fffdf8"/><g font-family="'Microsoft YaHei', sans-serif" fill="#252a29"><text x="500" y="55" text-anchor="middle" font-size="26" font-weight="700">${escapeXML(project.title)}</text><text x="56" y="101" font-size="15">1 = ${KEYS[project.key]}　 ${project.meter}　 ♩ = ${project.bpm}</text><text x="944" y="101" text-anchor="end" font-size="12" fill="#7b827e">听谱 · 主旋律简谱</text>`;
  bars.forEach((bar,i)=>{
    const {row,col,count}=layout[i],bw=(width-margin*2)/count,bx=margin+col*bw,by=159+row*rowHeight;
    s+=`<text x="${bx+3}" y="${by-21}" font-size="10" fill="#999f99">${i+1}</text><path d="M${bx+bw-5},${by-5}v44" stroke="#a9b0a9" stroke-width="1"/>`;
    if(col===0)s+=`<text x="${bx+22}" y="${by-40}" font-size="11" fill="#386e5a">1=${KEYS[keyAt(project,i*len)]}</text>`;
    for(const change of project.keyChanges||[])if(change.beat>=i*len&&change.beat<(i+1)*len)s+=`<text x="${bx+17+mod(change.beat,len)/len*(bw-28)}" y="${by-23}" font-size="12" fill="#127d6e">转 1=${KEYS[change.key]}</text>`;
    for(const n of bar){const x=bx+17+mod(n.start,len)/len*(bw-28),y=by+19,p=numberPitch(n.midi,keyAt(project,n.start),flats);let color=n.id===active?'#127d6e':'#252a29';
      const clickable=n.id?`data-note="${escapeXML(n.id)}" data-start="${n.start}" tabindex="0" role="button" aria-label="${escapeXML(pitchName(n.midi))}，${n.start+1}拍，${n.duration}拍时值"`:'';
      s+=`<g ${clickable} style="cursor:${n.id?'pointer':'default'}">`;
      if(n.id)s+=`<rect x="${x-13}" y="${by-14}" width="${Math.max(24,n.duration/len*(bw-28)-3)}" height="68" rx="6" fill="${n.id===selected?'#d5eee6':n.reviewStatus==='reviewed'?'transparent':'#fff1d4'}"/>`;
      s+=`<text x="${x}" y="${y}" text-anchor="middle" font-family="Georgia,serif" font-size="26" font-weight="600" fill="${color}">${p.digit}</text>`;
      if(p.accidental)s+=`<text x="${x-15}" y="${y-8}" font-size="14">${p.accidental}</text>`;
      for(let o=0;o<Math.abs(p.octave);o++)s+=`<circle cx="${x}" cy="${p.octave>0?y-29-o*5:y+15+o*5}" r="1.8" fill="${color}"/>`;
      if(n.duration<1){const lines=n.duration<.125?4:n.duration<.25?3:n.duration<.5?2:1;for(let j=0;j<lines;j++)s+=`<path d="M${x-9},${y+4+j*4}h18" stroke="${color}" stroke-width="1.4"/>`;}
      if([.1875,.375,.75,1.5].includes(n.duration))s+=`<circle cx="${x+13}" cy="${y-6}" r="1.8"/>`;
      if(n.duration>=2)for(let d=1;d<n.duration;d++)s+=`<text x="${x+d/len*(bw-28)}" y="${y}" text-anchor="middle" font-size="21">−</text>`;
      if((n.continued||n.tieNext)&&n.midi!==null)s+=`<path d="M${x-7},${by-12}q${Math.max(9,n.duration/len*(bw-28)/2)},-14 ${Math.max(18,n.duration/len*(bw-28)-3)},0" fill="none" stroke="#626c63"/>`;
      if((lyricLabels(project).get(n.id)||n.lyric)&&!n.continued)s+=`<text x="${x}" y="${y+47}" text-anchor="middle" font-size="12">${escapeXML(lyricLabels(project).get(n.id)||n.lyric)}</text>`;
      s+='</g>';
    }
  });
  s+=`<text x="56" y="${height-20}" font-size="11" fill="#8b918b">四分音符为 1 拍 · 浅黄色音符待校对 · 转调改变旋律音高，原音保持原调</text></g></svg>`;return s;
}
function denseBarScoreSVG(project,bars,{selected,flats,active}){
  const width=1000,cell=74,perRow=12,barHeights=bars.map(bar=>43+Math.ceil(Math.max(1,bar.length)/perRow)*86),height=150+barHeights.reduce((a,b)=>a+b,0);
  let y=105,s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXML(project.title)}分小节简谱"><rect width="100%" height="100%" fill="#fffdf8"/><g font-family="'Microsoft YaHei', sans-serif"><text x="56" y="51" font-size="25" font-weight="700" fill="#29362f">${escapeXML(project.title)}</text><text x="56" y="80" font-size="13" fill="#697e69">1 = ${KEYS[project.key]}　${project.meter}　♩ = ${project.bpm}　· 密集音符按顺序换行</text>`;
  bars.forEach((bar,i)=>{
    s+=`<text x="56" y="${y+18}" font-size="13" font-weight="600" fill="#386e5a">第 ${i+1} 小节　1=${KEYS[keyAt(project,i*barLength(project.meter))]}</text><path d="M56,${y+29}h888" stroke="#d6dfd4"/>`;
    bar.forEach((n,j)=>{
      const x=56+j%perRow*cell,cy=y+39+Math.floor(j/perRow)*86,p=numberPitch(n.midi,keyAt(project,n.start),flats),bg=n.id===selected?'#d5eee6':n.id===active?'#d7f2ec':!n.id?'#f2f4ef':n.reviewStatus==='reviewed'?'#eef5ed':'#fff1d4';
      const click=n.id?`data-note="${escapeXML(n.id)}"`:`data-free-start="${n.start}"`;
      s+=`<g ${click} data-start="${n.start}" tabindex="0" role="button" aria-label="${escapeXML(pitchName(n.midi))}，第 ${n.start+1} 拍，${n.duration} 拍" style="cursor:pointer"><rect x="${x}" y="${cy}" width="68" height="77" rx="8" fill="${bg}" stroke="#d9e2d6"/><text x="${x+34}" y="${cy+34}" text-anchor="middle" font-family="Georgia,serif" font-size="25" font-weight="600" fill="#29362f">${p.accidental}${p.digit}${p.octave>0?'̇'.repeat(p.octave):p.octave<0?'̣'.repeat(-p.octave):''}</text><text x="${x+34}" y="${cy+53}" text-anchor="middle" font-size="10" fill="#687868">${n.duration} 拍${n.tieNext?' →':''}</text><text x="${x+34}" y="${cy+69}" text-anchor="middle" font-size="9" fill="#8b9789">${+(n.start+1).toFixed(4)} 拍</text></g>`;
    });
    y+=barHeights[i];
  });
  s+=`<text x="56" y="${height-16}" font-size="11" fill="#8b918b">黄色待校对 · 密集音符按小节分组并自动换行 · 仍可点击逐音修改</text></g></svg>`;
  return s;
}
export function freeScoreSVG(project,{selected=null,selectedIds=[],selectedGap=null,flats=false,zoom=180,beatsPerRow=4,measureText=null,compactHeader=false,selectedLyric=null,idPrefix=""}={}){
  const left=42,rowTop=compactHeader?88:116,rowHeight=68,lastNote=project.notes.at(-1),endBeat=Math.max(project.previewEnd||0,(lastNote?.start||0)+(lastNote?.duration||0),...timelineLyrics(project).map(t=>t.beatEnd||0)),first=0,last=Math.max(beatsPerRow,Math.ceil((endBeat+(Number.isFinite(project.previewEnd)?0:EDIT_STEP))/beatsPerRow)*beatsPerRow),width=left*2+beatsPerRow*zoom;
  const rowStarts=[first];for(let beat=first+beatsPerRow;beat<=last+1e-6;beat+=beatsPerRow)rowStarts.push(beat);
  const rows=rowStarts.length-1,rowLayout=lyricRows(project,rowStarts,{rowTop,rowHeight}),height=rowLayout.at(-1).y+rowLayout.at(-1).height+28;
  let s=`<svg class="graphical-score" data-zoom="${zoom}" data-left="${left}" data-row-top="${rowTop}" data-row-height="${rowHeight}" data-row-ys="${rowLayout.map(r=>r.y).join(',')}" data-row-heights="${rowLayout.map(r=>r.height).join(',')}" data-beats-per-row="${beatsPerRow}" data-row-starts="${rowStarts.join(',')}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXML(project.title)}自由简谱"><rect width="100%" height="100%" fill="#fffdf8"/><g font-family="'Microsoft YaHei', sans-serif"><text x="${left}" y="${compactHeader?26:48}" font-size="${compactHeader?16:25}" font-weight="700" fill="#29362f">${escapeXML(project.title)}</text><text x="${left}" y="${compactHeader?48:76}" font-size="${compactHeader?11:13}" fill="#697e69">1 = ${KEYS[project.key]}　♩ = ${project.bpm}　· 色块长度代表时值，数字大小固定</text>`;
  for(let row=0;row<rows;row++){const y=rowLayout[row].y,from=rowStarts[row],to=rowStarts[row+1],w=(to-from)*zoom;s+=`<rect x="${left-8}" y="${y-27}" width="${beatsPerRow*zoom+16}" height="55" rx="8" fill="${row%2?'#f6f8f2':'#fafbf6'}"/><rect data-timeline-grid="${row}" data-row-start="${from}" data-row-end="${to}" x="${left}" y="${y-27}" width="${w}" height="55" fill="transparent"/>`;for(let beat=Math.ceil(from);beat<to;beat++){const x=left+(beat-from)*zoom;s+=`<path d="M${x},${y-20}v40" stroke="#dbe4d8"/><text x="${x+5}" y="${y-28}" font-size="10" fill="#91a18f">${beat+1}</text>`;}if(from%1)s+=`<text x="${left+5}" y="${y-28}" font-size="10" fill="#91a18f">${+(from+1).toFixed(3)}</text>`;}
  const items=[];let cursor=first;for(const n of project.notes){const noteEnd=n.start+n.duration;if(n.start>cursor)items.push({start:cursor,duration:n.start-cursor,midi:null,gap:true});items.push(n);cursor=noteEnd;}if(cursor<last)items.push({start:cursor,duration:last-cursor,midi:null,gap:true});
  const selectedSet=new Set(selectedIds);
  for(const n of items){let t=n.start,remaining=n.duration,continued=false;while(remaining>1e-6){const row=Math.max(0,rowStarts.findIndex((start,i)=>i<rows&&t>=start-1e-6&&t<rowStarts[i+1]-1e-6)),fragment=Math.min(remaining,rowStarts[row+1]-t),x=left+(t-rowStarts[row])*zoom,y=rowLayout[row].y,w=fragment*zoom,p=numberPitch(n.midi,keyAt(project,t),flats),label=continued?'↳':`${p.accidental}${p.digit}${p.octave>0?'̇'.repeat(p.octave):p.octave<0?'̣'.repeat(-p.octave):''}`,selectedNote=n.id===selected||selectedSet.has(n.id),selectedGapPart=n.gap&&selectedGap!==null&&selectedGap>=t-1e-6&&selectedGap<t+fragment-1e-6,fill=n.gap?'#f1f3eb':selectedNote?'#b3dfc8':n.reviewStatus==='reviewed'?'#e7f0e5':'#f6e4c1',stroke=n.gap?'#c9d1c5':selectedNote?'#287b5b':n.reviewStatus==='reviewed'?'#92b59b':'#d7ac6b',group=n.id?`class="timeline-note${selectedNote?' selected':''}" data-note="${escapeXML(n.id)}"`:`data-free-start="${t}" data-gap-duration="${fragment}" ${selectedGapPart?'data-selected-gap="1"':''}`,labelName=n.gap?'空拍':pitchName(n.midi),ribbonX=x+1,ribbonWidth=Math.max(2,w-2),fullLabel=n.gap?'+':label,displayLabel=ribbonWidth>=Math.max(18,(measureText?measureText(fullLabel):fullLabel.length*14)+9)?fullLabel:'',tiny=!displayLabel;
    s+=`<g ${group} data-start="${t}" data-row="${row}" tabindex="0" role="button" aria-label="${escapeXML(labelName)}，第 ${t+1} 拍，持续 ${fragment} 拍" style="cursor:${n.gap?'pointer':'grab'}"><rect class="timeline-ribbon" x="${ribbonX}" y="${y-15}" width="${ribbonWidth}" height="38" rx="${Math.min(7,ribbonWidth/2)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${n.gap?'stroke-dasharray="4 4"':''}/>${tiny?`<path class="timeline-tiny" d="M${x+w/2} ${y-3}v13" stroke="${n.gap?'#a6b3a5':'#324b3b'}" stroke-width="1.4" pointer-events="none"/>`:`<text class="timeline-label" x="${x+w/2}" y="${y+11}" text-anchor="middle" font-family="Georgia,serif" font-size="20" font-weight="600" fill="${n.gap?'#a6b3a5':'#324b3b'}" pointer-events="none">${escapeXML(displayLabel)}</text>`}`;
    if(n.id&&!continued&&n.hasStart!==false)s+=`<path class="timeline-edge" d="M${ribbonX+1} ${y-12}v32" stroke="#4b8a68" stroke-width="1" pointer-events="none"/><rect class="timeline-resize-hit" data-resize="start" x="${ribbonX-6}" y="${y-15}" width="13" height="${w<32?18:38}" fill="transparent" style="cursor:ew-resize"/>`;
    if(n.id&&remaining-fragment<1e-6&&n.hasEnd!==false)s+=`<path class="timeline-edge" d="M${ribbonX+ribbonWidth-1} ${y-12}v32" stroke="#4b8a68" stroke-width="1" pointer-events="none"/><rect class="timeline-resize-hit" data-resize="end" x="${ribbonX+ribbonWidth-7}" y="${w<32?y+4:y-15}" width="13" height="${w<32?19:38}" fill="transparent" style="cursor:ew-resize"/>`;

    s+='</g>';t+=fragment;remaining-=fragment;continued=true;
  }}
  for(let row=0;row<rows;row++)for(const t of rowLayout[row].segments){const x=left+(t.from-rowStarts[row])*zoom,y=rowLayout[row].y+28+t.lane*24,w=Math.max(3,(t.to-t.from)*zoom-2),clip=idPrefix+'lyric-'+row+'-'+t.id,label=t.hasStart===false||t.from>t.beatStart+1e-6?'↳ '+t.text:t.text,captionX=x+(w+2)/2,captionClip=clip;
    s+=`<g class="score-lyric-bar${t.id===selectedLyric?' active':''}" data-lyric="${escapeXML(t.id)}" data-row="${row}" data-start="${t.from}" data-lyric-start="${t.beatStart}" data-lyric-end="${t.beatEnd}" tabindex="0" role="button" aria-label="歌词：${escapeXML(t.text)}"><defs><clipPath id="${escapeXML(clip)}"><rect x="${x+3}" y="${y}" width="${Math.max(0,w-6)}" height="20"/></clipPath></defs><rect class="lyric-ribbon" x="${x+1}" y="${y}" width="${w}" height="20" rx="4" fill="${t.reviewed?'#e5f0e9':'#edf1f7'}" stroke="${t.reviewed?'#94b4a0':'#acb9ca'}"/><text class="score-lyric" x="${captionX}" y="${y+14}" text-anchor="middle" font-size="11" fill="#3e5d4b" clip-path="url(#${escapeXML(captionClip)})" pointer-events="none">${escapeXML(label)}</text><rect data-lyric-resize="start" x="${x+1}" y="${y}" width="${Math.min(8,w)}" height="${w<24?9:20}" fill="transparent" style="cursor:ew-resize"/><rect data-lyric-resize="end" x="${x+1+Math.max(0,w-8)}" y="${w<24?y+11:y}" width="${Math.min(8,w)}" height="${w<24?9:20}" fill="transparent" style="cursor:ew-resize"/></g>`;
  }
  s+=`<text x="${left}" y="${height-11}" font-size="11" fill="#8b918b">点色块在右侧编辑 · 拖色块移动 · 拖左右边缘调整时长 · 点“+”插入</text></g></svg>`;return s;
}
export function midiFile(project) {
  const enc=new TextEncoder(),be=(n,len)=>Array.from({length:len},(_,i)=>(n>>((len-i-1)*8))&255);
  const vlq=n=>{let a=[n&127];while(n>>=7)a.unshift((n&127)|128);return a;};
  const points=anchorsFor(project),events=[];
  for(let i=0;i<points.length-1;i++){const bpm=60*(points[i+1].beat-points[i].beat)/(points[i+1].second-points[i].second);events.push({tick:Math.round(points[i].beat*480),priority:0,bytes:[255,81,3,...be(Math.round(60000000/clamp(bpm,30,300)),3)]});}
  const [num,den]=project.meter.split('/').map(Number);events.push({tick:0,priority:0,bytes:[255,88,4,num,Math.log2(den),24,8]});
  for(const n of project.notes)if(n.midi!==null){events.push({tick:Math.round(n.start*480),priority:2,bytes:[144,n.midi,88]},{tick:Math.round((n.start+n.duration)*480),priority:1,bytes:[128,n.midi,0]});}
  events.sort((a,b)=>a.tick-b.tick||a.priority-b.priority);let track=[],prev=0;for(const e of events){track.push(...vlq(e.tick-prev),...e.bytes);prev=e.tick;}track.push(0,255,47,0);
  return new Uint8Array([...enc.encode('MThd'),0,0,0,6,0,0,0,1,1,224,...enc.encode('MTrk'),...be(track.length,4),...track]);
}
export function makeDemo(){return {version:1,title:'晴日小调 · 示例',bpm:112,key:0,meter:'4/4',layout:'free',offset:0,sourceName:'',engine:'内置原创示例',notes:[60,64,67,64,62,65,69,67,64,67,72,71,69,67,64,null,65,69,72,69,64,67,71,67,62,65,69,67,64,62,60,null].map((midi,i)=>({id:uid(),start:i,duration:1,midi,confidence:1,lyric:i===0?'晴':i===1?'日':i===2?'微':i===3?'风':''}))};}
