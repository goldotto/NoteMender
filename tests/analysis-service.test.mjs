import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {EVIDENCE_VERSION} from '../public/recognition-evidence.mjs';

test('evidence cache and audit persist across server restarts, authenticate and constrain keys',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jianpu-analysis-test-'));
  let auditId;
  async function serve(fn){const app=createApp({analysisRoot:root});await new Promise(r=>app.listen(0,'127.0.0.1',r));try{const base=`http://127.0.0.1:${app.address().port}`,{token}=await(await fetch(base+'/api/status')).json();await fn(base,{'X-Studio-Token':token,'Content-Type':'application/json'});}finally{await new Promise(r=>app.close(r));}}
  const value={version:EVIDENCE_VERSION,rawBasic:[{start:0,end:.05,midi:60}],pitchFrames:[]},key='a'.repeat(64);
  try{
    await serve(async(base,headers)=>{
      assert.equal((await fetch(base+'/api/analysis/cache/'+key)).status,403);
      assert.equal(await(await fetch(base+'/api/analysis/cache/'+key,{headers})).json(),null);
      assert.equal((await fetch(base+'/api/analysis/cache/'+key,{method:'PUT',headers,body:JSON.stringify(value)})).status,200);
      assert.equal((await fetch(base+'/api/analysis/cache/bad-key',{method:'PUT',headers,body:JSON.stringify(value)})).status,404);
      assert.equal((await fetch(base+'/api/analysis/cache/'+'b'.repeat(64),{method:'PUT',headers,body:'{}'})).status,400);
      const saved=await(await fetch(base+'/api/analysis/audits',{method:'POST',headers,body:JSON.stringify({version:2,events:[],windows:[{source:'vocals'}]})})).json();auditId=saved.id;assert.match(auditId,/^[a-f0-9-]{36}$/);
    });
    await serve(async(base,headers)=>{
      assert.deepEqual(await(await fetch(base+'/api/analysis/cache/'+key,{headers})).json(),value);
      const audit=await(await fetch(base+'/api/analysis/audits/'+auditId,{headers})).json();assert.equal(audit.windows[0].source,'vocals');
      assert.equal((await fetch(base+'/api/analysis/pitch?engine=remote',{method:'POST',headers,body:'x'})).status,400);
    });
  }finally{const target=path.resolve(root);assert.ok(target.startsWith(path.resolve(tmpdir())+path.sep));await rm(target,{recursive:true,force:true});}
});
