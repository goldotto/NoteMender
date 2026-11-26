import {build} from 'esbuild';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localBuildResolver} from './scripts/build-resolver.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
await mkdir('public/vendor',{recursive:true});
await mkdir('licenses',{recursive:true});
await cp('说明书.txt','public/manual.txt');
await build({stdin:{contents:"export {strToU8,zipSync} from 'fflate';",resolveDir:root},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'public/vendor/scoredesk-zip.js',minify:true,legalComments:'eof'});
await cp('node_modules/fflate/LICENSE','licenses/fflate-LICENSE.txt');
await build({entryPoints:[path.join(root,'src/worker.mjs')],plugins:[localBuildResolver(root)],tsconfigRaw:{},absWorkingDir:root,bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'public/vendor/worker.js',minify:true,legalComments:'eof'});
await build({stdin:{contents:"export {Midi} from '@tonejs/midi';",resolveDir:root},plugins:[localBuildResolver(root)],tsconfigRaw:{},absWorkingDir:root,bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'public/vendor/midi.js',minify:true,legalComments:'eof'});
await build({stdin:{contents:"export {Accidental,Annotation,Articulation,BarlineType,Beam,Dot,Formatter,ModifierPosition,Renderer,Stave,StaveNote,StaveTie,VexFlow,Voice} from 'vexflow/core';",resolveDir:root},
  tsconfigRaw:{},absWorkingDir:root,bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'public/vendor/vexflow.js',minify:true,legalComments:'eof'});
await build({stdin:{contents:"export {default as Kuroshiro} from 'kuroshiro'; export {default as KuromojiAnalyzer} from 'kuroshiro-analyzer-kuromoji';",resolveDir:root},
  alias:{path:'path-browserify'},tsconfigRaw:{},absWorkingDir:root,bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'public/vendor/lyric-romaji.js',minify:true,legalComments:'eof'});
await cp('node_modules/kuromoji/dict','public/vendor/romaji-dict',{recursive:true});
for(const [pkg,file,target] of [
  ['kuroshiro','LICENSE','Kuroshiro-LICENSE.txt'],
  ['kuroshiro-analyzer-kuromoji','LICENSE','Kuroshiro-Kuromoji-Analyzer-LICENSE.txt'],
  ['kuromoji','LICENSE-2.0.txt','Kuromoji-LICENSE.txt'],
  ['kuromoji','NOTICE.md','Kuromoji-IPADIC-NOTICE.txt'],
  ['async','LICENSE','async-LICENSE.txt'],
  ['doublearray','LICENSE.txt','doublearray-LICENSE.txt'],
  ['path-browserify','LICENSE','path-browserify-LICENSE.txt'],
  ['lodash','LICENSE','lodash-LICENSE.txt'],
  ['zlibjs','LICENSE','zlibjs-LICENSE.txt']
]){
  await cp('node_modules/'+pkg+'/'+file,'licenses/'+target);
}
await cp('node_modules/@spotify/basic-pitch/model','public/models/basic-pitch',{recursive:true});
for(const [pkg,file] of [['@spotify/basic-pitch','LICENSE'],['@tensorflow/tfjs','LICENSE'],['@tonejs/midi','LICENSE']]){
  try{await writeFile(`licenses/${pkg.replace(/[@/]/g,'_')}.txt`,await readFile(`node_modules/${pkg}/${file}`));}catch{}
}
console.log('前端离线依赖已构建；开发用模型仍在原位置，分发由版本清单单独选择。');

await import('./scripts/build-slow-audio.mjs');
