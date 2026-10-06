import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProject,freeScoreSVG} from '../public/music.mjs';
import {splitNotesByLyrics} from '../public/lyric-note-split.mjs';
import {lyricLabels} from '../public/lyrics.mjs';
import {beatAtTime,timeAtBeat} from '../public/time-map.mjs';
import {projectText,parseProjectText} from '../public/project-file.mjs';
function fixture(){return validateProject({version:1,title:'歌词切分',bpm:60,key:0,notes:[{id:'long',start:0,duration:4,midi:63,lyric:''},{id:'outside',start:5,duration:1,midi:65,lyric:'保留'}],lyrics:['华','丽','的','诗','句'].map((text,i)=>({id:'w'+i,text,start:i*.8,end:(i+1)*.8,noteIds:['long'],source:'qwen',reviewed:false}))});}
test('fast words split one long note with pitch, endpoints and lyric seconds preserved',()=>{
 const p=fixture(),snapshot=structuredClone(p),r=splitNotesByLyrics(p,['long']);assert.equal(r.splitCount,1);assert.equal(r.addedCount,4);assert.equal(r.segments.length,5);
 assert.deepEqual(p,snapshot);assert.equal(r.segments[0].id,'long');assert.ok(r.segments.every(n=>n.midi===63&&n.reviewStatus==='pending'));assert.equal(r.segments[0].start,0);assert.equal(r.segments.at(-1).start+r.segments.at(-1).duration,4);assert.equal(r.segments.reduce((s,n)=>s+n.duration,0),4);
 assert.deepEqual(r.project.notes.at(-1),p.notes.at(-1));assert.deepEqual(r.project.lyrics.map(t=>[t.id,t.text,t.start,t.end]),p.lyrics.map(t=>[t.id,t.text,t.start,t.end]));assert.deepEqual([...lyricLabels(r.project).values()],['华','丽','的','诗','句','保留']);assert.ok(r.project.lyrics.every(t=>t.noteIds.length===1));
 assert.equal(parseProjectText(projectText(r.project)).notes.length,6);assert.match(freeScoreSVG(r.project),/华/);
});
test('unlinked timed lyrics work, non-linear mapping uses original seconds, and repeated splitting is a no-op',()=>{
 const p=fixture();p.timeAnchors=[{beat:0,second:2},{beat:2,second:3},{beat:6,second:7}];p.lyrics=p.lyrics.map((t,i)=>({...t,start:2+i*.6,end:2+(i+1)*.6,noteIds:[]}));
 const r=splitNotesByLyrics(p,['long']);assert.equal(r.segments[1].start,Math.round(beatAtTime(p,2.6)/.0625)*.0625);assert.equal(r.segments.at(-1).to,timeAtBeat(p,4));assert.equal(r.project.lyrics[1].start,2.6);
 assert.throws(()=>splitNotesByLyrics(r.project,r.ids),/没有可切分/);
});
test('short colliding word boundaries are reported; text and its remaining associations are never lost',()=>{
 const p=fixture();p.lyrics=[{id:'a',text:'很',start:0,end:.02,noteIds:['long']},{id:'b',text:'快',start:.02,end:1,noteIds:['long']},{id:'c',text:'句',start:1,end:4,noteIds:['long']}];
 const r=splitNotesByLyrics(p,['long']);assert.equal(r.segments.length,2);assert.ok(r.warnings.length);assert.equal(r.project.lyrics.length,3);assert.deepEqual(r.project.lyrics.map(t=>t.text),['很','快','句']);assert.deepEqual(r.project.lyrics[0].noteIds,[]);assert.ok(r.segments.every(n=>n.duration>=.0625));
});
test('one word spanning several notes remains a melisma and rests/unselected notes are untouched',()=>{
 const p=fixture();p.lyrics=[{id:'hold',text:'啊',start:0,end:6,noteIds:['long','outside']}];assert.throws(()=>splitNotesByLyrics(p,['long']),/没有可切分/);assert.throws(()=>splitNotesByLyrics(p,[]),/请先/);
 const r=splitNotesByLyrics(fixture(),['long','outside']);assert.ok(r.warnings.some(x=>/保持原样/.test(x)));assert.deepEqual(r.project.notes.at(-1),fixture().notes.at(-1));
});
