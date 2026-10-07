import test from 'node:test';
import assert from 'node:assert/strict';
import {listBackups,saveBackup,readBackup} from '../public/project-backups.mjs';
test('backup quota fallback retains old snapshots and restores disk references',async()=>{
  let stored=JSON.stringify([{at:'old',project:{title:'old',notes:[{id:'1'}]}}]);
  const storage={getItem:()=>stored,setItem:(key,value)=>{if(value.includes('"project"'))throw Error('quota');stored=value;}};
  const files=new Map();
  await saveBackup(storage,{title:'new',notes:[{id:'2'}]},async project=>{const url='/exports/'+project.title+'.json';files.set(url,project);return url;});
  const items=listBackups(storage);assert.equal(items.length,2);assert.equal(items[0].title,'old');
  assert.equal((await readBackup(items[1],url=>files.get(url))).notes[0].id,'2');
  const prior=stored;await assert.rejects(saveBackup(storage,{title:'failed',notes:[]},()=>{throw Error('disk full');}));assert.equal(stored,prior);
});
