import test from 'node:test';
import assert from 'node:assert/strict';
import {Midi} from '../public/vendor/midi.js';
import {freeScoreSVG,makeDemo,midiFile,scoreSVG,shiftAllNotes,validateProject} from '../public/music.mjs';

test('graphical free view places notes by beat and exposes resize handles',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'fast',start:.0625,duration:.125,midi:60,reviewStatus:'reviewed'},{id:'next',start:.25,duration:.0625,midi:62}]});
  assert.equal(p.layout,'free');
  const svg=freeScoreSVG(p,{selectedGap:0});
  assert.match(svg,/data-note="fast"/);
  assert.match(svg,/class="graphical-score"/);
  assert.match(svg,/data-timeline-grid="0"/);
  assert.match(svg,/data-resize="start"/);
  assert.match(svg,/data-resize="end"/);
  assert.match(svg,/data-free-start="0"/);
  assert.match(svg,/data-free-start="0.3125"/);
  assert.match(svg,/data-selected-gap="1"/);
  assert.doesNotMatch(svg,/第 1 小节/);
  const barred=scoreSVG({...p,layout:'barred'});
  assert.match(barred,/data-note="fast"/);
  assert.match(barred,/密集音符按顺序换行/);
  assert.match(barred,/1\.0625 拍/);
});

test('free score fills its row and exposes trailing blank space for insertion',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'one',start:0,duration:1,midi:60}]});
  const svg=freeScoreSVG(p,{zoom:100,beatsPerRow:4,selectedGap:2});
  assert.match(svg,/viewBox="0 0 484 /);
  assert.match(svg,/data-row-starts="0,4"/);
  assert.match(svg,/data-free-start="1" data-gap-duration="3"/);
  assert.match(svg,/data-selected-gap="1"/);
});

test('whole-score zoom lengthens tiny notes without changing row height or digit size',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'tiny',start:0,duration:.0625,midi:60},{id:'later',start:2,duration:.25,midi:62}]});
  const overview=freeScoreSVG(p,{zoom:50,beatsPerRow:16,measureText:()=>25});
  const close=freeScoreSVG(p,{zoom:800,beatsPerRow:1,measureText:()=>25});
  const width=svg=>Number(svg.match(/data-note="tiny"[^]*?class="timeline-ribbon"[^>]*\swidth="([\d.]+)"/)[1]);
  assert.ok(width(close)>width(overview)*8);
  assert.match(overview,/data-row-height="68"/);
  assert.match(close,/data-row-height="68"/);
  assert.match(close,/class="timeline-label"[^>]*font-size="20"/);
  assert.match(overview,/class="timeline-tiny"/);
  assert.doesNotMatch(close,/class="timeline-tiny"/);
  assert.match(close,/data-note="later"/);
});

test('whole-score pitch shift preserves rests and timing, updates key, and rejects range overflow',()=>{
  const p=validateProject({...makeDemo(),key:0,keyChanges:[{beat:4,key:7}],notes:[{id:'a',start:0,duration:1,midi:60},{id:'rest',start:1,duration:1,midi:null}]});
  const up=shiftAllNotes(p,12);
  assert.equal(up.notes[0].midi,72);assert.equal(up.notes[1].midi,null);
  assert.equal(up.notes[0].start,0);assert.equal(up.notes[0].duration,1);
  assert.equal(up.key,0);assert.equal(up.keyChanges[0].key,7);
  const semitone=shiftAllNotes(p,-1);assert.equal(semitone.notes[0].midi,59);assert.equal(semitone.key,11);
  assert.throws(()=>shiftAllNotes({...p,notes:[{...p.notes[0],midi:108}]},1),/超出/);
});

test('short manually set durations survive MIDI export at 480 ticks per beat',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'short',start:0,duration:.0625,midi:60}]});
  const midi=new Midi(midiFile(p));
  assert.equal(midi.tracks[0].notes[0].durationTicks,30);
});
