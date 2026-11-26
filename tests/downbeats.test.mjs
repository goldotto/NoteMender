import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {analyseBarPulses,analyseTappedBars,projectOnBarPulses,tappedTempo} from '../public/downbeat-layout.mjs';
import {timeAtBeat} from '../public/time-map.mjs';
import {prepareEngraving,engravingBars} from '../public/engraving.mjs';
import {scoreMusicXML} from '../public/score-musicxml.mjs';
import {createDownbeatService} from '../src/downbeat-service.mjs';

const pulses=Array.from({length:65},(_,i)=>.5+i*.6);
const stable={beats:pulses,downbeats:pulses.filter((_,i)=>i%4===1),duration:40};
const project={
  title:'Pickup test',meter:'4/4',key:0,keyChanges:[{beat:4,key:2}],bpm:100,offset:.5,
  notes:[{id:'p',midi:62,start:0,duration:.5},{id:'long',midi:64,start:1,duration:5},{id:'short',midi:65,start:6.001,duration:.016}],
  lyrics:[{id:'l',text:'歌',noteIds:['long']}]
};

test('audio-based bars preserve pickup, pitch, IDs, lyrics and long-note continuity',()=>{
  const previous=structuredClone(project);
  const grid=analyseBarPulses(stable,'4/4');
  assert.equal(grid.bpm,100);
  assert.equal(grid.marks[0].second,1.1);
  const copy=projectOnBarPulses(project,grid);
  assert.equal(copy.pickup,1);
  assert.deepEqual(copy.project.notes.map(({id,midi})=>[id,midi]),project.notes.map(({id,midi})=>[id,midi]));
  assert.equal(copy.project.notes[1].duration,5);
  assert.equal(copy.project.notes[2].duration,.0625);
  assert.deepEqual(project,previous);
  const prepared=prepareEngraving(copy.project,{pickup:copy.pickup,step:0});
  const atoms=engravingBars(prepared).flatMap(b=>b.atoms).filter(n=>n.id==='long');
  assert.equal(atoms.filter(n=>n.printLyric==='歌').length,1);
  assert.equal(atoms.reduce((sum,n)=>sum+n.duration,0),5);
  assert.ok(atoms[0].tieOut&&atoms.at(-1).tieIn);
  assert.match(scoreMusicXML(prepared),/<measure number="0" implicit="yes"/);
});

test('variable bar tempos and one missed beat retain the detected bar phase',()=>{
  const beats=Array.from({length:49},(_,i)=>.3+i*.56+i*i*.0009);
  const downbeats=beats.filter((_,i)=>i%4===0);
  const grid=analyseBarPulses({beats:beats.filter((_,i)=>i!==11),downbeats},'4/4');
  assert.ok(grid.automatic);
  assert.deepEqual(grid.marks.map(mark=>mark.second),downbeats);
  assert.equal(grid.map.timeAnchors[3].beat,12);
});

test('sparse or conflicting downbeats require confirmation; a manual beat uses the existing tempo',()=>{
  const unclear={...stable,downbeats:pulses.filter((_,i)=>i%3===0||i%4===0)};
  assert.equal(analyseBarPulses(unclear,'4/4').marks.length,0);
  const confirmed=analyseBarPulses(unclear,'4/4',pulses[5],100);
  assert.equal(confirmed.fixed,true);
  assert.ok(confirmed.marks.some(m=>Math.abs(m.second-pulses[5])<1e-7));
  assert.equal(confirmed.bpm,100);
  assert.equal(analyseBarPulses({beats:[]},'4/4'),null);
});

test('a sustained but minority phase is listed for listening review',()=>{
  const beats=Array.from({length:90},(_,i)=>.5+i*.6);
  const downbeats=beats.filter((_,i)=>i<72?i%4===1:i%4===3);
  const grid=analyseBarPulses({beats,downbeats},'4/4');
  assert.equal(grid.automatic,true);
  assert.deepEqual(grid.inspect,[{from:beats[75],to:beats[87]}]);
});

test('compound meter can use two detected pulses per bar without treating them as 2/4',()=>{
  const beats=Array.from({length:24},(_,i)=>.2+i*.75);
  const grid=analyseBarPulses({beats,downbeats:beats.filter((_,i)=>i%2===0)},'6/8');
  assert.equal(grid.perBar,2);
  assert.equal(grid.map.timeAnchors[1].beat,3);
  assert.equal(grid.bpm,120);
});

test('manual taps preserve changing beat times and can reset the bar phase',()=>{
  const taps=[2,2.5,3.125,3.75,4.5,5.25,6,6.75,7.5];
  const grid=analyseTappedBars(taps,'4/4');
  assert.deepEqual(grid.marks.map(mark=>mark.second),[2,4.5,7.5]);
  assert.deepEqual(taps.map((_,index)=>timeAtBeat(grid.map,index)),taps);
  const shifted=analyseTappedBars(taps,'4/4',2.5);
  assert.deepEqual(shifted.marks.map(mark=>mark.second),[2.5,5.25]);
  const copy=projectOnBarPulses(project,grid);
  assert.deepEqual(copy.barMarkers.map(mark=>mark.second),[2,4.5,7.5]);
  assert.deepEqual(copy.project.notes.map(note=>note.id),project.notes.map(note=>note.id));
});

test('a short manual take marks only recorded downbeats and measures 6/8 in quarter-note BPM',()=>{
  assert.equal(tappedTempo([5,5.75],'6/8'),null);
  assert.equal(tappedTempo([5,5.75,5.75],'6/8'),null);
  const taps=[5,5.75,6.5];
  const grid=analyseTappedBars(taps,'6/8');
  assert.equal(grid.bpm,120);
  assert.equal(timeAtBeat(grid.map,1.5),5.75);
  assert.deepEqual(grid.marks.map(mark=>mark.second),[5,6.5]);
  assert.deepEqual(grid.map.timeAnchors.map(anchor=>anchor.second),taps);
  const lateTake=analyseTappedBars([115,115.5,116],'4/4',115.5);
  assert.deepEqual(lateTake.marks,[{index:1,second:115.5}]);
  assert.ok(projectOnBarPulses(project,analyseTappedBars([.1,.25,.4],'4/4')));
});

test('endpoint requires the session token, rejects invalid audio and caches the same WAV',async()=>{
  let scans=0;
  const service=createDownbeatService('.',{
    analyse:async()=>{scans++;return stable;}
  });
  const server=createServer((req,res)=>service.handle(req,res,(status,data)=>{
    res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
  },'test-token'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port;
    const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
    const send=(body,token='test-token')=>fetch(url,{method:'POST',headers:{'X-Studio-Token':token},body});
    assert.equal((await send(wav,'wrong')).status,403);
    assert.equal((await send('invalid')).status,400);
    assert.equal((await send(wav)).status,200);
    assert.equal((await send(wav)).status,200);
    assert.equal(scans,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
