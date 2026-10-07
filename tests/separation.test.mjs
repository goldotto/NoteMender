import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {separationService} from '../src/separation.mjs';

test('standard and performance separation create jobs with a directory path and pass the selected Python environment',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jianpu-separation-')),runtime=path.join(root,'runtime');
  await mkdir(path.join(root,'.venv/Scripts'),{recursive:true});await writeFile(path.join(root,'.venv/Scripts/python.exe'),'');
  await mkdir(path.join(runtime,'acceleration/cpu'),{recursive:true});await writeFile(path.join(runtime,'demucs-ready.json'),'{}');await writeFile(path.join(runtime,'acceleration/cpu/ready.json'),'{}');
  await mkdir(path.join(runtime,'acceleration/cpu/onnxruntime'),{recursive:true});await writeFile(path.join(runtime,'acceleration/cpu/onnxruntime/__init__.py'),'');
  await mkdir(path.join(root,'scripts'));await writeFile(path.join(root,'scripts/component-models.json'),JSON.stringify({audio:{file:'fixture.th'}}));await mkdir(path.join(runtime,'models/hub/checkpoints'),{recursive:true});await writeFile(path.join(runtime,'models/hub/checkpoints/fixture.th'),'model');
  const calls=[],children=[];
  const handler=separationService(root,{spawnImpl:(python,args,options)=>{
    calls.push({python,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};children.push(child);return child;
  }});
  try{
    for(const mode of ['standard','performance']){
      const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
      const req=Readable.from([wav]);req.method='POST';req.headers={'x-studio-token':'token'};
      let response;await handler(req,{},new URL(`http://localhost/api/separation/start?compute=${mode}&device=cpu&threads=0`),(status,body)=>response={status,body},'token');
      assert.equal(response.status,202,JSON.stringify(response.body));
      const call=calls.at(-1),dir=path.dirname(call.args[1]);
      assert.equal(path.dirname(dir),runtime);assert.equal(call.options.env.TORCH_HOME,path.join(runtime,'models'));
      assert.deepEqual(await readFile(path.join(dir,'input.wav')),wav);
      assert.equal(JSON.parse(call.options.env.JIANPU_COMPUTE).mode,mode);
      if(mode==='performance')assert.ok(call.options.env.PYTHONPATH.includes(path.join(runtime,'acceleration/cpu')));
      children.at(-1).emit('close',0);
    }
    assert.equal(calls.length,2);
  }finally{handler.close();await rm(root,{recursive:true,force:true});}
});
