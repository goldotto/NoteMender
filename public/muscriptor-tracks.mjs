import {tr} from './i18n.mjs';
import {EDIT_STEP, snap, uid} from './music.mjs';
import {beatAtTime} from './time-map.mjs';
import {muSourceMelody} from './muscriptor-pipeline.mjs';
import {linkRawLyrics, lyricsAfterQuantization} from './lyric-assist.mjs';

// MuScriptor's published instrument order and hue spacing keep known colors stable.
// https://github.com/muscriptor/muscriptor/blob/main/web/src/pianoroll.ts
const instruments={
  acoustic_piano:()=>tr('原声钢琴','Acoustic piano'),
  electric_piano:()=>tr('电钢琴','Electric piano'),
  chromatic_percussion:()=>tr('有音高打击乐','Pitched percussion'),
  organ:()=>tr('风琴','Organ'),
  acoustic_guitar:()=>tr('原声吉他','Acoustic guitar'),
  clean_electric_guitar:()=>tr('清音电吉他','Clean electric guitar'),
  distorted_electric_guitar:()=>tr('失真电吉他','Distorted electric guitar'),
  acoustic_bass:()=>tr('原声贝斯','Acoustic bass'),
  electric_bass:()=>tr('电贝斯','Electric bass'),
  violin:()=>tr('小提琴','Violin'),
  viola:()=>tr('中提琴','Viola'),
  cello:()=>tr('大提琴','Cello'),
  contrabass:()=>tr('低音提琴','Double bass'),
  orchestral_harp:()=>tr('竖琴','Orchestral harp'),
  timpani:()=>tr('定音鼓','Timpani'),
  string_ensemble:()=>tr('弦乐合奏','String ensemble'),
  synth_strings:()=>tr('合成弦乐','Synth strings'),
  voice:()=>tr('人声','Voice'),
  orchestra_hit:()=>tr('管弦齐奏','Orchestra hit'),
  trumpet:()=>tr('小号','Trumpet'),
  trombone:()=>tr('长号','Trombone'),
  tuba:()=>tr('大号','Tuba'),
  french_horn:()=>tr('圆号','French horn'),
  brass_section:()=>tr('铜管合奏','Brass section'),
  soprano_and_alto_sax:()=>tr('高音／中音萨克斯','Soprano / alto sax'),
  tenor_sax:()=>tr('次中音萨克斯','Tenor sax'),
  baritone_sax:()=>tr('上低音萨克斯','Baritone sax'),
  oboe:()=>tr('双簧管','Oboe'),
  english_horn:()=>tr('英国管','English horn'),
  bassoon:()=>tr('巴松','Bassoon'),
  clarinet:()=>tr('单簧管','Clarinet'),
  flutes:()=>tr('笛类','Flutes'),
  synth_lead:()=>tr('合成主奏','Synth lead'),
  synth_pad:()=>tr('合成铺底','Synth pad'),
  drums:()=>tr('鼓组','Drum kit'),
};
export const muInstruments=Object.keys(instruments);
const instrumentPositions=new Map(muInstruments.map((name,index)=>[name,index]));

export function muInstrumentColor(name){
  const index=instrumentPositions.get(name)??Array.from(name).reduce((hash,c)=>(Math.imul(hash,31)+c.charCodeAt(0))>>>0,0);
  return 'hsl('+((index*137.508)%360)+', 70%, 55%)';
}
export function muInstrumentLabel(name){
  if(name==='piano')return tr('钢琴','Piano');
  if(name==='strings')return tr('弦乐','Strings');
  return Object.hasOwn(instruments,name)?instruments[name]():name.replaceAll('_',' ');
}

export const MU_TRACK_MODEL = 'muscriptor-instrument-track';
export const isMuTrackCandidate = candidate => candidate?.model === MU_TRACK_MODEL;

export const muRollEditKey = (section, range, analysis) => JSON.stringify([section.id,range.from,range.to,analysis.key]);

export function muTrackAnalyses(variants, preferred) {
  const unique = new Map();
  for (const candidate of variants) {
    const origin = candidate.analysisStart ?? candidate.audioStart;
    const end = candidate.analysisEnd ?? candidate.audioEnd;
    if (!/^[a-f0-9]{64}$/.test(candidate.analysisId || '') ||
        !Number.isFinite(origin) || !Number.isFinite(end) || origin < 0 || end <= origin) continue;
    const key = JSON.stringify([candidate.analysisId, origin, end, candidate.source, candidate.resourceId || '', candidate.inputModel || '']);
    if (!unique.has(key) || candidate.id === preferred) unique.set(key, {key, origin, end, candidate});
  }
  return [...unique.values()];
}

