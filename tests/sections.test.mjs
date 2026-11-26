import {appText} from '../public/app-i18n.mjs';
import {tr} from '../public/i18n.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject,freeScoreSVG} from '../public/music.mjs';
import {sectionSeconds,sectionBeats,shiftSelectedNotes,sectionViewport,sectionRegionBounds,sectionTickStep} from '../public/sections.mjs';
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


test('section viewport defaults to the whole song and clamps local views without blank tails',()=>{
  assert.deepEqual(sectionViewport(250.26),{start:0,end:250.26,seconds:250.26,full:true});
  assert.deepEqual(sectionViewport(250,40,240),{start:210,end:250,seconds:40,full:false});
  assert.deepEqual(sectionViewport(12,40,50),{start:0,end:12,seconds:12,full:true});
  assert.deepEqual(sectionViewport(undefined),{start:0,end:0,seconds:0,full:true});
  assert.equal(sectionTickStep(250,1600),15);assert.ok(250/sectionTickStep(250,300)<6);
});

test('clipped sections never expose artificial resize handles at viewport boundaries',()=>{
  const v=sectionViewport(250,40);
  assert.deepEqual(sectionRegionBounds(32,93,v),{left:80,width:20,startHandle:true,endHandle:false});
  assert.deepEqual(sectionRegionBounds(0,93,sectionViewport(250,40,40)),{left:0,width:100,startHandle:false,endHandle:false});
  const tail=sectionRegionBounds(32,93,sectionViewport(250,40,80));assert.equal(tail.startHandle,false);assert.equal(tail.endHandle,true);
  assert.equal(sectionRegionBounds(93,115,v),null);assert.equal(sectionRegionBounds(0,40,sectionViewport(250,40,40)),null);
});

async function trackHarness(){
  const code=await readFile(new URL('../public/app.mjs',import.meta.url),'utf8'),controls=new Map(),handlers=new Map();
  const canvasContext=new Proxy({},{get:()=>()=>{}});
  const $=id=>{if(!controls.has(id))controls.set(id,{hidden:false,style:{},clientWidth:1000,innerHTML:'',getContext:()=>canvasContext,getBoundingClientRect:()=>({left:10,width:1000})});return controls.get(id);};
  const edges=[0,32,93,115,166,178,220,250],sections=edges.slice(0,-1).map((start,i)=>({id:'s'+i,name:'区段 '+i,audioStart:start,audioEnd:edges[i+1]}));
  const state={appText,tr,$,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),sectionViewport,sectionRegionBounds,sectionTickStep,sectionSeconds,sectionViewSeconds:0,sectionViewStart:0,selectedSectionId:null,scorePending:false,transcribing:false,playPosition:0,devicePixelRatio:1,timeText:String,escapeXML:String,project:{offset:0,sections},original:{duration:250,sampleRate:1,getChannelData:()=>new Float32Array(251)},on:(id,event,fn)=>handlers.set(id,fn)};
  const context=vm.createContext(state);vm.runInContext(code.slice(code.indexOf('function selectSection(id,'),code.indexOf('function saveSectionFromEditor()')),context);
  state.renderSections=()=>state.drawSectionTrack();
  vm.runInContext(code.slice(code.indexOf("on('sectionWindow','change'"),code.indexOf("on('saveSection','click'")),context);
  return {state,controls,handlers};
}

test('real track draws all seven sections by default, can zoom and return to full view without editing data',async()=>{
  const {state:s,controls,handlers}=await trackHarness(),before=structuredClone(s.project);
  s.drawSectionTrack();assert.equal((controls.get('sectionRegions').innerHTML.match(/data-section-block=/g)||[]).length,7);assert.match(controls.get('sectionWindowLabel').textContent,/250/);assert.equal(controls.get('sectionWindow').value,'all');assert.equal(controls.get('sectionNext').disabled,true);
  assert.equal(s.sectionPointerSecond({clientX:510}),125);s.playPosition=125;s.drawSectionPointer();assert.equal(controls.get('sectionPointer').style.left,'50%');
  handlers.get('sectionWindow')({target:{value:'40'}});const html=controls.get('sectionRegions').innerHTML;
  assert.equal((html.match(/data-section-block=/g)||[]).length,2);const voice=html.slice(html.indexOf('data-section-block="s1"'));assert.ok(!voice.includes('data-section-handle="end"'));
  handlers.get('sectionNext')();assert.equal(s.sectionViewStart,32);
  s.selectSection('s6');assert.equal(s.selectedSectionId,'s6');assert.ok(s.sectionViewStart>=210);assert.ok(controls.get('sectionRegions').innerHTML.includes('data-section-block="s6"'));
  handlers.get('sectionWindow')({target:{value:'all'}});assert.equal(s.sectionViewStart,0);assert.equal((controls.get('sectionRegions').innerHTML.match(/data-section-block=/g)||[]).length,7);
  assert.deepEqual(s.project,before,'zoom, navigation and selection must not shorten sections');
});

test('real track selection fits long passages and safely renders short or missing audio',async()=>{
  const {state:s,controls,handlers}=await trackHarness();s.sectionViewSeconds=40;s.selectSection('s1',{focus:false});assert.equal(s.sectionViewSeconds,40);assert.equal(s.sectionViewStart,0);s.selectSection('s1');assert.equal(s.sectionViewSeconds,80);assert.ok(s.sectionViewStart<=32&&s.sectionViewStart+80>=93);
  s.original.duration=12;s.project.sections=[];handlers.get('sectionWindow')({target:{value:'40'}});assert.match(controls.get('sectionWindowLabel').textContent,/12/);assert.equal(s.sectionPointerSecond({clientX:1010}),12);assert.equal(controls.get('sectionNext').disabled,true);
  s.original=null;assert.doesNotThrow(()=>s.drawSectionTrack());assert.equal(controls.get('sectionWindow').disabled,true);
});
