import {build} from 'esbuild';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localBuildResolver} from './scripts/build-resolver.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
await mkdir('public/vendor',{recursive:true});
await cp('说明书.txt','public/manual.txt');
await build({entryPoints:[path.join(root,'src/worker.mjs')],plugins:[localBuildResolver(root)],tsconfigRaw:{},absWorkingDir:root,bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'public/vendor/worker.js',minify:true,legalComments:'eof'});
await build({stdin:{contents:"export {Midi} from '@tonejs/midi';",resolveDir:root},plugins:[localBuildResolver(root)],tsconfigRaw:{},absWorkingDir:root,bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'public/vendor/midi.js',minify:true,legalComments:'eof'});
await cp('node_modules/@spotify/basic-pitch/model','public/models/basic-pitch',{recursive:true});
await mkdir('licenses',{recursive:true});
for(const [pkg,file] of [['@spotify/basic-pitch','LICENSE'],['pitchy','LICENSE'],['@tensorflow/tfjs','LICENSE'],['@tonejs/midi','LICENSE']]){
  try{await writeFile(`licenses/${pkg.replace(/[@/]/g,'_')}.txt`,await readFile(`node_modules/${pkg}/${file}`));}catch{}
}
console.log('离线依赖与模型已打包。');

await import('./scripts/build-slow-audio.mjs');
