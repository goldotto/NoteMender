import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {buffer} from 'node:stream/consumers';
import {createHash} from 'node:crypto';
import {saveAudioResource,audioResourceService} from '../src/audio-resources.mjs';
test('audio resources deduplicate, survive service restart, and reject unauthenticated/traversal requests',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jianpu-assets-')),wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
  try{
    const metadata={source:'piano',audioStart:10,audioEnd:14,model:'htdemucs_6s'},a=await saveAudioResource(root,wav,metadata),b=await saveAudioResource(root,Readable.from([wav.subarray(0,9),wav.subarray(9)]),metadata);
    assert.equal(a.id,createHash('sha256').update(wav).update(JSON.stringify(metadata)).digest('hex'));
    assert.deepEqual(a,b);
    const handler=audioResourceService(root);async function get(route,auth){const req=Readable.from([]);req.method='GET';req.headers={'x-studio-token':auth};let response;await handler(req,{},new URL('http://localhost'+route),(status,body)=>response={status,body},'token');return response;}
    assert.equal((await get('/api/resources/audio/'+a.id,'wrong')).status,403);
    assert.deepEqual(await buffer((await get('/api/resources/audio/'+a.id,'token')).body),wav);
    assert.equal((await get('/api/resources/audio/'+'b'.repeat(64),'token')).status,404);
    await assert.rejects(saveAudioResource(root,wav,{...metadata,audioStart:-1}));
    await assert.rejects(saveAudioResource(root,Readable.from([wav,wav]),metadata,wav.length),{code:'AUDIO_TOO_LARGE'});
    await assert.rejects(saveAudioResource(root,Buffer.alloc(44),metadata),/需要 WAV/);
    assert.deepEqual(await readdir(path.join(root,'runtime','audio-resources')),[a.id]);
  }finally{await rm(root,{recursive:true,force:true});}
});
