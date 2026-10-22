import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {saveAudioResource,audioResourceService} from '../src/audio-resources.mjs';
test('audio resources deduplicate, survive service restart, and reject unauthenticated/traversal requests',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jianpu-assets-')),wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
  try{
    const metadata={source:'piano',audioStart:10,audioEnd:14,model:'htdemucs_6s'},a=await saveAudioResource(root,wav,metadata),b=await saveAudioResource(root,wav,metadata);assert.equal(a.id,b.id);
    const handler=audioResourceService(root);async function get(route,auth){const req=Readable.from([]);req.method='GET';req.headers={'x-studio-token':auth};let response;await handler(req,{},new URL('http://localhost'+route),(status,body)=>response={status,body},'token');return response;}
    assert.equal((await get('/api/resources/audio/'+a.id,'wrong')).status,403);
    assert.deepEqual((await get('/api/resources/audio/'+a.id,'token')).body,wav);
    assert.equal((await get('/api/resources/audio/'+'b'.repeat(64),'token')).status,404);
    await assert.rejects(saveAudioResource(root,wav,{...metadata,audioStart:-1}));
  }finally{await rm(root,{recursive:true,force:true});}
});
