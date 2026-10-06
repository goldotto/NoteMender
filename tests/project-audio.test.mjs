import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectAudioRestore} from '../public/project-audio.mjs';
test('opening a resource-less or missing-audio project clears the previous song',async()=>{
 let audio='previous',error;const restorer=new ProjectAudioRestore({load:async()=>{throw Error('missing');},reset:()=>audio=null,apply:b=>audio=b,onError:e=>error=e});
 await restorer.restore({audioResources:[]});assert.equal(audio,null);
 audio='previous';await restorer.restore({audioResources:[{source:'original',id:'missing'}]});assert.equal(audio,null);assert.equal(error.message,'missing');
});
test('late success and errors cannot replace a newer project or a manually loaded song',async()=>{
 const pending=new Map();let audio,errors=[];
 const restorer=new ProjectAudioRestore({load:r=>new Promise((resolve,reject)=>pending.set(r.id,{resolve,reject})),reset:()=>audio=null,apply:b=>audio=b,onError:e=>errors.push(e)});
 const a=restorer.restore({audioResources:[{source:'original',id:'a'}]}),b=restorer.restore({audioResources:[{source:'original',id:'b'}]});
 pending.get('b').resolve('B');await b;pending.get('a').resolve('A');await a;assert.equal(audio,'B');
 const c=restorer.restore({audioResources:[{source:'original',id:'c'}]});restorer.invalidate();audio='manual';pending.get('c').reject(Error('old error'));await c;assert.equal(audio,'manual');assert.equal(errors.length,0);
});
