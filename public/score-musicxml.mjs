import {engravingBars} from './engraving.mjs';
import {escapeXML,KEYS} from './music.mjs';
import {STAFF_FIFTHS} from './staff-score.mjs';

const DIVISIONS=48;
const fifths=[0,-5,2,-3,4,-1,-6,1,-4,3,-2,5];
const types=new Map([[4,'whole'],[2,'half'],[1,'quarter'],[.5,'eighth'],[.25,'16th'],[.125,'32nd'],[.0625,'64th']]);
const dynamics=new Set(['ppp','pp','p','mp','mf','f','ff','fff']);
const text=value=>escapeXML(String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,''));

function pitchXML(midi,flats){
  const steps=flats?['C','D','D','E','E','F','G','G','A','A','B','B']:['C','C','D','D','E','F','F','G','G','A','A','B'];
  const alterations=flats?[0,-1,0,-1,0,0,-1,0,-1,0,-1,0]:[0,1,0,1,0,0,1,0,1,0,1,0];
  const index=midi%12,alter=alterations[index];
  return `<pitch><step>${steps[index]}</step>${alter?`<alter>${alter}</alter>`:''}<octave>${Math.floor(midi/12)-1}</octave></pitch>`;
}

function slurEvents(atoms,slurs){
  const ranges=new Map(),events=new Map();
  atoms.forEach((atom,index)=>{
    if(!atom.id)return;
    const range=ranges.get(atom.id)||{first:index,last:index};
    range.last=index;ranges.set(atom.id,range);
  });
  const spans=slurs.flatMap(slur=>{
    const start=ranges.get(slur.start)?.first,end=ranges.get(slur.end)?.last;
    return start!==undefined&&end>start?[{start,end}]:[];
  }).sort((a,b)=>a.start-b.start||a.end-b.end);
  const active=[];
  for(const span of spans){
    // Stops at this note can share a number with a new slur starting here.
    for(let i=active.length-1;i>=0;i--)if(active[i].end<=span.start)active.splice(i,1);
    const number=Array.from({length:16},(_,i)=>i+1).find(n=>!active.some(s=>s.number===n));
    if(!number)throw Error('同时交叠的连音线超过 MusicXML 支持范围，请先减少交叠。');
    active.push({...span,number});
    for(const [index,type]of [[span.start,'start'],[span.end,'stop']]){
      const list=events.get(index)||[];list.push({number,type});events.set(index,list);
    }
  }
  return events;
}

// Serialize the same presentation copy as the preview, retaining absolute pitches.
// No source notes, lyric associations or time anchors are changed.
export function scoreMusicXML(prepared){
  const staff=Boolean(prepared.clef),bars=staff?prepared.bars:engravingBars(prepared),project=prepared.project;
  const bass=prepared.clef==='bass';
  const atoms=bars.flatMap(bar=>bar.atoms),slurs=slurEvents(atoms,project.vocalSlurs||[]);
  const [beats,beatType]=project.meter.split('/').map(Number);
  let previousKey=null,index=0;
  const measures=bars.map((bar,barIndex)=>{
    const contents=[];
    for(const atom of bar.atoms){
      const first=index===0,vocal=atom.vocal||{};
      if(first||atom.key!==previousKey){
        contents.push(`<attributes>${first?`<divisions>${DIVISIONS}</divisions>`:''}<key><fifths>${(staff?STAFF_FIFTHS:fifths)[atom.key]}</fifths>${staff?'':'<mode>major</mode>'}</key>${first?`<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>${bass?'F':'G'}</sign><line>${bass?4:2}</line></clef>`:''}</attributes>`);
        previousKey=atom.key;
      }
      if(first)contents.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${project.bpm}</per-minute></metronome></direction-type><sound tempo="${project.bpm}"/></direction>`);
      if(!atom.part){
        if(dynamics.has(vocal.dynamic))contents.push(`<direction placement="below"><direction-type><dynamics><${vocal.dynamic}/></dynamics></direction-type></direction>`);
        if(vocal.text)contents.push(`<direction placement="above"><direction-type><words>${text(vocal.text)}</words></direction-type></direction>`);
      }
      const dotted=staff?atom.dotted:[.1875,.375,.75,1.5,3].includes(atom.duration),base=staff?atom.base:dotted?atom.duration/1.5:atom.duration;
      const ties=atom.midi===null?[]:[...(atom.tieIn?['stop']:[]),...(atom.tieOut?['start']:[])];
      const notations=ties.map(type=>`<tied type="${type}"/>`);
      for(const slur of (slurs.get(index)||[]).sort((a,b)=>Number(b.type==='stop')-Number(a.type==='stop'))){
        notations.push(`<slur type="${slur.type}" number="${slur.number}"/>`);
      }
      if(!atom.tieOut&&vocal.fermata)notations.push('<fermata/>');
      const articulations=[...(!atom.part&&vocal.accent?['<accent/>']:[]),...(!atom.tieOut&&vocal.breath?['<breath-mark/>']:[])];
      if(articulations.length)notations.push(`<articulations>${articulations.join('')}</articulations>`);
      const lyric=prepared.settings.lyrics&&atom.printLyric?`<lyric number="1"><text>${text(atom.printLyric)}</text></lyric>`:'';
      const pitch=atom.midi===null?(atom.measureRest?'<rest measure="yes"/>':'<rest/>'):staff
        ?`<pitch><step>${atom.pitch.step}</step><alter>${atom.pitch.alter}</alter><octave>${atom.pitch.octave}</octave></pitch>`
        :pitchXML(atom.midi,prepared.settings.flats||KEYS[atom.key].includes('♭'));
      const accidental=staff&&atom.accidental!==null?`<accidental>${['flat','natural','sharp'][atom.accidental+1]}</accidental>`:'';
      const beams=staff&&atom.beams?atom.beams.map((beam,i)=>`<beam number="${i+1}">${beam}</beam>`).join(''):'';
      contents.push(`<note>${pitch}<duration>${Math.round(atom.duration*DIVISIONS)}</duration>${ties.map(type=>`<tie type="${type}"/>`).join('')}<voice>1</voice>${atom.measureRest?'':`<type>${types.get(base)}</type>`}${dotted?'<dot/>':''}${accidental}${beams}${notations.length?`<notations>${notations.join('')}</notations>`:''}${lyric}</note>`);
      index++;
    }
    return `<measure number="${prepared.settings.pickup?barIndex:barIndex+1}"${barIndex===0&&prepared.settings.pickup?' implicit="yes"':''}>${contents.join('')}</measure>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<score-partwise version="4.0"><work><work-title>${text(project.title)}</work-title></work><identification><encoding><software>NoteMender</software></encoding></identification><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>\n`;
}
