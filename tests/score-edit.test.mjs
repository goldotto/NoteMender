import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateProject} from '../public/music.mjs';
import {pointerBeat,placeMovedNotes,copyScoreSelection,pasteScoreSelection,moveScoreSelection} from '../public/score-edit.mjs';
import {retimeAssociated} from '../public/linked-edit.mjs';
import {shortcutAction} from '../public/shortcuts.mjs';
const fixture=()=>validateProject({...makeDemo(),bpm:60,notes:[{id:'a',start:0,duration:2,midi:60},{id:'b',start:8,duration:4,midi:62},{id:'c',start:16,duration:1,midi:64}],lyrics:[{id:'word',text:'唱',start:0,end:2,noteIds:['a'],source:'manual',reviewed:true},{id:'other',text:'歌',start:8,end:12,noteIds:['b'],source:'manual',reviewed:true}]});
test('pointer mapping follows unequal rows, scale and a grabbed continuation fragment',()=>{
 const g={starts:[0,8,16,24],ys:[80,180,260],left:20,zoom:30};
 assert.equal(pointerBeat(80,181,g,1),9);assert.equal(pointerBeat(50,261,g,0),17);assert.equal(pointerBeat(35,181,g,8.5),0);assert.equal(shortcutAction({key:'f'}),'marquee');
});
test('moves jump past old neighbours and preserve note ID and duration',()=>{
 const p=fixture(),move={...p.notes[0],start:24},r=placeMovedNotes(p,[move]);assert.equal(r.collisions.length,0);assert.equal(r.project.notes.find(n=>n.id==='a').duration,2);assert.equal(p.notes[0].start,0);
});
test('collision preview is non-mutating; confirmation clips only actual covered intervals and maintains lyric links',()=>{
 const p=fixture(),move={...p.notes[0],start:9};assert.equal(placeMovedNotes(p,[move]).project,null);
 const r=placeMovedNotes(p,[move],{overwrite:true,idFactory:()=> 'tail'});assert.deepEqual(r.project.notes.map(n=>[n.id,n.start,n.duration]),[['b',8,1],['a',9,2],['tail',11,1],['c',16,1]]);
 assert.deepEqual(r.project.lyrics.find(t=>t.id==='other').noteIds,['b','tail']);assert.equal(p.notes.length,3);
});
test('fully overwritten note leaves text unassigned, while group gaps stay untouched',()=>{
 const p=fixture(),r=placeMovedNotes(p,[{...p.notes[0],start:8,duration:4}],{overwrite:true});assert.deepEqual(r.project.lyrics.find(t=>t.id==='other').noteIds,[]);assert.equal(r.project.lyrics.find(t=>t.id==='other').text,'歌');
 const gap=validateProject({...p,notes:[...p.notes,{id:'gap',start:5,duration:1,midi:65}]});const group=placeMovedNotes(gap,[{...p.notes[0],start:3,duration:1},{...p.notes[2],start:7}],{overwrite:true});assert.ok(group.project.notes.some(n=>n.id==='gap'));
});
test('mixed copy and paste preserve timing and only rebuild associations inside the copied selection',()=>{
 const p=fixture(),clip=copyScoreSelection(p,new Set(['a']),new Set(['word','other']));let id=0;
 const r=pasteScoreSelection(p,clip,24,{idFactory:()=> 'fresh-'+(++id)});
 assert.equal(r.project.notes.find(n=>n.id===r.noteIds[0]).start,24);assert.equal(r.project.lyrics.find(t=>t.id===r.lyricIds[0]).end,26);
 assert.deepEqual(r.project.lyrics.find(t=>t.id===r.lyricIds[0]).noteIds,r.noteIds);assert.deepEqual(r.project.lyrics.find(t=>t.id===r.lyricIds[1]).noteIds,[]);
 assert.equal(clip.notes[0].id,'a');assert.equal(p.notes.length,3);assert.equal(validateProject(JSON.parse(JSON.stringify(r.project))).lyrics.length,4);
});
test('mixed paste is atomic on lyrics conflict and keeps second durations across nonlinear mapping',()=>{
 const p=fixture();p.timeAnchors=[{beat:0,second:0},{beat:8,second:16},{beat:24,second:24}];
 const clip=copyScoreSelection(p,new Set(['a']),new Set(['word']));assert.throws(()=>pasteScoreSelection(p,clip,0,{overwriteNotes:true}),/歌词/);assert.equal(p.notes[0].duration,2);
 let id=0;const r=pasteScoreSelection(p,clip,24,{idFactory:()=> 'new-'+(++id)});const token=r.project.lyrics.find(t=>t.id===r.lyricIds[0]);assert.equal(token.end-token.start,2);assert.equal(r.project.notes.find(n=>n.id===r.noteIds[0]).duration,2);
});
test('linked collision can be previewed then resolved; default linked validation remains strict',()=>{
 const p=fixture();assert.throws(()=>retimeAssociated(p,{kind:'note',id:'a',start:9,end:11,maxSeconds:30}),/重叠/);
 const candidate=retimeAssociated(p,{kind:'note',id:'a',start:9,end:11,maxSeconds:30,validate:false}).project;
 const moved=candidate.notes.filter(n=>n.id==='a'),r=placeMovedNotes({...candidate,notes:p.notes},moved,{overwrite:true,idFactory:()=> 'end'});assert.equal(r.project.lyrics[0].start,9);assert.equal(r.project.lyrics[0].end,11);
});

