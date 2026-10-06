import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {localBuildResolver} from '../scripts/build-resolver.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('offline playback bundle resolves import-only SoundTouch dependencies inside the project',async()=>{
 const result=await build({stdin:{contents:"export {SoundTouchNode} from '@soundtouchjs/audio-worklet'; export {SoundTouch} from '@soundtouchjs/core';",resolveDir:root},plugins:[localBuildResolver(root)],tsconfigRaw:{},absWorkingDir:root,bundle:true,format:'esm',platform:'browser',write:false});
 assert.equal(result.errors.length,0);assert.match(result.outputFiles[0].text,/SoundTouchNode/);assert.doesNotMatch(result.outputFiles[0].text,/from ["']@soundtouchjs/);
});
test('built-in manual matches the source and documents linked editing as opt-in',async()=>{
 const source=await readFile(new URL('../说明书.txt',import.meta.url),'utf8'),served=await readFile(new URL('../public/manual.txt',import.meta.url),'utf8');
 assert.equal(served,source);assert.match(source,/共用同一设置，默认关闭/);
});
