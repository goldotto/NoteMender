import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

test('public package includes every Python adapter called by its services',async()=>{
  const root=new URL('../',import.meta.url),manifest=JSON.parse(await readFile(new URL('scripts/public-files.json',root),'utf8'));
  assert.ok(manifest.includes('scripts/nagisa_windows_compat.py'),'Qwen Windows path compatibility helper absent from manifest');
  for(const service of ['lyrics-service','singing-service','native-analysis','separation','decode']){
    const source=await readFile(new URL(`src/${service}.mjs`,root),'utf8');
    for(const match of source.matchAll(/['"]([a-z_]+\.py)['"]/g)){
      if(match[1]==='__init__.py')continue; // Package readiness check, not an executable adapter.
      const file='scripts/'+match[1];assert.ok(manifest.includes(file),`${service}: ${file} absent from manifest`);await access(new URL(file,root));
    }
  }
});
