import {Accidental,Annotation,Articulation,BarlineType,Beam,Dot,Formatter,ModifierPosition,Renderer,Stave,StaveNote,StaveTie,VexFlow,Voice} from './vendor/vexflow.js';
import {STAFF_KEYS,staffPitchName} from './staff-score.mjs';

const namespace='http://www.w3.org/2000/svg';
const durations=new Map([[4,'w'],[2,'h'],[1,'q'],[.5,'8'],[.25,'16'],[.125,'32'],[.0625,'64']]);
const lyricFont='Arial, "Microsoft YaHei", sans-serif';
export const staffFontCSS="@font-face{font-family:Bravura;src:url('/vendor/Bravura.woff2') format('woff2');font-display:block}";
let fontReady;
function loadFont(){
  VexFlow.setFonts('Bravura');
  return fontReady??=document.fonts.load('32px Bravura','\uE050').then(fonts=>{
    if(!fonts.length)throw Error('Bravura');
  }).catch(error=>{fontReady=null;throw error;});
}
function svgElement(tag,attrs={},value){
  const element=document.createElementNS(namespace,tag);
  for(const [key,attribute] of Object.entries(attrs))element.setAttribute(key,attribute);
  if(value!==undefined)element.textContent=value;
  return element;
}
function text(svg,x,y,value,attrs={}){
  svg.append(svgElement('text',{x,y,'font-family':lyricFont,'font-size':13,'text-anchor':'middle',...attrs},value));
}
function vocalText(atom){
  if(atom.part)return '';
  return [atom.vocal?.dynamic,atom.vocal?.text].filter(Boolean).join('  ');
}
function splitRows(score,width,measureText){
  const rows=[];
  let row=[],used=0;
  function add(chunk){
    if(row.length&&used+chunk.width>width){rows.push(row);row=[];used=0;}
    if(!row.length)chunk.width+=100;
    row.push(chunk);used+=chunk.width;
  }
  let lastKey=null;
  for(const bar of score.bars){
    let chunk=null;
    for(const [i,atom] of bar.atoms.entries()){
      const words=[atom.printLyric,vocalText(atom)].sort((a,b)=>measureText(b)-measureText(a));
      const wordWidth=Math.min(width-255,measureText(words[0]));
      const atomWidth=Math.max(32,wordWidth+16)+(atom.accidental===null?0:11);
      const groupBreak=i>0&&bar.atoms[i-1].beams?.[0]!=='begin'&&
        bar.atoms[i-1].beams?.[0]!=='continue';
      if(!chunk||chunk.key!==atom.key||chunk.width+atomWidth>width-100||
         (groupBreak&&chunk.width>width*.73)){
        if(chunk)add(chunk);
        const change=lastKey!==null&&lastKey!==atom.key;
        chunk={bar,key:atom.key,end:false,width:change?115:26,atoms:[]};
      }
      chunk.width+=atomWidth;
      chunk.atoms.push({atom,label:words[0],wordWidth});
      lastKey=atom.key;
    }
    chunk.end=true;
    add(chunk);
  }
  if(row.length)rows.push(row);
  return rows;
}
function noteFor({atom,label,wordWidth},clef){
  const duration=durations.get(atom.base)+(atom.midi===null?'r':'');
  const pitch=atom.pitch;
  const rest=clef==='bass'?(atom.base===4?'f/3':'d/3'):(atom.base===4?'d/5':'b/4');
  const note=new StaveNote({keys:[pitch?pitch.step.toLowerCase()+'/'+pitch.octave:rest],duration,durationOverride:{numerator:atom.duration,denominator:4},clef,autoStem:true,
    alignCenter:atom.measureRest});
  if(atom.accidental!==null)note.addModifier(new Accidental(['b','n','#'][atom.accidental+1]),0);
  if(atom.dotted)Dot.buildAndAttach([note],{all:true});
  if(!atom.part&&atom.vocal?.accent)note.addModifier(new Articulation('a>').setPosition(ModifierPosition.ABOVE),0);
  if(!atom.tieOut&&atom.vocal?.fermata)note.addModifier(new Articulation('a@').setPosition(ModifierPosition.ABOVE),0);
  // Reserve room even though the actual text sits on a shared baseline.
  if(label){
    const spacing=new Annotation(label).setFont(lyricFont,13);
    spacing.setWidth(wordWidth);
    spacing.draw=()=>{};
    note.addModifier(spacing,0);
  }
  return note;
}
function beamNotes(items){
  const beams=[];
  let notes=[];
  function flush(){if(notes.length>1)beams.push(new Beam(notes,true));notes=[];}
  for(const {atom,note} of items){
    const beam=atom.beams?.[0];
    if(!beam||beam==='begin')flush();
    if(beam)notes.push(note);
    if(beam==='end')flush();
  }
  flush();
  return beams;
}
function drawSlur(context,items,span){
  const from=items.find(item=>item.atom.id===span.start&&item.atom.part===0);
  const to=items.find(item=>item.atom.id===span.end&&!item.atom.tieOut);
  const first=items[0].note.checkStave(),last=items.at(-1).note.checkStave();
  const left=from?from.note.getNoteHeadBeginX():first.getNoteStartX(),right=to?to.note.getNoteHeadEndX():last.getNoteEndX();
  const top=first.getYForLine(0);
  const anchor=item=>{
    if(!item)return top-10;
    const note=item.note,y=Math.min(top-5,note.getYs()[0]-9);
    return note.hasStem()?Math.min(y,note.getStemExtents().topY-5):y;
  };
  const y0=Math.max(12,anchor(from)),y1=Math.max(12,anchor(to)),spanWidth=right-left;
  const roof=Math.max(3,Math.min(y0,y1)-Math.min(21,spanWidth*.16));
  context.beginPath();
  context.moveTo(left,y0);
  context.bezierCurveTo(left+spanWidth*.23,roof,right-spanWidth*.23,roof,right,y1);
  context.stroke();
}

