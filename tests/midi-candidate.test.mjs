import test from 'node:test';
import assert from 'node:assert/strict';
import {Midi} from '../public/vendor/midi.js';
import {makeDemo,midiFile} from '../public/music.mjs';
import {projectFromMidiTrack} from '../public/midi-candidate.mjs';
import {timeAtBeat} from '../public/time-map.mjs';

test('imported MIDI keeps tempo changes in the score-to-audio mapping',()=>{
  const source={...makeDemo(),notes:makeDemo().notes.slice(0,7),timeAnchors:[{beat:0,second:0},{beat:4,second:2},{beat:8,second:6}]};
  const candidate=projectFromMidiTrack(new Midi(midiFile(source)),0,{title:'变速测试'});
  assert.equal(candidate.notes.length,7);
  assert.equal(candidate.title,'变速测试');
  assert.equal(candidate.notes[5].reviewStatus,'pending');
  assert.ok(Math.abs(timeAtBeat(candidate,4)-2)<.01);
  assert.ok(Math.abs(timeAtBeat(candidate,6)-4)<.01);
});

test('MIDI candidate selects a single line from simultaneous notes without overwriting a project',()=>{
  const source=makeDemo(),midi=new Midi(midiFile(source));
  midi.tracks[0].addNote({midi:84,ticks:0,durationTicks:480,velocity:.1});
  const original=source.notes[0].midi;
  const candidate=projectFromMidiTrack(midi,0,{strategy:'highest'});
  assert.equal(candidate.notes[0].midi,84);
  assert.equal(source.notes[0].midi,original);
  assert.ok(candidate.notes.every(n=>n.confidence<1&&n.reviewStatus==='pending'));
});
