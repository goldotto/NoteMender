// NoteMender IDs and absolute pitches remain authoritative. Dolce only receives a projection.
import {engravingBars} from './engraving.mjs';
import {numberPitch,KEYS} from './music.mjs';

const fifths=[0,-5,2,-3,4,-1,-6,1,-4,3,-2,5];
const keyOf=key=>({fifths:fifths[key],spelling:KEYS[key].includes('♭')?'b'+KEYS[key][0]:KEYS[key],display:KEYS[key],tonicDegree:'1'});
const types=new Map([[4,'whole'],[2,'half'],[1,'quarter'],[.5,'eighth'],[.25,'16th'],[.125,'32nd'],[.0625,'64th']]);
export function dolceDocument(prepared){
  const bars=engravingBars(prepared),owners=new Map(),cells=new Map(),ends=new Map(),marks=[],p=prepared.project;
  const displayNotes=new Map(p.notes.map(n=>[n.id,n])),sourceNotes=new Map(prepared.sourceNotes.map(n=>[n.id,n]));
  let nextId=1,previousKey=p.key;
  const measures=bars.map(bar=>{
    const elements=[],directions=[];
    for(const atom of bar.atoms){
      const id=nextId++,pitch=numberPitch(atom.midi,atom.key,prepared.settings.flats),vocal=atom.vocal||{};
      const dotted=[.1875,.375,.75,1.5,3].includes(atom.duration),base=dotted?atom.duration/1.5:atom.duration;
      const last=!atom.tieOut;
      const displayNote=displayNotes.get(atom.id),original=sourceNotes.get(atom.id);
      const realBeat=value=>original&&displayNote?original.start+prepared.from+(value-displayNote.start)*original.duration/displayNote.duration:value+prepared.from;
      cells.set(id,{id:atom.id||'',beat:realBeat(atom.start),end:realBeat(atom.start+atom.duration),part:atom.part});
      const chord={kind:'chord',id,voice:1,staff:1,duration:{divisions:atom.duration*48,type:types.get(base),dots:dotted?1:0},notes:atom.midi===null?[]:[{degree:{number:Number(pitch.digit),octaveShift:pitch.octave,...(pitch.accidental?{accidental:pitch.accidental==='♯'?'sharp':'flat'}:{})},tie:{start:atom.tieOut,stop:atom.tieIn}}],...(atom.midi===null?{rest:{}}:{}),lyrics:prepared.settings.lyrics&&atom.printLyric?[{number:1,text:atom.printLyric}]:[],notations:{articulations:[...(last&&vocal.breath?['breath-mark']:[]),...(!atom.part&&vocal.accent?['accent']:[])],fermata:last&&vocal.fermata}};
      const group=p.meter==='6/8'?1.5:1,position=atom.start-bar.start;
      if(prepared.settings.groupBeats&&position>1e-7&&Math.abs(position/group-Math.round(position/group))<1e-7)chord.before=[{kind:'boundary',behavior:'break'}];
      if(atom.id){
        owners.set(id,atom.id);
        const range=ends.get(atom.id);
        if(atom.tieIn&&range)marks.push({type:'tied',start:range.last,end:id});
        ends.set(atom.id,{first:range?.first??id,last:id});
      }
      if(!atom.part){
        if(vocal.dynamic)directions.push({type:'dynamics',text:vocal.dynamic,afterElements:elements.length});
        if(vocal.text)directions.push({type:'words',text:vocal.text,afterElements:elements.length});
      }
      if(atom.key!==previousKey){chord.sectionWord='1='+KEYS[atom.key];previousKey=atom.key;}
      elements.push(chord);
    }
    return {number:String(prepared.settings.pickup?bar.index:bar.index+1),attrs:{divisions:48,key:keyOf(bar.atoms[0].key)},elements,directions,...(bar.index&&bar.index%prepared.settings.barsPerRow===0?{print:{newSystem:true}}:{})};
  });
  for(const s of p.vocalSlurs||[]){const a=ends.get(s.start),b=ends.get(s.end);if(a&&b)marks.push({type:'slur',start:a.first,end:b.last});}
  const [beats,beatType]=p.meter.split('/').map(Number);
  const doc={sourceFormat:'123',diagnostics:[],songs:[{work:{title:p.title,subtitles:[]},key:keyOf(p.key),time:{beats,beatType},tempos:[p.bpm],parts:[{id:'melody',measures}],marks}]};
  return {doc,owners,cells};
}

