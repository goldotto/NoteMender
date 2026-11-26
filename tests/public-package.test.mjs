import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,readdir} from 'node:fs/promises';

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

test('public manifest ships every Python adapter and no private runtime data',async()=>{
  const root=new URL('../',import.meta.url),manifest=JSON.parse(await readFile(new URL('scripts/public-files.json',root),'utf8'));
  const adapters=(await readdir(new URL('scripts/',root))).filter(name=>name.endsWith('.py'));
  assert.ok(adapters.length>0,'Python adapters not found next to the manifest');
  // A Python adapter that is called at runtime but missing from the manifest makes
  // the published package fail only on a user machine, so the whole folder is checked.
  for(const name of adapters)assert.ok(manifest.includes('scripts/'+name),`scripts/${name} absent from manifest`);
  assert.ok(manifest.includes('tests/i18n-coverage.test.mjs'),'i18n coverage test absent from manifest, so the published package loses that guard');
  assert.deepEqual(manifest.filter(file=>file.startsWith('runtime/')),[],'runtime data must never be published');
  // Match whole path segments: scripts/compute-qualification.json is a deliberate
  // build input, while qualification.json and component-settings.json are private
  // machine state that would leak component paths and versions.
  const privateFile=file=>/(^|\/)(component-settings|qualification)\.json$/.test(file);
  assert.deepEqual(manifest.filter(privateFile),[],'private settings must never be published');
});
