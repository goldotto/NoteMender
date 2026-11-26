import {audioPitchEvidence, PITCH_HOP} from './muscriptor-pitch-evidence.mjs';

const WINDOW = 5;
const MAX_REPAIR = 20;
const CONTEXT = 3;
const ONSET_TOLERANCE = .08;
const isDrums = note => note.instrument === 'drums';
const isBass = note => /(?:^|_)bass(?:_|$)/i.test(note.instrument);
const isMelodic = note => !isDrums(note) && !isBass(note);
const rounded = value => Math.round(value * 1000) / 1000;

function validatedNotes(notes, duration, onsetOnly = false) {
  if (!Array.isArray(notes) || notes.length > 150000) throw Error('无效的 MuScriptor 音符列表');
  for (const note of notes) {
    if (!note || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127 ||
        !Number.isFinite(note.start) || note.start < 0 || note.start > duration + .05 ||
        (!onsetOnly && (!Number.isFinite(note.end) || note.end <= note.start || note.end > duration + .05)) ||
        typeof note.instrument !== 'string' || !note.instrument || note.instrument.length > 80) {
      throw Error('MuScriptor 音符的时间、音高或乐器字段不合法');
    }
  }
  return [...notes].sort((a, b) => a.start - b.start);
}

function coveredSeconds(notes, from, to) {
  let cursor = from, seconds = 0;
  for (const note of notes) {
    const start = Math.max(cursor, note.start);
    const end = Math.min(note.end, to);
    if (end > start) {
      seconds += end - start;
      cursor = end;
    }
  }
  return seconds;
}

function summarize(notes, from, to) {
  const groups = Map.groupBy(notes, note => note.instrument);
  const instruments = Object.fromEntries([...groups].map(([instrument, group]) => {
    let onsets = 0, minMidi = 127, maxMidi = 0;
    for (const note of group) {
      if (note.start >= from) onsets++;
      minMidi = Math.min(minMidi, note.midi);
      maxMidi = Math.max(maxMidi, note.midi);
    }
    return [instrument, {onsets, coveredSeconds: rounded(coveredSeconds(group, from, to)), minMidi, maxMidi}];
  }));
  return {
    melodicSeconds: rounded(coveredSeconds(notes.filter(isMelodic), from, to)),
    bassSeconds: rounded(coveredSeconds(notes.filter(isBass), from, to)),
    instruments
  };
}

function comparePitch(frames, notes, source) {
  const tonal = notes.filter(note => !isDrums(note));
  let pitchedFrames = 0, matchedFrames = 0, bassOnlyFrames = 0;
  for (const frame of frames) {
    if (frame.pitch === null) continue;
    pitchedFrames++;
    let matched = false, matchedOutsideBass = false;
    for (const note of tonal) {
      if (note.start > frame.second + .075) break;
      if (note.end < frame.second - .075 || Math.abs(note.midi - frame.pitch) > 1) continue;
      matched = true;
      if (!isBass(note)) {
        matchedOutsideBass = true;
        break;
      }
    }
    if (matched) matchedFrames++;
    if (matched && !matchedOutsideBass) bassOnlyFrames++;
  }
  return {
    source, pitchedFrames, matchedFrames, bassOnlyFrames,
    peakRms: rounded(frames.reduce((peak, frame) => Math.max(peak, frame.rms), 0))
  };
}

function assess(evidence, {duration, sparse, shifted}) {
  if (duration < 1.5) return {status: 'insufficient-evidence', reason: 'short-tail'};
  if (evidence.every(item => item.peakRms < .002 && item.pitchedFrames === 0)) {
    return {status: 'no-anomaly', reason: 'quiet-audio'};
  }
  const usable = evidence.filter(item => item.pitchedFrames >= (item.source === 'original' ? 15 : 12));
  if (sparse) {
    const missing = usable.find(({source, pitchedFrames, matchedFrames}) => {
      const unmatched = pitchedFrames - matchedFrames;
      return unmatched >= 10 && unmatched / pitchedFrames >= (source === 'original' ? .55 : .45);
    });
    if (missing) return {status: 'suspected-missing', source: missing.source, reason: 'sustained-pitch-without-midi'};

    const label = usable.find(({source, pitchedFrames, matchedFrames, bassOnlyFrames}) =>
      (shifted || source === 'vocals') && matchedFrames / pitchedFrames >= .65 && bassOnlyFrames / pitchedFrames >= .6
    );
    if (label) return {status: 'suspected-label', source: label.source, reason: 'sustained-pitch-matches-bass-label'};

    if (usable.some(item => item.matchedFrames / item.pitchedFrames < .65) || (shifted && !usable.length)) {
      return {status: 'insufficient-evidence', reason: 'sparse-midi-ambiguous-audio'};
    }
  }
  return {status: 'no-anomaly', reason: 'no-confirmed-mismatch'};
}

function clipEdge(edge, direction, duration, frames) {
  const desired = Math.min(duration, Math.max(0, edge + direction * CONTEXT));
  if (desired === 0 || desired === duration) return desired;
  const origin = frames[0]?.second ?? 0;
  const center = Math.round((desired - origin) / PITCH_HOP);
  const levels = [];
  for (let index = Math.max(1, center - 5); index <= Math.min(frames.length - 2, center + 5); index++) {
    const second = frames[index].second;
    const level = (frames[index - 1].rms + frames[index].rms + frames[index + 1].rms) / 3;
    levels.push({second, level});
  }
  levels.sort((a, b) => a.level - b.level || Math.abs(a.second - desired) - Math.abs(b.second - desired));
  const quiet = levels[0], baseline = frames[center]?.rms ?? 0;
  return rounded(quiet && quiet.level < baseline * .7 ? quiet.second : desired);
}

