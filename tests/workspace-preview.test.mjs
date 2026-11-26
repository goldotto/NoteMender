import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject,numberPitch,KEYS,freeScoreSVG,scoreSVG,meterBarMarkers,barLength} from '../public/music.mjs';
import {prepareEngraving} from '../public/engraving.mjs';
import {dolceDocument} from '../public/dolce-score.mjs';
import {editVocalNotes,patchVocalNotes,editPreviewNotes,editVocalSlur} from '../public/vocal-score.mjs';
import {fitPreviewRect} from '../public/workspace-preview.mjs';
import {analyseBarPulses,analyseTappedBars,projectOnBarPulses} from '../public/downbeat-layout.mjs';
import {timeAtBeat} from '../public/time-map.mjs';
import {projectText,parseProjectText} from '../public/project-file.mjs';
import {copyNotes,pasteNotes} from '../public/note-clipboard.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {scoreMusicXML} from '../public/score-musicxml.mjs';
import {EN_CONTROL_HELP} from '../public/help-content.en.mjs';
import {CONTROL_HELP} from '../public/help-content.mjs';
import {exportName} from '../public/export-name.mjs';

const note=(id,start,duration=1,midi=60)=>({id,start,duration,midi,lyric:''});
const project=notes=>validateProject({...makeDemo(),notes,key:0,keyChanges:[],lyrics:[],sections:[],timeAnchors:[]});
const prepare=p=>prepareEngraving(p,{step:0});
const elements=doc=>doc.songs[0].parts[0].measures.flatMap(m=>m.elements);

test('floating window stays reachable after moving, resizing and viewport changes',()=>{
  for(const [width,height]of [[1920,1080],[1366,768],[800,400],[320,300]]){
    const fitted=fitPreviewRect({left:3000,top:-500,width:1800,height:1300},width,height);
    assert.ok(fitted.left>=8&&fitted.top>=8);
    assert.ok(fitted.left+fitted.width<=width-8);
    assert.ok(fitted.top+fitted.height<=height-8);
  }
});

