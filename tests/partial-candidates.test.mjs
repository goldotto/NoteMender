import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {integratePartialCandidates} from '../public/partial-candidates.mjs';
test('partial recognition retains surrounding markers and every previous candidate through nonlinear alignment',()=>{
  const p=validateProject({...makeDemo(),timeAnchors:[{beat:0,second:0},{beat:8,second:4},{beat:16,second:12},{beat:24,second:16}],sections:[{id:'old',audioStart:0,audioEnd:12,source:'vocals'},{id:'after',audioStart:12,audioEnd:16,source:'guitar'}],alternates:[{id:'prior',sectionId:'old',source:'vocals',method:'原首选',primary:true,notes:[{start:0,duration:16,midi:60}]},{id:'outside',sectionId:'after',source:'guitar',method:'吉他',notes:[{start:16,duration:8,midi:64}]}]});
  const generated=[{id:'new',audioStart:4,audioEnd:8,source:'vocals'}],result=integratePartialCandidates(p,generated,[],4,8),checked=validateProject({...p,...result});
  assert.deepEqual(checked.sections.map(s=>[s.audioStart,s.audioEnd]),[[0,4],[4,8],[8,12],[12,16]]);
  assert.equal(checked.alternates.find(v=>v.id==='outside').notes[0].start,16);
  const previous=checked.alternates.find(v=>v.sectionId==='new');assert.equal(previous.primary,false);assert.equal(previous.notes[0].start,8);assert.equal(previous.notes[0].duration,4);
  assert.equal(checked.alternates.length,4);assert.deepEqual(checked.notes,p.notes);
});
