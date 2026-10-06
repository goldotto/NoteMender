import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
await mkdir('licenses',{recursive:true});const packages=[];
for(const name of await readdir('node_modules')){if(name.startsWith('.'))continue;if(name.startsWith('@'))for(const sub of await readdir('node_modules/'+name))packages.push(name+'/'+sub);else packages.push(name);}
let notice='# Bundled third-party software\n\nOriginal license texts are preserved beside this file. Runtime bundles and model assets retain upstream copyright.\n\n';
for(const pkg of packages){const dir=path.join('node_modules',pkg);try{const meta=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));notice+=`- ${meta.name} ${meta.version} — ${typeof meta.license==='string'?meta.license:JSON.stringify(meta.license||'see upstream')}\n`;for(const file of await readdir(dir))if(/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file)){try{await writeFile(path.join('licenses',pkg.replace(/[@/]/g,'_')+'-'+file),await readFile(path.join(dir,file)));}catch{}}}catch{}}
notice+='\n'+await readFile('licenses/COMPONENT_SOURCES.md','utf8');
await writeFile('licenses/THIRD_PARTY_NOTICES.md',notice);
console.log('Third-party notices collected.');
