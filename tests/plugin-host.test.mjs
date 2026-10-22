import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {invokePlugin} from '../src/plugin-host.mjs';
test('an installed plugin cannot forward the request body through an HTTP redirect',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jianpu-plugin-redirect-'));let forwarded=0;
 const target=http.createServer((req,res)=>{forwarded++;res.end('{}');});await new Promise(r=>target.listen(0,'127.0.0.1',r));
 const plugin=http.createServer((req,res)=>{res.writeHead(307,{Location:`http://127.0.0.1:${target.address().port}/invoke`});res.end();});await new Promise(r=>plugin.listen(0,'127.0.0.1',r));
 try{
  await writeFile(path.join(dir,'test.json'),JSON.stringify({id:'test',name:'Test',port:plugin.address().port}));
  await assert.rejects(invokePlugin(dir,'test',{action:'test'}));assert.equal(forwarded,0);
 }finally{await Promise.all([plugin,target].map(s=>new Promise(r=>s.close(r))));await rm(dir,{recursive:true,force:true});}
});