let engineReady;
async function engine(){
  if(!engineReady)engineReady=(async()=>{
    const mod=await import('./vendor/dolce.js');
    const response=await fetch('./vendor/bravura_metadata.json');
    if(!response.ok)throw Error('无法读取内置简谱字体数据');
    mod.MetaData.provide(mod.MetaData.fromJson(await response.json()));
    mod.setMeasureBackend(mod.browserMeasure);
    await document.fonts.load('16px Bravura');
    return mod;
  })().catch(error=>{engineReady=null;throw error;});
  return engineReady;
}
export async function renderDolceScore(prepared){
  const mod=await engine(),{doc,owners,cells}=dolceDocument(prepared),style=mod.defaultJianpuStyle(prepared.settings.fontSize*.73);
  style.header.title.size=24;style.header.subtitle.size=16;style.header.credit.size=12;
  style.size.sectionWord=12;
  const margin=prepared.settings.margin*72/25.4;
  style.page.margin={top:margin,right:margin,bottom:margin,left:margin};
  const layout=mod.layoutJianpu(doc,{style,page:{width:595.28,height:841.89,continuous:false},userMargins:true,foot:null});
  const pages=layout.pages.map(page=>{
    const nodeMap=new WeakMap(),svg=mod.renderPageSvg(page,layout.width,layout.height,nodeMap);
    svg.setAttribute('role','img');svg.setAttribute('aria-label',prepared.project.title);
    const walk=(item,host=null)=>{
      const identity=item.ident,cell=cells.get(identity?.id),id=owners.get(identity?.id),g=nodeMap.get(item);
      if(identity?.kind==='note')host=cell;
      if(g&&cell&&['note','sustain','syllable'].includes(identity.kind)){
        if(id)g.dataset.scoreNote=id;
        g.dataset.scoreKind=identity.kind;
        g.dataset.scoreBeat=String(cell.beat);g.dataset.scoreEnd=String(cell.end);
        g.dataset.scoreCell=String(identity.id);
        // Vocal glyph fonts can have tall line boxes. Keep them out of note hit areas.
        const excluded=new Set(item.children.filter(child=>['deco','annotation'].includes(child.ident?.kind)).map(child=>nodeMap.get(child)));
        const parts=[...g.children].filter(child=>!excluded.has(child));
        const inverse=g.getScreenCTM().inverse(),svg=g.ownerSVGElement;
        const points=parts.flatMap(child=>{
          const r=child.getBoundingClientRect();
          return [[r.left,r.top],[r.right,r.bottom]].map(([x,y])=>{const p=svg.createSVGPoint();p.x=x;p.y=y;return p.matrixTransform(inverse);});
        });
        const vertical=identity.kind==='note'?points.slice(0,2):points;
        const box=points.length?{x:Math.min(...points.map(p=>p.x)),y:Math.min(...vertical.map(p=>p.y)),
          width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...vertical.map(p=>p.y))-Math.min(...vertical.map(p=>p.y))}:g.getBBox();
        const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x',String(box.x-4));rect.setAttribute('y',String(box.y-4));
        rect.setAttribute('width',String(Math.max(10,box.width)+8));rect.setAttribute('height',String(Math.max(12,box.height)+8));
        rect.setAttribute('fill','transparent');rect.classList.add('preview-note-hit');g.prepend(rect);
      }
      if(g&&identity?.kind==='slur'&&id&&owners.get(identity.end)){
        const candidates=doc.songs[0].marks.filter(m=>m.type==='slur'&&m.start<=identity.id&&m.end>=identity.end);
        const mark=candidates.find(m=>m.start===identity.id&&m.end===identity.end)||candidates.sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
        if(mark){
          g.dataset.scoreKind='slur';g.dataset.scoreSlurStart=owners.get(mark.start);g.dataset.scoreSlurEnd=owners.get(mark.end);
          for(const path of [...g.querySelectorAll('path')]){
            const hit=path.cloneNode(false);hit.classList.add('preview-curve-hit');hit.setAttribute('fill','none');hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width','10');hit.style.pointerEvents='stroke';path.parentNode.append(hit);
          }
        }
      }
      if(g&&host?.id&&['deco','annotation','aug-dot'].includes(identity?.kind)){
        g.dataset.scoreNote=host.id;g.dataset.scoreKind=identity.kind;
      }
      for(const child of item.children)walk(child,host);
    };
    // getBBox requires an attached SVG. The caller adds hit areas after mounting.
    return {svg,mount:()=>walk(page)};
  });
  return {pages,width:layout.width,height:layout.height};
}

export async function scoreExport(result){
  const response=await fetch('./vendor/Bravura.woff2');if(!response.ok)throw Error('无法读取内置简谱字体');
  const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const font=`@font-face{font-family:Bravura;src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2')}`;
  const pages=result.pages.map(({svg})=>{const copy=svg.cloneNode(true);copy.querySelectorAll('.preview-note-hit,.preview-curve-hit,.preview-caret,.preview-slur-handle').forEach(n=>n.remove());copy.querySelectorAll('*').forEach(n=>{n.classList.remove('preview-selected','preview-drop-target','preview-mark-selected');for(const a of [...n.attributes])if(a.name.startsWith('data-score-'))n.removeAttribute(a.name);});return copy.outerHTML;});
  return {font,pages,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${result.width}" height="${result.height*pages.length}" viewBox="0 0 ${result.width} ${result.height*pages.length}"><defs><style>${font}</style></defs>${pages.map((svg,i)=>svg.replace('<svg ',`<svg y="${i*result.height}" `)).join('')}</svg>`};
}
