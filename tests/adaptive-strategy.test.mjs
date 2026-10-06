import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisWindows,mergeAnalysisUsed,stitchNotes,chooseAnalysisMode,fuseVocalCandidates,traceDenseMelody,chooseDenseCandidate,chooseQuantization,reviewIssues} from '../public/adaptive-strategy.mjs';
import {makeDemo,validateProject} from '../public/music.mjs';

test('eight-second analysis stays inside an automatic musical section and joins equal profiles',()=>{
  const windows=analysisWindows([{from:2,to:21,source:'vocals'}]);
  assert.equal(windows.length,2);
  assert.equal(windows[0].from,2);
  assert.equal(windows.at(-1).to,21);
  const used=mergeAnalysisUsed(windows.map(w=>({...w,mode:'vocal',flags:[]})));
  assert.deepEqual(used.map(x=>[x.from,x.to,x.mode]),[[2,21,'vocal']]);
  assert.equal(analysisWindows([{from:21.5,to:32.25}]).length,1);
});

test('automatic selection favors vocals and routes clear solo separately from chords',()=>{
  const mono=[{start:0,end:4,midi:60,confidence:.9}],solo=[{start:0,end:4,midi:60,confidence:.8}];
  assert.equal(chooseAnalysisMode({source:'vocals',basic:solo,mono,windowSeconds:8}),'vocal');
  assert.equal(chooseAnalysisMode({source:'other',basic:solo,mono,windowSeconds:8}),'solo');
  assert.equal(chooseAnalysisMode({source:'other',basic:[...solo,{start:0,end:4,midi:48,confidence:.7}],mono,windowSeconds:8}),'dense');
  assert.equal(chooseAnalysisMode({requested:'dense',source:'vocals',basic:solo,mono,windowSeconds:8}),'dense');
});

test('vocal disagreement remains a reviewable note and pitchy fills uncovered sound',()=>{
  const samples=new Float32Array(22050*2).fill(.1);
  const basic=[{start:0,end:.5,midi:60,confidence:.6}],mono=[{start:0,end:.5,midi:72,confidence:.9},{start:1,end:1.5,midi:62,confidence:.9}];
  const fused=fuseVocalCandidates(basic,mono,samples);
  assert.deepEqual(fused.map(n=>n.midi),[60,62]);
  assert.ok(fused[0].reviewFlags.includes('音高冲突'));
  assert.ok(fused[1].reviewFlags.includes('补充候选'));
});

test('strong untranscribed sound is marked for review without inventing a note',()=>{
  const samples=new Float32Array(22050*2).fill(.1),notes=[{start:0,end:.5,midi:60,reviewFlags:['音高冲突']}];
  const issues=reviewIssues(notes,samples);
  assert.ok(issues.some(x=>x.kind==='音高冲突'));
  assert.ok(issues.some(x=>x.kind==='疑似漏音'&&x.second>=.4));
  assert.equal(notes.length,1);
});

test('dense melody path remains monophonic and window fragments can be joined',()=>{
  const lead=[{start:0,end:1,midi:72,confidence:.9},{start:1,end:2,midi:74,confidence:.9}];
  const bass=[{start:0,end:1,midi:48,confidence:.3},{start:1,end:2,midi:48,confidence:.3}];
  const traced=traceDenseMelody([...lead,...bass]);
  assert.deepEqual(traced.map(n=>n.midi),[72,74]);
  assert.ok(traced.every((n,i)=>!i||n.start>=traced[i-1].end));
  assert.equal(stitchNotes([{start:0,end:1,midi:60,confidence:.8},{start:1.02,end:2,midi:60,confidence:.7}]).length,1);
  assert.equal(chooseDenseCandidate(lead.slice(0,1),[...lead,...bass],2).notes.length,4);
});

test('tempo errors choose finer editable grid without changing pitch',()=>{
  const project=validateProject({...makeDemo(),bpm:120,timeAnchors:[]});
  const raw=[{start:.11,end:.34,midi:60},{start:.57,end:.83,midi:62}];
  assert.equal(chooseQuantization(raw,project,.5).step,.0625);
  assert.equal(chooseQuantization([{start:0,end:.5,midi:60}],project,.25).step,.25);
});

test('old project and several new candidates for one section survive validation',()=>{
  const old=validateProject({...makeDemo(),sections:[{id:'s',name:'主歌',kind:'verse',audioStart:0,audioEnd:5}]});
  assert.equal(old.sections[0].analysisMode,'auto');
  const next=validateProject({...old,sections:[{...old.sections[0],analysisMode:'solo',analysisUsed:[{from:0,to:5,mode:'solo',source:'other',flags:[]}]}],alternates:[{sectionId:'s',source:'other',method:'Basic Pitch',notes:[{start:0,duration:.0625,midi:60}]},{sectionId:'s',source:'original',method:'原曲混音',notes:[{start:1,duration:.125,midi:62}]}]});
  assert.equal(next.alternates.length,2);
  assert.equal(next.alternates[0].notes[0].duration,.0625);
  assert.equal(next.sections[0].analysisUsed[0].mode,'solo');
});