test('read-only preview displays and exports without installing score editing handlers',async()=>{
  const source=await readFile(new URL('../public/workspace-preview.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/installScoreInteractions|commit\(|page\.mount\(|data-(pitch|lyric|duration|undo|redo|play)[=>\s]/);
  assert.match(CONTROL_HELP.scorePreviewToggle,/只读/);
  assert.match(EN_CONTROL_HELP.scorePreviewToggle,/read-only/);
  const created=[],downloads=[],markers=[],auditions=[],events=new Map(),staticNodes=new Map();
  class Element{
    constructor(){this.style={};this.dataset={};this.nodes=new Map();this.options=[{},{},{}];this.value='0';this.classList={toggle(){}};}
    get length(){return this.options.length;}
    set length(value){this.options.length=value;}
    get selectedIndex(){return this.options.findIndex(option=>String(option?.value)===this.value);}
    set selectedIndex(index){this.value=String(this.options[index]?.value??'');}
    add(option){this.options.push(option);}
    set innerHTML(html){this.html=html;for(const match of html.matchAll(/data-([\w-]+)/g))this.nodes.set(match[1],new Element());}
    querySelector(selector){const key=selector.match(/data-([\w-]+)/)?.[1]||selector;if(!this.nodes.has(key))this.nodes.set(key,new Element());return this.nodes.get(key);}
    setAttribute(){} after(){} append(...children){this.children=children;} replaceChildren(...children){this.children=children;}
    addEventListener(name,fn){events.set(name,fn);} focus(){} closest(){return {after(){}};}
  }
  const p={...project([note('a',1),note('b',6),note('c',11)]),bpm:120,offset:0,meter:'4/4',engraving:{pickup:.75}},before=structuredClone(p);
  const audio={};
  const beats=Array.from({length:40},(_,i)=>.25+i/2);
  const detections=[{beats,downbeats:beats.filter((_,i)=>i%4===0)},{beats,downbeats:[]}];
  let mounts=0;
  const context=vm.createContext({tr:zh=>zh,onLanguageChange(){},prepareEngraving,scoreMusicXML,analyseBarPulses,
    projectOnBarPulses,timeAtBeat,barLength,AbortController,Option:class{constructor(text,value){Object.assign(this,{text,value:String(value)});}},
    exportName,escapeXML:s=>s,
    renderDolceScore:async()=>({pages:[{svg:{},mount(){mounts++;}}]}),scoreExport:async()=>({svg:'<svg/>',pages:[],font:''}),
    document:{createElement(){const node=new Element();created.push(node);return node;},getElementById(id){if(!staticNodes.has(id))staticNodes.set(id,new Element());return staticNodes.get(id);},body:{append(){}}},
    window:{innerWidth:1366,innerHeight:768,addEventListener(){}},setTimeout,clearTimeout});
  const previewBars=await readFile(new URL('../public/downbeat-preview.mjs',import.meta.url),'utf8');
  for(const module of [previewBars,source])vm.runInContext(module.replace(/^import .*;\r?\n/gm,'').replace(/export function /g,'function '),context);
  const api=context.installWorkspacePreview({audioBarSuggestions:true,getProject:()=>p,getAudio:()=>audio,detectBars:async()=>detections.shift(),
    auditionBars:(...args)=>auditions.push(args),onBarMarkers:marks=>markers.push(JSON.stringify(marks)),
    isBusy:()=>false,download:(...args)=>downloads.push(args),onError:error=>{throw error;}});
  const [panel]=created,button=staticNodes.get("scorePreviewToggle");
  assert.deepEqual(Object.keys(api),['refresh','stopAudio','audioChanged','setManualBars']);
  assert.doesNotMatch(panel.html,/data-tap-/);
  button.onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(panel.hidden,false);assert.equal(mounts,0);assert.equal(panel.querySelector('[data-paper]').children.length,1);
  assert.equal(panel.querySelector('[data-pickup]').value,'0.75');
  await panel.querySelector('[data-musicxml]').onclick();
  assert.equal(downloads[0][1],p.title+'.musicxml');assert.match(downloads[0][0],/<score-partwise /);
  panel.querySelector('[data-auto]').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(panel.querySelector('[data-view]').value,'tidy');
  assert.equal(panel.querySelector('[data-close-gaps]').disabled,false);
  panel.querySelector('[data-pickup]').value='.5';
  panel.querySelector('[data-pickup]').onchange();await new Promise(resolve=>setImmediate(resolve));
  await panel.querySelector('[data-musicxml]').onclick();
  assert.match(downloads[1][0],/<measure number="0" implicit="yes">/);
  panel.querySelector('[data-view]').value='original';
  panel.querySelector('[data-view]').onchange();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(panel.querySelector('[data-close-gaps]').disabled,true);
  const field=name=>panel.querySelector('[data-'+name+']'),exportButtons=['musicxml','svg','print'].map(field);
  assert.match(panel.html,/<details class="workspace-bar-tools" data-beats-section><summary data-beats-heading>/);
  const manual=analyseTappedBars(Array.from({length:16},(_,i)=>.1+i*.52),'4/4',.1);
  api.setManualBars(manual,'4/4');
  const manualMarks=markers.at(-1);
  assert.equal(JSON.parse(manualMarks)[0].second,.1);
  await field('beats-scan').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(field('beats-source').value,'detected');
  assert.equal(field('beats-meter').value,'4/4');
  assert.equal(field('beats-apply').disabled,false);
  assert.equal(markers.at(-1),manualMarks);
  assert.ok(exportButtons.every(button=>button.disabled));
  assert.match(field('beats-review-status').textContent,/正在对照/);
  await field('musicxml').onclick();
  await field('svg').onclick();
  await field('print').onclick();
  assert.equal(downloads.length,2);
  field('beats-at').value='2.25';
  await field('beats-listen').onclick();
  assert.equal(auditions[0][0],audio);
  assert.equal(auditions[0][1],1);
  assert.equal(auditions[0][2][1],2.25);
  field('beats-apply').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.parse(markers.at(-1))[0].second,.25);
  assert.ok(exportButtons.every(button=>!button.disabled));
  assert.match(field('beats-review-status').textContent,/已使用原曲建议/);
  await field('musicxml').onclick();
  assert.notEqual(downloads[2][0],downloads[1][0]);
  await field('svg').onclick();
  assert.match(downloads[3][0],/<svg/);
  field('beats-phase').value='2.25';
  field('beats-phase').onchange();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(markers.at(-1),manualMarks);
  assert.ok(exportButtons.every(button=>button.disabled));
  field('beats-apply').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.parse(markers.at(-1))[0].second,.25);
  field('beats-source').value='current';
  field('beats-source').onchange();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(markers.at(-1),manualMarks);
  assert.equal(field('pickup').value,'0.5');
  assert.ok(exportButtons.every(button=>!button.disabled));
  api.setManualBars(null);
  assert.equal(markers.at(-1),'[]');
  await field('beats-scan').onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(field('beats-apply').disabled,true);
  assert.deepEqual(field('beats-review-status').textContent,'');
  assert.match(field('beats-info').textContent,/0:00\.25–0:19\.75.*无法可靠确定/);
  assert.match(field('beats-at').options[0].text,/0:00\.25–0:19\.75.*待核对/);
  assert.ok(exportButtons.every(button=>!button.disabled));
  let stopped=false,prevented=false;
  events.get('keydown')({key:'Escape',stopPropagation(){stopped=true;},preventDefault(){prevented=true;}});
  assert.ok(stopped&&prevented);assert.equal(panel.hidden,true);assert.deepEqual(p,before);
});

