import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {sha256} from '../src/update-security.mjs';
import {inspectBrowserModel,browserModelDirectory} from '../src/browser-model.mjs';
import {saveComponentConfig} from '../src/component-config.mjs';
import {orderedComponents} from '../public/component-catalog.mjs';
import {updateIndexes,packageSources} from '../src/update-sources.mjs';

test('lite has an editing core without implicit analysis dependencies',async()=>{
 const list=JSON.parse(await readFile(new URL('../scripts/public-files.json',import.meta.url)));
 assert.ok(!list.some(x=>x.startsWith('public/models/')||x.startsWith('runtime/')));
 assert.ok(list.includes('public/soundfonts/flute-mp3.js'));
 assert.deepEqual(orderedComponents(['cpu']),['python','basic','cpu']);
 assert.deepEqual(orderedComponents(['lyrics']),['python','audio-env','lyrics']);
 assert.ok(!orderedComponents(['gpu']).includes('audio-env'));
});
test('browser analysis is missing without actual files; hashes validate reuse and owned model priority',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'editions 中文 空格-'));
 try{
  const data=Buffer.from('test model'),spec={files:[{file:'model.json',size:data.length,sha256:sha256(data)}]};
  await mkdir(path.join(root,'scripts'));await writeFile(path.join(root,'scripts/browser-model-manifest.json'),JSON.stringify(spec));
  assert.equal((await inspectBrowserModel(root,{directory:path.join(root,'missing')})).ready,false);
  const external=path.join(root,'existing');await mkdir(external);await writeFile(path.join(external,'model.json'),data);
  await saveComponentConfig(root,{bindings:{basic:{directory:external}}});assert.equal(await browserModelDirectory(root),external);assert.equal((await inspectBrowserModel(root,{directory:external})).ready,true);
  await writeFile(path.join(external,'model.json'),'corrupt');assert.equal((await inspectBrowserModel(root,{directory:external})).ready,false);
  const own=path.join(root,'runtime/models/browser-basic-pitch');await mkdir(own,{recursive:true});await writeFile(path.join(own,'model.json'),data);assert.equal(await browserModelDirectory(root),own);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('source preference cannot invent a domestic URL or bypass host restrictions',()=>{
 const config={domesticIndex:null,githubIndex:'https://raw.githubusercontent.com/a/b/main/index.json'};
 assert.equal(updateIndexes(config)[0].id,'github');assert.throws(()=>updateIndexes(config,'domestic'),/尚未配置/);
 assert.throws(()=>updateIndexes({...config,domesticIndex:'https://evil.test/file'}));
 assert.throws(()=>packageSources({package:{url:'https://github.com/a/b/releases/download/v/x'}},'domestic'));
});

test('installer excludes only top-level runtime, never licenses/runtime',async()=>{
 const script=await readFile(new URL('../scripts/installer.iss',import.meta.url),'utf8');
 assert.ok(script.includes('Excludes: "\\runtime\\*"'));assert.ok(script.includes('uninsneveruninstall'));assert.ok(script.includes('ServiceRunning()'));
});
