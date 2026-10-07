import {readFile, mkdir, copyFile, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.argv[2];
if(!output)throw Error('Specify a new output directory: npm run package:public -- <directory>');
const target=path.resolve(output);
const inside=(base,file)=>{const rel=path.relative(base,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
if(target===root||inside(root,target))throw Error('Publication must be outside the working project.');
const files=JSON.parse(await readFile(path.join(root,'scripts/public-files.json'),'utf8'));
const excluded=new Set(['.git','runtime','exports','node_modules','.venv','__pycache__']);
const prepared=[];
for(const file of files){
 if(typeof file!=='string'||path.isAbsolute(file)||excluded.has(file.split(/[\\/]/)[0])||file.split(/[\\/]/).some(p=>p==='..'||p==='__pycache__'||p.startsWith('.env')))throw Error('Invalid public file path');
 const source=path.resolve(root,file),dest=path.resolve(target,file);
 if(!inside(root,source)||!inside(target,dest)||(await lstat(source)).isSymbolicLink()||!inside(root,await realpath(source)))throw Error('Unsafe source path');
 prepared.push({source,dest});
}
await mkdir(target); // Existing directories are deliberately never merged or overwritten.
for(const {source,dest} of prepared){await mkdir(path.dirname(dest),{recursive:true});await copyFile(source,dest);}
console.log('Public product snapshot prepared: '+prepared.length+' files.');