test('audio bar markers are informational and preserve the editing grid',()=>{
  const p=project([note('a',0,5)]);
  const source=freeScoreSVG(p,{beatsPerRow:4,barMarkers:[{beat:.5,number:1},{beat:4,number:2}]});
  assert.match(source,/<g class="audio-bar-markers" pointer-events="none" aria-hidden="true">/);
  assert.match(source,/§1/);assert.match(source,/§2/);
  assert.equal([...source.matchAll(/data-timeline-grid=/g)].length,2);
  assert.equal([...source.matchAll(/data-note="a"/g)].length,2);
});

test('project meter markers and audio overlays appear across numbered workspace layouts',()=>{
  const ordinary={...project([note('a',0,5)]),meter:'3/4'};
  const dense={...ordinary,notes:[note('a',0,.125),note('b',.5,.5)]};
  assert.deepEqual(meterBarMarkers(ordinary,5),[{beat:0,number:1},{beat:3,number:2}]);
  for(const p of [ordinary,dense]){
    const markers=[{beat:.6,number:7}];
    assert.match(scoreSVG(p,{barMarkers:markers}),/§7<\/text>/u);
    assert.doesNotMatch(scoreSVG(p),/§7/u);
  }
});

test('immediate marking changes preserve distinct existing marks on each selected note',()=>{
  const p=editVocalNotes(project([note('a',0),note('b',1),note('c',2)]),['a'],{dynamic:'p',text:'soft'});
  p.notes[1].vocal={fermata:true,dynamic:'f'};
  const next=patchVocalNotes(p,['a','b'],{breath:true});
  assert.equal(next.notes[0].vocal.dynamic,'p');assert.equal(next.notes[0].vocal.text,'soft');
  assert.equal(next.notes[1].vocal.dynamic,'f');assert.equal(next.notes[1].vocal.fermata,true);
  assert.equal(next.notes[1].vocal.breath,true);assert.equal(next.notes[2],p.notes[2]);
  assert.equal(p.notes[0].vocal.breath,false);
});

test('floating editor changes pitch and duration atomically without moving notes or lyrics',()=>{
  const p=project([note('a',0),note('b',1)]),before=structuredClone(p);
  const next=editPreviewNotes(p,['a','b'],{duration:.25});
  assert.deepEqual(next.notes.map(n=>n.start),[0,1]);assert.deepEqual(next.notes.map(n=>n.duration),[.25,.25]);
  assert.deepEqual(next.lyrics,p.lyrics);
  assert.equal(editPreviewNotes(p,['a'],{midi:null}).notes[0].midi,null);
  for(const changes of [{midi:109},{midi:20},{duration:0},{duration:NaN},{duration:129}])assert.throws(()=>editPreviewNotes(p,['a','b'],changes));
  assert.deepEqual(p,before);
});

test('vocal markings and slurs roundtrip without changing pitches, lyrics or source',()=>{
  const original=project([note('a',0),note('b',1)]),before=structuredClone(original);
  const marked=editVocalSlur(editVocalNotes(original,['a'],{breath:true,dynamic:'mf',text:'轻柔 <soft>'}),['a','b']);
  const loaded=parseProjectText(projectText(marked));
  assert.deepEqual(original,before);
  assert.equal(loaded.notes[0].vocal.breath,true);
  assert.equal(loaded.notes[0].vocal.dynamic,'mf');
  assert.equal(loaded.notes[0].vocal.text,'轻柔 <soft>');
  assert.deepEqual(loaded.vocalSlurs,[{start:'a',end:'b'}]);
  assert.deepEqual(loaded.notes.map(n=>[n.id,n.start,n.duration,n.midi]),original.notes.map(n=>[n.id,n.start,n.duration,n.midi]));
  assert.deepEqual(editVocalSlur(loaded,['a','b'],true).vocalSlurs,[]);
  assert.equal(validateProject(before).vocalSlurs,undefined);
});

