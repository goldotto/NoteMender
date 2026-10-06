import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exportName,isExportFilename,isExportPath,importedProjectStem} from '../public/export-name.mjs';
import {makeDemo,freeScoreSVG} from '../public/music.mjs';
import {createApp} from '../server.mjs';

test('readable custom names are safe on Windows and old project names remain usable',()=>{
  assert.equal(exportName('主歌 - 已校对'),'主歌 - 已校对.json');
  assert.equal(exportName('工程.JSON'),'工程.json');
  assert.equal(exportName(''),'未命名工程.json');
  assert.equal(exportName('CON'),'_CON.json');
  assert.equal(exportName('../别处:工程'),'_别处_工程.json');
  assert.equal(exportName('曲名.  '),'曲名.json');
  assert.equal(importedProjectStem('1759800000000-ab12cd34-旧工程.json'),'旧工程');
  for(const name of ['歌曲','中文😀','CON','../foo','...','NUL.test'])assert.ok(isExportFilename(exportName(name)));
  assert.ok(isExportPath('/exports/'+encodeURIComponent('新工程 (2).json')));
  assert.ok(isExportPath('/exports/1759800000000-ab12cd34-旧工程.json'));
  for(const value of ['/exports/../server.mjs','/exports/%2e%2e%2fprivate.json','/exports/CON.json','/exports/bad%00.json','https://evil.test/exports/工程.json','/exports/bad%'])assert.equal(isExportPath(value),false);
});

test('simultaneous saves keep custom names and every previous version; old export links still work',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'studio-export-name-'));
  const app=createApp({exportDirectory:directory});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  try{
    const base=`http://127.0.0.1:${app.address().port}`,{token}=await(await fetch(base+'/api/status')).json();
    const outputs=await Promise.all(['first','second','third'].map(async body=>{
      const response=await fetch(base+'/api/export-file?name='+encodeURIComponent('听审笔记.json'),{method:'POST',headers:{'x-studio-token':token},body});
      assert.equal(response.status,200);const out=await response.json();assert.equal(await(await fetch(base+out.url)).text(),body);return out;
    }));
    assert.deepEqual(outputs.map(o=>o.filename).sort(),['听审笔记 (2).json','听审笔记 (3).json','听审笔记.json'].sort());
    assert.equal(new Set(await Promise.all(outputs.map(o=>readFile(path.join(directory,o.filename),'utf8')))).size,3);
    const old='1759800000000-ab12cd34-旧工程.json';await writeFile(path.join(directory,old),'old');assert.equal(await(await fetch(base+'/exports/'+encodeURIComponent(old))).text(),'old');
    assert.equal((await fetch(base+'/exports/CON.json')).status,404);
    assert.equal((await fetch(base+'/exports/'+encodeURIComponent('..\\private.json'))).status,404);
  }finally{await new Promise(r=>app.close(r));await rm(directory,{recursive:true,force:true});}
});

test('notes and lyric bars keep accessible labels without hover tooltips',()=>{
  const project=makeDemo();project.lyrics=[{id:'word',text:'听',start:0,end:.5,noteIds:[project.notes[0].id],reviewed:true}];
  const svg=freeScoreSVG(project);
  assert.match(svg,/data-note=/);assert.match(svg,/data-lyric=/);assert.match(svg,/aria-label="歌词：听"/);assert.doesNotMatch(svg,/<title>/);
});
