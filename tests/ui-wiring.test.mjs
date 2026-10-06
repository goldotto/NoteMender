import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('all editor controls used by the app exist in the page',()=>{
  const app=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../public/editor-ui.mjs',import.meta.url),'utf8');
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g),...app.matchAll(/id=\\?"([^"\\]+)\\?"/g),...layout.matchAll(/id="([^"]+)"/g),...layout.matchAll(/\.id='([^']+)'/g)].map(m=>m[1]));
  const refs=new Set([...app.matchAll(/\$\('([^']+)'\)/g),...app.matchAll(/(?<![\w])on\('([^']+)'/g)].map(m=>m[1]));
  assert.deepEqual([...refs].filter(id=>!ids.has(id)),[]);
});
