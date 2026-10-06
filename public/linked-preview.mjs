import {escapeXML,numberPitch,keyAt} from './music.mjs';
import {lyricRows} from './lyric-score.mjs';
// Draw only the linked group as a pointer-transparent ghost. Font sizes stay fixed.
export function linkedPreviewSVG(project,group,{starts,ys,left,zoom,flats=false}){
  let html='';
  const draw=(from,to,caption,lyric=false,lane=0,onlyRow=null)=>{
    for(let i=0;i<starts.length-1;i++){
      if(onlyRow!==null&&i!==onlyRow)continue;
      const a=Math.max(from,starts[i]),b=Math.min(to,starts[i+1]);if(b<=a)continue;
      const x=left+(a-starts[i])*zoom,w=Math.max(2,(b-a)*zoom-2),y=ys[i]+(lyric?28+lane*24:-15),h=lyric?20:38;
      html+=`<rect x="${x+1}" y="${y}" width="${w}" height="${h}" rx="4" fill="${lyric?'#e2edf4':'#b3dfc8'}" stroke="#287b5b"/>`;
      if(w>Math.max(18,Array.from(caption).length*(lyric?11:15)+6))html+=`<text x="${x+(w+2)/2}" y="${y+(lyric?14:26)}" text-anchor="middle" font-size="${lyric?11:20}" fill="#324b3b">${escapeXML(caption)}</text>`;
      else html+=`<path d="M${x+w/2} ${y+7}v${h-14}" stroke="#324b3b"/>`;
    }
  };
  for(const n of project.notes)if(group.noteIds.has(n.id)){const p=numberPitch(n.midi,keyAt(project,n.start),flats);draw(n.start,n.start+n.duration,p.accidental+p.digit+(p.octave>0?'̇'.repeat(p.octave):'̣'.repeat(-p.octave)));}
  for(const [row,r] of lyricRows(project,starts).entries())for(const t of r.segments)if(group.lyricIds.has(t.id))draw(t.from,t.to,t.text,true,t.lane,row);
  return html;
}