export async function renderStaffScore(score,width,{interactive=false}={}){
  await loadFont();
  const canvas=document.createElement('canvas').getContext('2d');
  canvas.font='13px '+lyricFont;
  const rows=splitRows(score,width-28,value=>canvas.measureText(value).width);
  const positions=new Map();
  const noteRanges=new Map();
  for(const bar of score.bars)for(const atom of bar.atoms)if(atom.id){
    const range=noteRanges.get(atom.id)??{start:atom.start,end:0};
    range.end=atom.start+atom.duration;
    noteRanges.set(atom.id,range);
  }
  const slurs=(score.project.vocalSlurs||[]).flatMap(span=>{
    const start=noteRanges.get(span.start),end=noteRanges.get(span.end);
    return start&&end?[{...span,from:start.start,to:end.end}]:[];
  });
  let lastKey=null;
  const systems=rows.map((row,rowIndex)=>{
    const host=document.createElement('div');
    const above=Math.max(36,...row.flatMap(c=>c.atoms.map(({atom})=>{
      const p=atom.pitch;if(!p)return 0;
      const step=p.octave*7+'CDEFGAB'.indexOf(p.step),top=score.clef==='bass'?26:38;
      return 36+Math.max(0,step-top)*5;
    })));
    const below=Math.max(28,...row.flatMap(c=>c.atoms.map(({atom})=>{
      const p=atom.pitch;if(!p)return 0;
      const step=p.octave*7+'CDEFGAB'.indexOf(p.step),bottom=score.clef==='bass'?18:30;
      return 28+Math.max(0,bottom-step)*5;
    })));
    const hasLyrics=row.some(c=>c.atoms.some(({atom})=>atom.printLyric));
    const height=above+40+below+(hasLyrics?24:5);
    const renderer=new Renderer(host,Renderer.Backends.SVG);
    renderer.resize(width,height);
    const context=renderer.getContext(),svg=host.firstElementChild;
    svg.setAttribute('viewBox','0 0 '+width+' '+height);
    svg.classList.add('staff-system');
    const extra=(width-28-row.reduce((sum,chunk)=>sum+chunk.width,0))/row.length;
    const items=[];
    let x=14;
    for(const [index,chunk] of row.entries()){
      const chunkWidth=chunk.width+extra;
      const stave=new Stave(x,above-40,chunkWidth,{spaceAboveStaffLn:4})
        .setBegBarType(BarlineType.NONE)
        .setEndBarType(chunk.end?(chunk.bar.index===score.bars.length-1?BarlineType.END:BarlineType.SINGLE):BarlineType.NONE);
      if(index===0)stave.addClef(score.clef);
      if(index===0||chunk.key!==lastKey)stave.addKeySignature(STAFF_KEYS[chunk.key],lastKey!==null&&lastKey!==chunk.key?STAFF_KEYS[lastKey]:undefined);
      if(rowIndex===0&&index===0)stave.addTimeSignature(score.project.meter);
      lastKey=chunk.key;
      stave.setContext(context).draw();
      if(index===0)text(svg,x+2,stave.getYForLine(0)-12,chunk.bar.index+(score.settings.pickup?0:1),{'font-size':10,'text-anchor':'start'});
      const entries=chunk.atoms.map(item=>({...item,note:noteFor(item,score.clef).setStave(stave).setContext(context)}));
      const beats=entries.reduce((sum,e)=>sum+e.atom.duration,0);
      const voice=new Voice({numBeats:beats,beatValue:4}).setMode(Voice.Mode.SOFT).addTickables(entries.map(e=>e.note));
      const beams=beamNotes(entries);
      new Formatter().joinVoices([voice]).formatToStave([voice],stave,{context});
      voice.draw(context,stave);
      for(const beam of beams)beam.setContext(context).draw();
      items.push(...entries);
      x+=chunkWidth;
    }
    for(const [index,{atom,note,wordWidth}] of items.entries()){
      const before=items[index-1],after=items[index+1];
      if(atom.tieIn&&index===0)new StaveTie({lastNote:note}).setContext(context).draw();
      if(atom.tieOut)new StaveTie({firstNote:note,lastNote:after?.note}).setContext(context).draw();
      const cx=(note.getNoteHeadBeginX()+note.getNoteHeadEndX())/2,y=note.getYs()[0];
      const fit=value=>canvas.measureText(value).width>wordWidth?{textLength:wordWidth,lengthAdjust:'spacingAndGlyphs'}:{};
      if(atom.printLyric)text(svg,cx,above+40+below+13,atom.printLyric,fit(atom.printLyric));
      if(vocalText(atom))text(svg,cx,Math.max(12,Math.min(above-21,y-29)),vocalText(atom),{'font-style':'italic',...fit(vocalText(atom))});
      if(atom.vocal?.breath&&!atom.tieOut)text(svg,cx+14,Math.min(above-7,y-14),'’',{'font-size':22});
      if(!interactive)continue;
      const position={atom,x:cx,system:rowIndex,staveEnd:note.checkStave().getNoteEndX()};
      if(atom.midi!==null){
        const left=Math.max(0,cx-11,before?(cx+before.note.getAbsoluteX())/2:0);
        const right=Math.min(cx+11,after?(cx+after.note.getAbsoluteX())/2:width);
        const target=svgElement('rect',{x:left,y:y-11,width:Math.max(8,right-left),height:22,rx:4,class:'staff-hit',
          tabindex:0,role:'button','aria-label':staffPitchName(atom.pitch),'data-staff-note':atom.id,'data-staff-start':atom.start});
        position.target=target;
        svg.append(target);
      }
      positions.set(atom.start,position);
    }
    const from=items[0].atom.start,last=items.at(-1).atom,to=last.start+last.duration;
    for(const slur of slurs)if(slur.from<to&&slur.to>from)drawSlur(context,items,slur);
    const cursor=svgElement('line',{y1:10,y2:height-8,class:'staff-cursor',visibility:'hidden','aria-hidden':'true'});
    if(interactive)svg.append(cursor);
    return {svg,cursor};
  });
  return {systems,positions:[...positions.values()]};
}
