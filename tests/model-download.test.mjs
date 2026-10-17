import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import os from 'node:os';import path from 'node:path';
import {ensurePinnedFile,modelReuseCandidates} from '../scripts/download-model.mjs';
const data=Buffer.from('fixed-model'),spec={size:data.length,sha256:createHash('sha256').update(data).digest('hex')};
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'notemender-download-'));try{await fn(root,path.join(root,'model.bin'));}finally{await rm(root,{recursive:true,force:true});}}
const noNetwork=async()=>{throw Error('must not download');};
test('reuse verifies bound environment model and never downloads again',()=>fixture(async(root,target)=>{
  const home=path.join(root,'existing');await mkdir(home);const source=path.join(home,'model.bin');await writeFile(source,data);
  await mkdir(path.join(root,'runtime'));await writeFile(path.join(root,'runtime/component-settings.json'),JSON.stringify({bindings:{audio:{modelHome:home}}}));
  assert.deepEqual(await modelReuseCandidates(root,'model.bin',{}),[source]);await ensurePinnedFile({target,spec,candidates:[source],run:noNetwork,log:()=>{}});assert.deepEqual(await readFile(target),data);
}));
test('completed partial files are promoted without HTTP range request',()=>fixture(async(root,target)=>{await writeFile(target+'.part',data);await ensurePinnedFile({target,spec,run:noNetwork});assert.deepEqual(await readFile(target),data);}));
test('bad hashes switch source; unsupported resume retries once from start',()=>fixture(async(root,target)=>{
  let calls=[];const run=async(cmd,args)=>{calls.push(args);const partial=args[args.indexOf('--output')+1];if(calls.length===1){await writeFile(partial,'corrupt');return {code:0};}if(calls.length===2)return {code:33,stderr:'range unsupported'};await writeFile(partial,data);return {code:0};};
  await ensurePinnedFile({target,spec,urls:['https://first.test/model','https://second.test/model'],run,log:()=>{}});assert.equal(calls.length,3);assert.ok(calls[1].includes('--continue-at'));assert.ok(!calls[2].includes('--continue-at'));assert.deepEqual(await readFile(target),data);
}));
test('network failure preserves incomplete progress with useful retry error',()=>fixture(async(root,target)=>{
  await writeFile(target+'.part','part');await assert.rejects(ensurePinnedFile({target,spec,urls:['https://source.test/model'],run:async()=>({code:28,stderr:'timeout'}),log:()=>{}}),/进度已保留.*\nsource.test/);assert.equal(await readFile(target+'.part','utf8'),'part');
}));
