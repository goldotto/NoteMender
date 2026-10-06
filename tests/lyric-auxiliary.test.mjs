import test from 'node:test';
import assert from 'node:assert/strict';
import {lyricSegmentationCandidates,useLyricSinging} from '../public/lyric-assist.mjs';
const events=[{start:0,end:2,midi:60,evidenceId:'held'}],words=[{id:'a',start:0,end:1,text:'啊'},{id:'b',start:1,end:2,text:'呀'}],evidence={onsets:[{second:1.03,confidence:.9}]};
test('automatic primary preserves every acoustic boundary; lyric splits are auxiliary',()=>{
 const result=lyricSegmentationCandidates(events,words,evidence);
 assert.deepEqual(result.primary,events);assert.equal(result.changed,false);assert.equal(result.auxiliary.events.length,2);assert.equal(result.auxiliary.changed,true);assert.deepEqual(result.lyrics.map(t=>t.evidenceIds),[['held'],['held']]);assert.equal(events[0].end,2);
});
test('explicit phrase resplitting previews the supported boundary with the original intact',()=>{
 const result=lyricSegmentationCandidates(events,words,evidence,{resplit:true});
 assert.equal(result.primary.length,2);assert.equal(result.changed,true);assert.deepEqual(result.primary.map(n=>n.midi),[60,60]);assert.equal(events.length,1);
});
test('high performance alone cannot enable the optional ROSVOT lyric candidate',()=>{
 const task={singingFine:false,execution:{mode:'performance',device:'cuda'}};
 assert.equal(useLyricSinging(task,{ready:true,hasWords:true}),false);
 assert.equal(useLyricSinging({...task,singingFine:true},{ready:true,hasWords:true}),true);
 assert.equal(useLyricSinging({...task,singingFine:true,execution:{device:'cpu'}},{ready:true,hasWords:true}),false);
});
