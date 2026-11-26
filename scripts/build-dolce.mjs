// Explicit maintainer rebuild. Normal offline builds use the checked-in bundle.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const commit='6b1d3fc663f25e00eee64a99f614ce4b5ac9666c';
const source=path.resolve(process.argv[2]||'');
if(!process.argv[2]||execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==commit)throw Error('Provide the pinned Dolce checkout. See licenses/Dolce-NOTICE.txt.');
const modules={layoutJianpu:'layout/jianpu/compose/index.ts',renderPageSvg:'layout/render.ts',defaultJianpuStyle:'style/jianpudefault.ts',setMeasureBackend:'common/measure.ts',browserMeasure:'common/measure.browser.ts',MetaData:'smufl/smufl.ts'};
const contents=Object.entries(modules).map(([name,file])=>`export {${name}} from ${JSON.stringify('./src/'+file)};`).join('\n');
await mkdir('public/vendor',{recursive:true});
const license=await readFile(path.join(source,'LICENSE'),'utf8');
await build({stdin:{contents,resolveDir:source},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',outfile:'public/vendor/dolce.js',banner:{js:`/*! Dolce ${commit}, MIT, copyright 2026 lodebar2026. See licenses/Dolce-NOTICE.txt. */`}});
await writeFile('licenses/Dolce-LICENSE.txt',license);