test('invalid, duplicated and removed slur endpoints are pruned',()=>{
  const p=project([note('a',0),note('b',1),note('rest',2,1,null)]);
  p.vocalSlurs=[{start:'a',end:'b'},{start:'a',end:'b'},{start:'b',end:'a'},{start:'a',end:'missing'},{start:'a',end:'rest'}];
  assert.deepEqual(validateProject(p).vocalSlurs,[{start:'a',end:'b'}]);
  assert.deepEqual(validateProject({...p,notes:p.notes.filter(n=>n.id!=='b')}).vocalSlurs,[]);
  assert.throws(()=>editVocalSlur(p,['a','rest']),/两个/);
});

test('all notation keys and octave/accidental boundaries agree with the existing editor',()=>{
  for(let key=0;key<12;key++)for(const midi of [21,48,59,60,61,68,71,72,108])for(const flats of [false,true]){
    const p={...project([note('a',0,1,midi)]),key};
    const prepared=prepareEngraving(p,{step:0,flats}),{doc,owners}=dolceDocument(prepared),pitch=numberPitch(midi,key,flats);
    const chord=elements(doc).find(c=>owners.get(c.id)==='a'),degree=chord.notes[0].degree;
    assert.equal(doc.songs[0].key.display,KEYS[key]);
    assert.equal(degree.number,Number(pitch.digit));assert.equal(degree.octaveShift,pitch.octave);
    assert.equal(degree.accidental,pitch.accidental?(pitch.accidental==='♯'?'sharp':'flat'):undefined);
    assert.equal(p.notes[0].midi,midi);
  }
});

test('cross-bar durations, ties, rests and per-note markings retain original identities',()=>{
  const p=editVocalNotes(project([note('held',3,7.1875)]),['held'],{breath:true,fermata:true,accent:true,dynamic:'p',text:'连贯'});
  const {doc,owners}=dolceDocument(prepare(p)),all=elements(doc),held=all.filter(c=>owners.get(c.id)==='held');
  assert.equal(held.reduce((sum,c)=>sum+c.duration.divisions/48,0),7.1875);
  assert.ok(all.some(c=>c.rest));assert.ok(held.every(c=>c.duration.type));
  assert.equal(held[0].notes[0].tie.start,true);assert.equal(held.at(-1).notes[0].tie.stop,true);
  const ties=doc.songs[0].marks.filter(mark=>mark.type==='tied');
  assert.deepEqual(ties.map(t=>[t.start,t.end]),held.slice(1).map((chord,i)=>[held[i].id,chord.id]));
  assert.equal(held.filter(c=>c.notations.fermata).length,1);
  assert.equal(held.filter(c=>c.notations.articulations.includes('breath-mark')).length,1);
  assert.ok(held[0].notations.articulations.includes('accent'));
  assert.equal(doc.songs[0].parts[0].measures.flatMap(m=>m.directions).filter(d=>d.type==='dynamics').length,1);
});

test('section notation keys, lyric melismas and slurs map onto displayed atoms',()=>{
  const p=project([note('a',0),note('b',1),note('c',2)]);
  p.keyChanges=[{beat:1,key:8}];p.lyrics=[{id:'word',text:'啊 / Hello 日本語 한국어',noteIds:['a','b']}];
  const {doc,owners}=dolceDocument(prepare(editVocalSlur(p,['a','c']))),all=elements(doc);
  assert.equal(all.filter(c=>c.lyrics.length).length,1);
  assert.equal(all[1].sectionWord,'1=A♭');
  assert.equal(owners.get(doc.songs[0].marks[0].start),'a');assert.equal(owners.get(doc.songs[0].marks[0].end),'c');
});

test('quantization conflicts block engraving while source notes remain intact',()=>{
  const p=project([note('a',0,.0625),note('b',.0625,.0625)]),before=structuredClone(p);
  assert.throws(()=>dolceDocument(prepareEngraving(p,{step:.25})),/时长为零/);
  assert.deepEqual(p,before);assert.equal(new Set(dolceDocument(prepare(p)).owners.values()).size,2);
});

test('copy and paste carry vocal markings and remap internal slur endpoints',()=>{
  const p=editVocalSlur(editVocalNotes(project([note('a',0),note('b',1)]),['a'],{breath:true,dynamic:'f'}),['a','b']);
  const copied=copyNotes(p,['a','b']),result=pasteNotes(p,copied,4),[a,b]=result.ids;
  assert.equal(result.project.notes.find(n=>n.id===a).vocal.dynamic,'f');
  assert.deepEqual(result.project.vocalSlurs,[{start:'a',end:'b'},{start:a,end:b}]);
  assert.equal(copyNotes(p,['a']).vocalSlurs,undefined);
});