function planRepairs(windows, duration, frames) {
  const repairs = [];
  for (let index = 0; index < windows.length; index++) {
    if (windows[index].status !== 'suspected-missing') continue;
    const from = windows[index].from;
    while (windows[index + 1]?.status === 'suspected-missing') index++;
    const to = windows[index].to;
    for (let start = from; start < to; start += MAX_REPAIR) {
      const end = Math.min(start + MAX_REPAIR, to);
      repairs.push({
        from: start, to: end,
        clipFrom: clipEdge(start, -1, duration, frames), clipTo: clipEdge(end, 1, duration, frames)
      });
    }
  }
  return repairs;
}

export function scanMuScriptor(original, result, stems = {}) {
  const started = performance.now();
  const duration = original.samples.length / original.rate;
  if (!(duration > 0 && duration <= 3600) || (original.start ?? 0) !== 0 || !Number.isFinite(result?.duration) ||
      Math.abs(result.duration - duration) > .25) {
    throw Error('原音与 MuScriptor 缓存长度不符，请使用同一次分析的音频范围');
  }
  const notes = validatedNotes(result.notes, result.duration);
  const sources = new Map();
  for (const source of ['vocals', 'other']) {
    const track = stems[source];
    if (!track) continue;
    if (Math.abs(track.samples.length / track.rate - duration) > .25 || (track.start ?? 0) !== 0) {
      throw Error('分轨必须与原曲共用起点并覆盖同一时间范围');
    }
    sources.set(source, audioPitchEvidence(track, source));
  }
  const originalFrames = audioPitchEvidence(original, 'original');
  sources.set('original', originalFrames);
  const frameWindows = new Map([...sources].map(([source, frames]) =>
    [source, Map.groupBy(frames, frame => Math.floor(frame.second / WINDOW))]
  ));
  const windows = Array.from({length: Math.ceil(duration / WINDOW)}, (_, index) => ({
    from: index * WINDOW, to: Math.min((index + 1) * WINDOW, duration), notes: []
  }));
  for (const note of notes) {
    for (let index = Math.floor(note.start / WINDOW); index < windows.length && index * WINDOW < note.end; index++) {
      if (note.start < windows[index].to) windows[index].notes.push(note);
    }
  }
  let shifted = false, lastMelodicWindow = -3;
  const diagnosed = windows.map(({from, to, notes: owned}, index) => {
    const span = to - from;
    const midi = summarize(owned, from, to);
    const melodicShare = midi.melodicSeconds / span;
    const sparse = melodicShare <= .15;
    if (!sparse) shifted = false;
    else if (index - lastMelodicWindow <= 2) shifted = true;
    if (melodicShare >= .45) lastMelodicWindow = index;
    const evidence = [...frameWindows].map(([source, bins]) =>
      comparePitch(bins.get(index) || [], owned, source)
    );
    const hasStemEvidence = evidence.some(item => item.source !== 'original' && item.pitchedFrames >= 12);
    const eligible = hasStemEvidence ? evidence.filter(item => item.source !== 'original') : evidence;
    return {from, to, midi, sparse, shifted, evidence, ...assess(eligible, {duration: span, sparse, shifted})};
  });
  return {
    duration, windowSeconds: WINDOW, pitchHopSeconds: PITCH_HOP,
    elapsedMs: rounded(performance.now() - started),
    windows: diagnosed,
    repairs: planRepairs(diagnosed, duration, originalFrames)
  };
}

// Both inputs use original-song seconds. Filter by onset to keep notes
// crossing the crop edge from being counted as new attacks.
export function compareMuScriptorClip(result, clipNotes, from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || from >= to || to > result.duration + .05) {
    throw Error('短片段超出原曲范围');
  }
  const inside = note => note.start >= from && note.start < to;
  const groupKey = note => isDrums(note) ? note.midi + 128 : note.midi;
  const baseline = Map.groupBy(validatedNotes(result.notes, result.duration).filter(inside), groupKey);
  const preview = Map.groupBy(validatedNotes(clipNotes, result.duration, true).filter(inside), groupKey);
  const kept = [], relabeled = [], missing = [], added = [];
  for (const key of new Set([...baseline.keys(), ...preview.keys()])) {
    const before = baseline.get(key) || [], after = preview.get(key) || [];
    let i = 0, j = 0;
    // Chronological matching preserves retriggers and maximizes the number
    // of one-to-one matches within the tolerance for each pitch.
    while (i < before.length && j < after.length) {
      const left = before[i], right = after[j];
      const delta = right.start - left.start;
      if (delta > ONSET_TOLERANCE + 1e-9) missing.push(before[i++]);
      else if (delta < -ONSET_TOLERANCE - 1e-9) added.push(after[j++]);
      else {
        const group = left.instrument === right.instrument ? kept : relabeled;
        group.push({baseline: left, clip: right, offsetMs: rounded(delta * 1000)});
        i++;
        j++;
      }
    }
    missing.push(...before.slice(i));
    added.push(...after.slice(j));
  }
  for (const group of [kept, relabeled]) group.sort((a, b) => a.baseline.start - b.baseline.start);
  for (const group of [missing, added]) group.sort((a, b) => a.start - b.start);
  return {from, to, toleranceMs: ONSET_TOLERANCE * 1000,
    counts: {kept: kept.length, relabeled: relabeled.length, missing: missing.length, added: added.length},
    kept, relabeled, missing, added};
}
