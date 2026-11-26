import test from 'node:test';
import assert from 'node:assert/strict';
import {scanMuScriptor, compareMuScriptorClip} from '../public/muscriptor-review.mjs';

const rate = 8000;
const audio = seconds => ({rate, samples: new Float32Array(seconds * rate)});
const note = (start, end, midi, instrument = 'voice') => ({start, end, midi, instrument});

function tone(track, from, to, midi, amplitude = .15) {
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  for (let i = Math.round(from * rate); i < Math.round(to * rate); i++) {
    track.samples[i] += amplitude * Math.sin(i / rate * 2 * Math.PI * frequency);
  }
}

function kick(track, onset) {
  // The brief pitched transient should fail the sustained-pitch gate.
  tone(track, onset, onset + .045, 65, .25);
}

test('separates missing melody, mislabeled melody, bass and drum break and silence', () => {
  const original = audio(25);
  const vocals = audio(25);
  tone(vocals, 0, 5, 64);
  tone(vocals, 5, 10, 67);
  tone(vocals, 10, 15, 69);
  original.samples.set(vocals.samples);
  for (let second = 5; second < 20; second += .5) {
    tone(original, second, second + .5, 36, .04);
    kick(original, second);
  }
  const notes = [
    note(0, 5, 64),
    note(5, 10, 36, 'electric_bass'),
    note(10, 15, 69, 'electric_bass'),
    note(15, 20, 36, 'electric_bass'),
    note(15, 20, 36, 'drums')
  ];
  const report = scanMuScriptor(original, {duration: 25, notes}, {vocals});
  assert.equal(report.windows[0].status, 'no-anomaly');
  assert.equal(report.windows[1].status, 'suspected-missing');
  assert.equal(report.windows[1].source, 'vocals');
  assert.equal(report.windows[2].status, 'suspected-label');
  assert.equal(report.windows[2].midi.instruments.electric_bass.maxMidi, 69);
  assert.equal(report.windows[2].evidence[0].bassOnlyFrames, 50);
  assert.equal(report.windows[3].status, 'insufficient-evidence');
  assert.equal(report.windows[4].reason, 'quiet-audio');
  assert.deepEqual(report.repairs.map(({from,to}) => [from,to]), [[5,10]]);
  assert.equal(scanMuScriptor(original, {duration: 25, notes}).windows[1].status, 'suspected-missing');
});

test('uses other-instrument evidence when the vocals track has no strong pitch cue', () => {
  const original = audio(5), vocals = audio(5), other = audio(5);
  tone(original, 0, 5, 36, .15);
  tone(other, 0, 5, 65);
  const result = {duration: 5, notes: [note(0, 5, 36, 'electric_bass')]};
  const scan = scanMuScriptor(original, result, {vocals, other});
  assert.equal(scan.windows[0].source, 'other');
  assert.equal(scan.windows[0].status, 'suspected-missing');
  assert.deepEqual(scan.repairs, [{from: 0, to: 5, clipFrom: 0, clipTo: 5}]);
  assert.throws(() => scanMuScriptor(original, result, {vocals: audio(4)}), /同一起点|共用起点/);
});

test('uses the union of sounding durations and includes sustain across both windows', () => {
  const original = audio(13);
  const report = scanMuScriptor(original, {duration: 13, notes: [
    note(1, 12, 64), note(3, 9, 67), note(4, 8, 69, 'piano')
  ]});
  assert.deepEqual(report.windows.map(window => window.midi.melodicSeconds), [4,5,2]);
  assert.deepEqual(report.windows.map(window => window.midi.instruments.voice.onsets), [2,0,0]);
  assert.deepEqual(report.windows.map(window => window.midi.instruments.voice.coveredSeconds), [4,5,2]);
  assert.deepEqual(report.repairs, []);
  assert.throws(() => scanMuScriptor(original, {duration: 14, notes: []}), /长度不符/);
});

test('splits long suggestions into overlapping clips and prefers a quiet cut', () => {
  const original = audio(31);
  tone(original, 0, 2.1, 64);
  tone(original, 2.45, 5, 64);
  tone(original, 5, 30, 69);
  const {repairs} = scanMuScriptor(original, {duration: 31, notes: [note(0, 5, 64)]});
  assert.deepEqual(repairs.map(({from,to}) => [from,to]), [[5,25],[25,30]]);
  assert.ok(repairs[0].clipFrom >= 2.15 && repairs[0].clipFrom <= 2.35);
  assert.ok(repairs[0].clipTo > repairs[1].clipFrom);
  assert.equal(repairs[1].clipTo, 31);
});

test('matches nearby repeated pitches one to one and treats percussion separately', () => {
  const baseline = {duration: 12, notes: [
    note(1, 1.2, 60), note(4.95, 5.25, 60), note(5.1, 5.18, 62, 'electric_bass'),
    note(5.2, 5.32, 62, 'electric_bass'), note(5.5, 5.7, 67, 'piano'),
    note(5.7, 5.9, 64, 'drums'), note(6.2, 6.4, 60, 'voice')
  ]};
  const clips = [
    {start: 5.18, midi: 62, instrument: 'piano'}, {start: 5.23, midi: 62, instrument: 'piano'},
    {start: 5.45, midi: 67, instrument: 'piano'}, {start: 5.7, midi: 64, instrument: 'piano'},
    {start: 6.29, midi: 60, instrument: 'voice'}, {start: 7, midi: 69, instrument: 'piano'}
  ];
  const comparison = compareMuScriptorClip(baseline, clips, 5, 7);
  assert.deepEqual(comparison.counts, {kept: 1, relabeled: 2, missing: 2, added: 2});
  assert.deepEqual(comparison.relabeled.map(match => match.offsetMs), [80,30]);
  assert.deepEqual(comparison.added.map(value => value.midi), [64,60]);
  assert.deepEqual(comparison.missing.map(value => value.midi), [64,60]);
});

