import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('release downloader verifies local parts and refuses missing, damaged and unsafe entries without networking',{skip:process.platform!=='win32'},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'NoteMender 分片 '));
  const script=fileURLToPath(new URL('../Download-Release-Parts.ps1',import.meta.url));
  const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const data=Buffer.from('valid local test part'),name='NoteMender-2.5.0-demo.7-windows-offline.zip.001';
  const original={version:'2.5.0-demo.7',archive:'NoteMender-2.5.0-demo.7-windows-offline.zip',bytes:data.length,parts:[{name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}]};
  const run=()=>spawnSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Destination',directory,'-VerifyOnly'],{encoding:'utf8',timeout:15000,windowsHide:true});
  const save=record=>writeFile(path.join(directory,'offline-manifest.json'),JSON.stringify(record));
  try{
    await save(original);await writeFile(path.join(directory,name),data);
    await writeFile(path.join(directory,'Extract-NoteMender.ps1'),'test-only helper');await writeFile(path.join(directory,'Extract-NoteMender.cmd'),'test-only helper');
    const valid=run();assert.equal(valid.status,0,valid.stderr);
    await writeFile(path.join(directory,name),'damaged');assert.notEqual(run().status,0);
    await rm(path.join(directory,name));assert.notEqual(run().status,0);
    await save({...original,parts:[{...original.parts[0],name:'../outside.zip.001'}]});assert.notEqual(run().status,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});