test('mixed selection moves non-adjacent notes and words together, leaving others untouched',()=>{
 const p=fixture(),group={noteIds:new Set(['a','b']),lyricIds:new Set(['word','other'])};
 const next=moveScoreSelection(p,group,{from:8,to:32});
 const moved=placeMovedNotes(next,next.notes.filter(n=>group.noteIds.has(n.id))).project;
 assert.deepEqual(moved.notes.map(n=>[n.id,n.start,n.duration]),[['c',16,1],['a',24,2],['b',32,4]]);
 assert.deepEqual(moved.lyrics.map(t=>[t.id,t.start,t.end,t.noteIds]),[['word',24,26,['a']],['other',32,36,['b']]]);
 assert.equal(p.notes[0].start,0);assert.equal(p.lyrics[0].start,0);
});

test('group movement preserves independent lyric seconds and note beats under nonlinear mapping',()=>{
 const p=fixture();p.timeAnchors=[{beat:0,second:0},{beat:8,second:16},{beat:24,second:24}];
 const group={noteIds:new Set(['a','b']),lyricIds:new Set(['word'])};
 const next=moveScoreSelection(p,group,{from:8,to:16});
 assert.deepEqual(next.notes.map(n=>[n.start,n.duration]),[[8,2],[16,4],[16,1]]);
 assert.equal(next.lyrics[0].start,4);assert.equal(next.lyrics[0].end,6);
 assert.deepEqual(next.lyrics[0].noteIds,['a']);assert.deepEqual(next.lyrics[1],p.lyrics[1]);
 assert.ok(placeMovedNotes(next,next.notes.filter(n=>group.noteIds.has(n.id))).collisions.length);
});

test('moving from a later selected item rejects earliest-item underflow and any bound violation atomically',()=>{
 const p=fixture(),before=JSON.stringify(p),group={noteIds:new Set(['a','b']),lyricIds:new Set(['word'])};
 assert.throws(()=>moveScoreSelection(p,group,{from:8,to:7}),/整组/);
 assert.throws(()=>moveScoreSelection(p,group,{from:0,to:24,maxSeconds:20}),/整组/);
 assert.equal(JSON.stringify(p),before);
});

test('lyric-only group drag keeps note positions and IDs unchanged',()=>{
 const p=fixture(),next=moveScoreSelection(p,{noteIds:new Set(),lyricIds:new Set(['word','other'])},{from:0,to:24});
 assert.deepEqual(next.notes,p.notes);assert.deepEqual(next.lyrics.map(t=>[t.start,t.end]),[[24,26],[32,36]]);
 assert.deepEqual(next.lyrics.map(t=>t.noteIds),[['a'],['b']]);
});
