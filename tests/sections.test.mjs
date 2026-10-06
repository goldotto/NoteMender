import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject,freeScoreSVG} from '../public/music.mjs';
import {sectionSeconds,sectionBeats,shiftSelectedNotes} from '../public/sections.mjs';
import {beatAtTime,timeAtBeat} from '../public/time-map.mjs';
import {automaticSpans} from '../public/segmentation.mjs';

test('old beat sections become fixed audio intervals and survive alignment edits',()=>{
  const old={...makeDemo(),bpm:120,offset:2,sections:[{id:'a',name:'前奏',kind:'intro',start:0,end:4},{id:'b',name:'主歌',kind:'verse',start:4,end:8}]};
  const p=validateProject(old);assert.deepEqual(sectionSeconds(p,p.sections[0]),{from:2,to:4});
  assert.equal(p.sections[0].source,'other');assert.equal(p.sections[1].source,'vocals');
  const shifted=validateProject({...p,timeAnchors:[{beat:0,second:2},{beat:4,second:4.5},{beat:32,second:19}]});
  assert.deepEqual(sectionSeconds(shifted,shifted.sections[0]),{from:2,to:4});
  assert.ok(sectionBeats(shifted,shifted.sections[0]).end<4);
  assert.equal(timeAtBeat(shifted,beatAtTime(shifted,shifted.sections[0].audioEnd)),4);
});

test('sections reject overlap, but removing metadata preserves formal notes',()=>{
  const p=validateProject({...makeDemo(),sections:[{id:'a',name:'A',kind:'other',audioStart:0,audioEnd:2},{id:'b',name:'B',kind:'other',audioStart:2,audioEnd:4}]});
  assert.throws(()=>validateProject({...p,sections:[p.sections[0],{...p.sections[1],audioStart:1.99}]}),/重叠/);
  const removed=validateProject({...p,sections:p.sections.filter(s=>s.id!=='a'),alternates:[]});
  assert.deepEqual(removed.notes,p.notes);
});

test('batch pitch edit moves only selected notes and rejects whole out-of-range batch',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'one',start:0,duration:1,midi:60},{id:'two',start:1,duration:1,midi:61},{id:'three',start:2,duration:1,midi:null}]});
  const q=shiftSelectedNotes(p,['one','three'],12);assert.deepEqual(q.notes.map(n=>n.midi),[72,61,null]);assert.equal(q.key,p.key);
  assert.throws(()=>shiftSelectedNotes({...p,notes:p.notes.map(n=>n.id==='one'?{...n,midi:108}:n)},['one','two'],1),/整批未修改/);
  assert.equal(p.notes[0].midi,60);
});

test('tiny score blocks show an in-bounds mark with separated top and bottom handles',()=>{
  const p=validateProject({...makeDemo(),notes:[{id:'tiny',start:0,duration:.0625,midi:61}]});
  const svg=freeScoreSVG(p,{zoom:90,beatsPerRow:4,measureText:()=>40});
  const tiny=svg.match(/<g class="timeline-note"[^]*?<\/g>/)[0];
  assert.match(tiny,/class="timeline-tiny"/);assert.doesNotMatch(tiny,/class="timeline-label"/);
  assert.match(svg,/data-resize="start"[^>]+height="18"/);
  assert.match(svg,/data-resize="end"[^>]+height="19"/);
  assert.match(svg,/data-note="tiny"/);
});

test('whole-song spans are derived from audio and ignore manual section metadata',()=>{
  const p=validateProject({...makeDemo(),sections:[{id:'manual',name:'手动',kind:'chorus',audioStart:1,audioEnd:2}]});
  const spans=automaticSpans(null,null,5);
  assert.deepEqual(spans.map(s=>[s.from,s.to,s.source]),[[0,5,'original']]);
  assert.equal(p.sections[0].name,'手动');
});
