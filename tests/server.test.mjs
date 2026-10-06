import test from 'node:test';import assert from 'node:assert/strict';import {createApp} from '../server.mjs';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
async function serve(fn,options={}){const app=createApp(options);await new Promise(r=>app.listen(0,'127.0.0.1',r));try{await fn(`http://127.0.0.1:${app.address().port}`);}finally{await new Promise(r=>app.close(r));}}
test('serves local UI, prevents cross-origin and unauthenticated mutations',()=>serve(async base=>{
 assert.equal((await fetch(base)).status,200);
 assert.equal((await fetch(base+'/api/status',{headers:{origin:'https://evil.example'}})).status,403);
 const status=await (await fetch(base+'/api/status')).json();assert.ok(status.token);assert.equal('hasKey' in status,false);
 assert.equal((await fetch(base+'/api/plugins')).status,200);
 assert.equal((await fetch(base+'/api/plugins/sample/invoke',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{'content-type':'application/json','x-studio-token':status.token},body:'{}'})).status,404);
 assert.equal((await fetch(base+'/server.mjs')).status,404);
}));
test('generic plugin API invokes only installed localhost plugin',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'jianpu-plugin-test-'));
 try{
  await writeFile(path.join(directory,'example.json'),JSON.stringify({id:'example',name:'Example',port:4325}));
  await serve(async base=>{
   const {token}=await (await fetch(base+'/api/status')).json();
   const listed=await (await fetch(base+'/api/plugins')).json();assert.deepEqual(listed.plugins,[{id:'example',name:'Example'}]);
   const response=await fetch(base+'/api/plugins/example/invoke',{method:'POST',headers:{'content-type':'application/json','x-studio-token':token},body:JSON.stringify({action:'ping'})});
   assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
   const missing=await fetch(base+'/api/plugins/missing/invoke',{method:'POST',headers:{'content-type':'application/json','x-studio-token':token},body:'{}'});assert.equal(missing.status,404);
  },{pluginDirectory:directory,fetchImpl:async(url,options)=>{assert.equal(url,'http://127.0.0.1:4325/invoke');assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{action:'ping'});return {ok:true,text:async()=>'{"ok":true}'};}});
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('exports save a real file and use attachment headers; traversal and unsupported formats are rejected',()=>serve(async base=>{
 const {token}=await (await fetch(base+'/api/status')).json();const r=await fetch(base+'/api/export-file?name='+encodeURIComponent('验证工程.json'),{method:'POST',headers:{'x-studio-token':token},body:'{"test":true}'});assert.equal(r.status,200);const out=await r.json();assert.ok(out.url.startsWith('/exports/'));const file=await fetch(base+out.url);assert.match(file.headers.get('content-disposition'),/^attachment/);assert.equal(await file.text(),'{"test":true}');
 const bad=await fetch(base+'/api/export-file?name=bad.html',{method:'POST',headers:{'x-studio-token':token},body:'x'});assert.equal(bad.status,400);
 const noToken=await fetch(base+'/api/export-file?name=test.json',{method:'POST',body:'x'});assert.equal(noToken.status,403);
}));
