import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {KEYS,numberPitch,transpose,makeDemo,validateProject,quantizeNotes,scoreSegments,scoreSVG,midiFile} from '../public/music.mjs';
const require=createRequire(import.meta.url),{Midi}=require('@tonejs/midi');
test('numbered pitch includes accidentals, octave dots, rests and lower octaves',()=>{
 assert.deepEqual(numberPitch(60),{digit:'1',accidental:'',octave:0});
 assert.deepEqual(numberPitch(59),{digit:'7',accidental:'',octave:-1});
 assert.deepEqual(numberPitch(72),{digit:'1',accidental:'',octave:1});
 assert.deepEqual(numberPitch(61,0,true),{digit:'2',accidental:'♭',octave:0});
 assert.deepEqual(numberPitch(null),{digit:'0',accidental:'',octave:0});
});
test('all 12 transpositions preserve scale degrees and timing; down/up resolve directions',()=>{
 const p=makeDemo();for(let key=0;key<12;key++){const q=transpose(p,key);assert.equal(q.key,key);q.notes.forEach((n,i)=>{assert.equal(numberPitch(n.midi,key).digit,numberPitch(p.notes[i].midi,0).digit);assert.equal(n.start,p.notes[i].start);});}
 assert.equal(transpose(p,11).notes[0].midi,59);assert.equal(transpose(p,11,'up').notes[0].midi,71);assert.equal(transpose(p,2,'down').notes[0].midi,50);
});
test('transposition refuses out-of-range pitches instead of clipping',()=>{const p=makeDemo();p.notes[0].midi=108;assert.throws(()=>transpose(p,2,'up'));});
test('project validation rejects overlaps, malformed pitch, nonfinite and off-grid values',()=>{
 for(const change of [{midi:150},{start:NaN},{duration:0},{duration:.3},{midi:undefined}]){const p=makeDemo();Object.assign(p.notes[0],change);assert.throws(()=>validateProject(p));}
 const p=makeDemo();p.notes[1].start=.5;assert.throws(()=>validateProject(p));
});
test('project roundtrip preserves stable unique IDs and sanitizes extra input',()=>{const p=makeDemo();p.secret='discard';const q=validateProject(JSON.parse(JSON.stringify(p)));assert.equal(q.notes[0].id,p.notes[0].id);assert.equal(q.secret,undefined);q.notes[1].id=q.notes[0].id;assert.throws(()=>validateProject(q));});
test('quantization uses bpm, rejects invalid events and resolves same-grid collision',()=>{
 const q=quantizeNotes([{start:1,end:1.45,midi:60,confidence:.5},{start:1.5,end:2,midi:62},{start:3,end:2,midi:64}],120,1);
 assert.equal(q[0].start,0);assert.equal(q[0].duration,1);assert.equal(q[1].start,1);assert.equal(q.length,2);
 const same=quantizeNotes([{start:0,end:.3,midi:60,confidence:.3},{start:.02,end:.3,midi:64,confidence:.8}],120);assert.equal(same.length,1);assert.equal(same[0].midi,64);
});
test('score fills rests, splits bar-crossing notes and ties both parts',()=>{
 const p={...makeDemo(),notes:[{id:'one',start:3,duration:2,midi:60,confidence:1}]};const bars=scoreSegments(p);assert.equal(bars.length,2);assert.equal(bars[0][0].midi,null);assert.equal(bars[0][1].tieNext,true);assert.equal(bars[1][0].continued,true);assert.equal(bars.flat().reduce((s,n)=>s+n.duration,0),8);
});
test('6/8 has three quarter-note beats per bar and dotted/short notes render',()=>{
 const p={...makeDemo(),meter:'6/8',notes:[{id:'one',start:0,duration:.75,midi:72,confidence:.4},{id:'two',start:.75,duration:.25,midi:61,confidence:1}]};assert.equal(scoreSegments(p).flat().reduce((s,n)=>s+n.duration,0),3);const svg=scoreSVG(p);assert.match(svg,/circle/);assert.match(svg,/#fff1d4/);assert.match(svg,/♯/);
});
test('SVG escapes untrusted titles and lyrics',()=>{const p=makeDemo();p.title='<script>alert(1)</script>';p.notes[0].lyric='<img onerror="x">';const svg=scoreSVG(p);assert.ok(!svg.includes('<script>'));assert.ok(!svg.includes('<img'));assert.match(svg,/&lt;script&gt;/);});
test('MIDI roundtrip matches note count, tempo, meter, duration and transposed pitches',()=>{
 const p=transpose(makeDemo(),7),m=new Midi(midiFile(p));assert.equal(m.tracks[0].notes.length,30);assert.equal(Math.round(m.header.tempos[0].bpm),112);assert.deepEqual(m.header.timeSignatures[0].timeSignature,[4,4]);assert.equal(m.tracks[0].notes[0].midi,p.notes[0].midi);assert.equal(m.tracks[0].notes[0].durationTicks,480);assert.equal(m.tracks[0].notes.at(-1).ticks,30*480);
});
