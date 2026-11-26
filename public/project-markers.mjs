import {beatAtTime,timeAtBeat} from './time-map.mjs';

export const MARKER_NAME_LIMIT=80;
export const markerName=value=>typeof value==='string'?value.trim().slice(0,MARKER_NAME_LIMIT):'';

export function normalizeMarkers(value){
  const seen=new Set(),markers=[];
  if(!Array.isArray(value))return markers;
  for(const marker of value){
    if(!marker||typeof marker.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(marker.id)||seen.has(marker.id))continue;
    const {id,anchor,position}=marker;
    if(!Number.isFinite(position)||position<0||(anchor==='score'?position>14400:anchor!=='audio'))continue;
    markers.push({id,anchor,position,name:markerName(marker.name)});
    seen.add(id);
  }
  return markers;
}

export function markerPoint(project,marker){
  const offset=project.offset??0;
  const audioSecond=marker.anchor==='audio'?marker.position:timeAtBeat(project,marker.position);
  const beat=marker.anchor==='score'?marker.position:beatAtTime(project,audioSecond);
  return {audioSecond,beat,second:audioSecond-offset};
}

export function captureMarker(project,anchor,second){
  const audioSecond=second+(project.offset??0);
  let position=anchor==='audio'?audioSecond:beatAtTime(project,audioSecond);
  if(Math.abs(position)<1e-8)position=0;
  return Number.isFinite(position)&&position>=0&&(anchor==='audio'||position<=14400)?position:null;
}

export function markerLoopRange(points,a,b,bounds){
  const first=points.find(point=>point.id===a),last=points.find(point=>point.id===b);
  if(!first||!last)return {error:'missing'};
  const start=Math.min(first.second,last.second),end=Math.max(first.second,last.second);
  if(end-start<=1e-6)return {error:'same'};
  if(!bounds||start<bounds.start-1e-8||end>bounds.end+1e-8)return {error:'outside'};
  return {start:Math.max(start,bounds.start),end:Math.min(end,bounds.end)};
}