export function muTrackWindow(result, origin, range, analysisId = result.analysisId) {
  if (!Array.isArray(result.notes) || !Number.isFinite(result.duration) || result.duration <= 0) throw Error(tr('原始结果无效。','The original analysis result is invalid.'));
  const from = Math.max(origin, range.from), to = Math.min(origin + result.duration, range.to);
  const tracks = new Map();
  if (to <= from) return {from, to, tracks};
  for (const note of result.notes) {
    if (!note || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127 ||
        !Number.isFinite(note.start) || !Number.isFinite(note.end) || note.end <= note.start ||
        typeof note.instrument !== 'string' || typeof note.id !== 'string') continue;
    const start = Math.max(from, origin + note.start), end = Math.min(to, origin + note.end);
    if (end <= start) continue;
    if (!tracks.has(note.instrument)) tracks.set(note.instrument, []);
    tracks.get(note.instrument).push({...note, start, end, evidenceId: analysisId + ':' + note.id});
  }
  for (const notes of tracks.values()) notes.sort((a,b) => a.start-b.start);
  return {from, to, tracks};
}

export function scoreMuInstrument(window, instrument, base, words = [], pitchFrames = []) {
  const raw = instrument === 'drums' ? [] : window.tracks.get(instrument) || [];
  const sectionStart = Math.max(0, snap(beatAtTime(base, window.from), EDIT_STEP));
  const sectionEnd = Math.min(14400, snap(beatAtTime(base, window.to), EDIT_STEP));
  const byPitch = new Map(), playable = [], stats = {polyphony:0, collision:0, pitch:0};
  for (const note of raw) {
    if (note.midi < 21 || note.midi > 108) {stats.pitch++; continue;}
    const prior = byPitch.get(note.midi);
    // A new attack of the same pitch ends the old hold. Exact unisons
    // remain separate in the roll and compete for a single score onset.
    if (prior && prior.start < note.start && prior.end > note.start) prior.end = note.start;
    const attack = {...note};
    byPitch.set(note.midi, attack);
    playable.push(attack);
  }
  let concurrentUntil=-Infinity;
  const overlaps=playable.some(note=>{
    if(note.start<concurrentUntil-1e-7)return true;
    concurrentUntil=Math.max(concurrentUntil,note.end);
    return false;
  });
  const melody=overlaps?muSourceMelody(playable,'continuous',instrument==='voice'?pitchFrames:[]):playable;
  stats.polyphony = playable.length - new Set(melody.map(note => note.evidenceId)).size;
  const notes = [], trace = [], collisions = new Set();
  for (const note of melody) {
    const start = Math.max(sectionStart, snap(beatAtTime(base, note.start), EDIT_STEP));
    const end = Math.min(sectionEnd, Math.max(start + EDIT_STEP, snap(beatAtTime(base, note.end), EDIT_STEP)));
    if (end <= start) {collisions.add(note.evidenceId); continue;}
    const previous = notes.at(-1);
    if (previous && previous.start >= start) {collisions.add(note.evidenceId); continue;}
    if (previous && previous.start + previous.duration > start) previous.duration = start - previous.start;
    for (let beat = start; beat < end; beat += 128) {
      const id = uid();
      notes.push({id, start:beat, duration:Math.min(128,end-beat), midi:note.midi, confidence:.5, muEvent:note.evidenceId});
      trace.push({evidenceId:note.evidenceId,noteId:id});
    }
  }
  const retained = new Set(trace.map(row => row.evidenceId));
  stats.collision = [...collisions].filter(id => !retained.has(id)).length;
  return {notes, lyrics:lyricsAfterQuantization(linkRawLyrics(melody,words),trace,notes), stats};
}

export function audibleMuTracks(tracks, solo, muted) {
  return [...tracks].filter(([name]) => solo ? name === solo : !muted.has(name)).flatMap(([,notes]) => notes);
}


const editId = /^[a-zA-Z0-9_-]{1,80}$/;
export function normalizeMuRollEdits(value) {
  const edits = new Map();
  for (const pair of Array.isArray(value) ? value : []) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !editId.test(pair[0])) continue;
    const [id, note] = pair;
    if (note === null) {edits.set(id, null); continue;}
    if (!note || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127 ||
        !Number.isFinite(note.start) || !Number.isFinite(note.end) || note.end <= note.start ||
        typeof note.instrument !== 'string' || !editId.test(note.instrument)) continue;
    edits.set(id, {start:note.start,end:note.end,midi:note.midi,instrument:note.instrument,added:note.added===true});
  }
  return edits;
}

export function applyMuRollEdits(window, analysisId, edits) {
  if (!edits.size) return window;
  const tracks = new Map([...window.tracks].map(([instrument]) => [instrument, []]));
  const append = note => {
    const start = Math.max(window.from,note.start), end = Math.min(window.to,note.end);
    if (end <= start) return;
    if (!tracks.has(note.instrument)) tracks.set(note.instrument,[]);
    tracks.get(note.instrument).push({...note,start,end});
  };
  for (const notes of window.tracks.values()) for (const note of notes) {
    if (!edits.has(note.id)) append(note);
    else {
      const patch = edits.get(note.id);
      if (patch) {
        const {added,...change}=patch;
        append(added ? note : {...note,...change});
      }
    }
  }
  for (const [id,note] of edits) {
    if (note?.added && id.startsWith('edit_')) append({...note,id,evidenceId:analysisId+':'+id,velocity:80});
  }
  for (const [instrument,notes] of tracks) {
    if (!notes.length) tracks.delete(instrument);
    else notes.sort((a,b) => a.start-b.start);
  }
  return {...window,tracks};
}
