import {KEYS,numberPitch,keyAt,escapeXML,barLength} from './music.mjs';
import {beatAtTime,timeAtBeat} from './time-map.mjs';
import {engravingSettings} from './engraving-settings.mjs';
const EPS=1e-7;
const lengths=[4,3,2,1.5,1,.75,.5,.375,.25,.1875,.125,.0625];
const widthOf=(text,size)=>[...text].reduce((n,c)=>n+(/[^\x00-\xff]/.test(c)?1:.6)*size,0);
const text=(x,y,value,size,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escapeXML(value)}</text>`;
const line=(x,y,x2,y2,extra='')=>`<path d="M${x},${y}L${x2},${y2}" fill="none" stroke="black" stroke-width="1" ${extra}/>`;

// A presentation copy only. Never quantize or relink the editor's notes here.
export function prepareEngraving(project,options={}) {
  const settings=engravingSettings(options),section=(project.sections||[]).find(s=>s.id===settings.sectionId);
  const last=project.notes.reduce((end,n)=>Math.max(end,n.start+n.duration),0);
  const from=section?Math.max(0,beatAtTime(project,section.audioStart)):0,to=section?Math.min(last,beatAtTime(project,section.audioEnd)):last;
  if(to<=from||!project.notes.length)throw Error('所选范围没有可排版的音符。');
  const copy={...project,title:settings.title??project.title,meter:settings.meter||project.meter,bpm:settings.bpm??project.bpm,key:settings.key??keyAt(project,from)};
  copy.keyChanges=settings.key!==null?[]:[{beat:0,key:keyAt(project,from)},...(project.keyChanges||[]).filter(k=>k.beat>from&&k.beat<to).map(k=>({...k,beat:k.beat-from}))];
  const source=project.notes.filter(n=>n.start<to-EPS&&n.start+n.duration>from+EPS).map(n=>({...n,start:Math.max(from,n.start)-from,duration:Math.min(to,n.start+n.duration)-Math.max(from,n.start),clipped:n.start<from-EPS}));
  const changes=[],issues=[];let maxBeatShift=0,maxSecondShift=0;
  copy.notes=source.map(n=>{
    const a=settings.step?Math.round(n.start/settings.step)*settings.step:n.start,b=settings.step?Math.round((n.start+n.duration)/settings.step)*settings.step:n.start+n.duration;
    if(b<=a+EPS)issues.push(`第 ${(n.start+from+1).toFixed(4).replace(/0+$/,'').replace(/\.$/,'')} 拍：音符整理后时长为零，请改用更细精度或保留原时值。`);
    const shift=Math.max(Math.abs(a-n.start),Math.abs(b-n.start-n.duration));
    const secondShift=Math.max(Math.abs(timeAtBeat(project,a+from)-timeAtBeat(project,n.start+from)),Math.abs(timeAtBeat(project,b+from)-timeAtBeat(project,n.start+n.duration+from)));
    if(shift>EPS){changes.push({id:n.id,before:[n.start,n.start+n.duration],after:[a,b]});maxBeatShift=Math.max(maxBeatShift,shift);maxSecondShift=Math.max(maxSecondShift,secondShift);}
    return {...n,start:a,duration:b-a};
  });
  for(let i=1;i<copy.notes.length;i++)if(copy.notes[i].start<copy.notes[i-1].start+copy.notes[i-1].duration-EPS)issues.push('节奏整理产生音符重叠，请改用更细精度或保留原时值。');
  const ids=new Set(source.map(n=>n.id)),byId=new Map(project.notes.map(n=>[n.id,n])),labels=new Map(),continued=new Set(),orphans=[];
  for(const token of project.lyrics||[]){
    const linked=(token.noteIds||[]).filter(id=>byId.has(id)).sort((a,b)=>byId.get(a).start-byId.get(b).start);
    if(!linked.length){if(!section||token.start==null||token.start<section.audioEnd&&token.end>section.audioStart)orphans.push(token.text);continue;}
    if(ids.has(linked[0]))labels.set(linked[0],[labels.get(linked[0]),token.text].filter(Boolean).join(' '));
    for(const id of linked.slice(1))continued.add(id);
  }
  for(const n of copy.notes){if(!labels.has(n.id)&&!continued.has(n.id)&&n.lyric)labels.set(n.id,n.lyric);n.printLyric=n.clipped?'':labels.get(n.id)||'';n.lyricContinuation=continued.has(n.id);}
  return {project:copy,sourceNotes:source,settings,from,changes,maxBeatShift,maxSecondShift,issues,orphans};
}

export function engravingBars(prepared) {
  if(prepared.issues.length)throw Error(prepared.issues[0]);
  const p=prepared.project,len=barLength(p.meter),end=p.notes.at(-1).start+p.notes.at(-1).duration,total=Math.ceil((end-EPS)/len)*len,bars=[];
  const all=[];let cursor=0;for(const n of p.notes){if(n.start>cursor+EPS)all.push({start:cursor,duration:n.start-cursor,midi:null});all.push(n);cursor=n.start+n.duration;}if(cursor<total-EPS)all.push({start:cursor,duration:total-cursor,midi:null});
  for(const n of all){let at=n.start,remaining=n.duration,part=0;
    while(remaining>EPS){
      const index=Math.floor((at+EPS)/len),barEnd=(index+1)*len,nextKey=(p.keyChanges||[]).find(k=>k.beat>at+EPS)?.beat??Infinity,room=Math.min(remaining,barEnd-at,nextKey-at);
      const duration=lengths.find(d=>d<=room+EPS);
      if(!duration||Math.abs(at*16-Math.round(at*16))>1e-5||Math.abs(duration*16-Math.round(duration*16))>1e-5)throw Error('此范围边界无法用现有最细时值排版，请选择节奏整理，或调整区块边界。');
      bars[index]||={index,atoms:[]};bars[index].atoms.push({...n,start:at,duration,key:keyAt(p,at),part,printLyric:part?'':n.printLyric||'',tieIn:n.midi!==null&&(part>0||n.clipped),tieOut:n.midi!==null&&remaining>duration+EPS});
      at+=duration;remaining-=duration;part++;
    }
  }
  return bars;
}

function wrap(value,maxWidth,size){let out=[],current='';for(const c of value){if(current&&widthOf(current+c,size)>maxWidth){out.push(current);current='';}current+=c;}if(current)out.push(current);return out;}

export function layoutEngraving(prepared) {
  const bars=engravingBars(prepared),s=prepared.settings,f=s.fontSize,scale=96/25.4,width=210*scale,height=297*scale,margin=s.margin*scale,usable=width-margin*2,lyricSize=f*.66;
  const chunks=[];
  for(const bar of bars){let chunk={index:bar.index,atoms:[],minimum:28,last:false},key=null;
    for(const atom of bar.atoms){const keyChange=key===null?atom.key!==prepared.project.key:key!==atom.key;key=atom.key;
      const lyric=s.lyrics?atom.printLyric:'',lyricLines=wrap(lyric,usable-60,lyricSize),long=atom.duration>=2?Math.ceil(atom.duration)-1:0;
      const minimum=Math.min(usable-28,Math.max(f*(1.6+long),...lyricLines.map(t=>widthOf(t,lyricSize)+14)));
      if(chunk.atoms.length&&chunk.minimum+minimum>usable){chunks.push(chunk);chunk={index:bar.index,atoms:[],minimum:28,last:false};}
      chunk.atoms.push({...atom,minimum,lyricLines,keyChange});chunk.minimum+=minimum;
    }chunk.last=true;chunks.push(chunk);
  }
  const rows=[];let row={chunks:[],minimum:0};
  for(const chunk of chunks){if(row.chunks.length&&(row.chunks.length>=s.barsPerRow||row.minimum+chunk.minimum>usable)){rows.push(row);row={chunks:[],minimum:0};}row.chunks.push(chunk);row.minimum+=chunk.minimum;}if(row.chunks.length)rows.push(row);
  for(const row of rows){
    const atoms=row.chunks.flatMap(c=>c.atoms);row.lyricLines=Math.max(0,...atoms.map(a=>a.lyricLines.length));
    row.lyricOffset=Math.max(f*1.5,...atoms.map(a=>{const p=numberPitch(a.midi,a.key),under=Math.max(0,Math.ceil(-Math.log2(a.duration)));return (p.octave<0?9+under*4+(-p.octave-1)*5:under*4)+lyricSize+6;}));
    row.height=Math.max(95,row.lyricLines?f*1.6+row.lyricOffset+row.lyricLines*(lyricSize+4)+12:f*3.7);
  }
  const titleLines=wrap(prepared.project.title,usable,27),headerHeight=65+Math.max(1,titleLines.length)*30;
  const pages=[];let page={rows:[],used:0};
  for(const row of rows){if(row.height>height-2*margin-headerHeight)throw Error('歌词或标题过长，无法放入一页；请缩小字号或在工作区拆分文字。');if(page.rows.length&&page.used+row.height>height-2*margin-headerHeight){pages.push(page);page={rows:[],used:0};}page.rows.push(row);page.used+=row.height;}if(page.rows.length)pages.push(page);
  return {pages,width,height,margin,usable,fontSize:f,lyricSize,titleLines,headerHeight};
}

function drawAtom(a,x,y,w,f,lyricSize,flats,lyricOffset){
  const p=numberPitch(a.midi,a.key,flats),cx=x+f*.65,base=y+f*1.6;let svg='';
  if(a.keyChange)svg+=text(x,y+f*.15,'1='+KEYS[a.key],f*.55);
  svg+=text(cx,base,p.digit,f,'text-anchor="middle" font-family="Times New Roman,serif" font-weight="600"');
  if(p.accidental)svg+=text(cx-f*.68,base-f*.3,p.accidental,f*.65,'text-anchor="middle"');
  const dotted=[.09375,.1875,.375,.75,1.5,3].includes(a.duration),baseDuration=dotted?a.duration/1.5:a.duration,under=Math.max(0,Math.round(-Math.log2(baseDuration)));
  for(let i=0;i<under;i++)svg+=line(cx-f*.36,base+5+i*4,cx+f*.36,base+5+i*4);
  if(dotted&&a.duration<2)svg+=`<circle cx="${cx+f*.57}" cy="${base-f*.2}" r="1.6"/>`;
  for(let i=0;i<Math.abs(p.octave);i++)svg+=`<circle cx="${cx}" cy="${p.octave>0?base-f-5-i*5:base+9+under*4+i*5}" r="1.6"/>`;
  if(a.duration>=2){for(let j=1;j<a.duration;j++)svg+=text(cx+j*(w-f*1.2)/a.duration,base,'−',f,'text-anchor="middle"');}
  if(a.tieIn)svg+=`<path d="M${x-3},${base-f-9}q${f*.5},-8 ${f},0" fill="none" stroke="black"/>`;
  if(a.tieOut)svg+=`<path d="M${cx},${base-f-9}q${Math.max(8,(w-f)/2)},-9 ${Math.max(15,w-f)},0" fill="none" stroke="black"/>`;
  a.lyricLines.forEach((t,i)=>svg+=text(cx-f*.4,base+lyricOffset+i*(lyricSize+4),t,lyricSize));
  if(a.showContinuation&&!a.printLyric)svg+=line(cx-f*.3,base+lyricOffset-lyricSize*.2,x+w-8,base+lyricOffset-lyricSize*.2);
  return svg;
}

export function renderEngraving(prepared) {
  const layout=layoutEngraving(prepared),{width,height,margin,usable,fontSize:f,lyricSize}=layout,p=prepared.project;
  const pages=layout.pages.map((page,index)=>{
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXML(p.title)} 第 ${index+1} 页"><rect width="100%" height="100%" fill="white"/><g fill="black" xml:space="preserve" font-family="'Microsoft YaHei','Noto Sans CJK SC',sans-serif">`;
    layout.titleLines.forEach((title,i)=>svg+=text(width/2,margin+28+i*30,title,27,'text-anchor="middle" font-weight="700"'));
    const metaY=margin+layout.headerHeight-25;
    svg+=text(margin,metaY,`1=${KEYS[p.key]}`,14)+text(margin+85,metaY,p.meter,14)+text(margin+140,metaY,`♩=${p.bpm}`,14);
    let y=margin+layout.headerHeight;
    for(const row of page.rows){let bx=margin;
      for(const chunk of row.chunks){const bw=chunk.minimum+(usable-row.minimum)/row.chunks.length;svg+=text(bx,y-2,String(chunk.index+1)+(chunk.atoms[0].part?'（续）':''),10);
        let x=bx+10;const extra=(bw-chunk.minimum)/chunk.atoms.length;
        for(const atom of chunk.atoms){const w=atom.minimum+extra;svg+=drawAtom({...atom,showContinuation:prepared.settings.lyrics&&atom.lyricContinuation},x,y,w,f,lyricSize,prepared.settings.flats,row.lyricOffset);x+=w;}
        if(chunk.last)svg+=line(bx+bw-4,y+f*.55,bx+bw-4,y+f*2.1);bx+=bw;
      }y+=row.height;
    }
    svg+=text(width/2,height-margin/2,`${index+1} / ${layout.pages.length}`,11,'text-anchor="middle"');return svg+'</g></svg>';
  });
  const all=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height*pages.length}" viewBox="0 0 ${width} ${height*pages.length}">${pages.map((svg,i)=>svg.replace('<svg ',`<svg y="${i*height}" `)).join('')}</svg>`;
  return {...layout,pages,svg:all};
}
