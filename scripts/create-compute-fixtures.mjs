import {copyFile, mkdir, writeFile, access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'runtime/review-corpus');
await mkdir(output,{recursive:true});
let existing=false;try{await access(path.join(output,'manifest.json'));existing=true;}catch(e){if(e.code!=='ENOENT')throw e;}
if(existing)throw Error('A comparison manifest already exists; it was not overwritten.');
await copyFile(path.join(root,'examples/C大调音阶-120BPM.wav'),path.join(output,'synthetic-scale.wav'));
await writeFile(path.join(output,'manifest.json'),JSON.stringify({version:1,clips:[{id:'synthetic-scale',audio:'synthetic-scale.wav',kind:'synthetic'}]},null,2),{flag:'wx'});
console.log('Prepared synthetic backend comparison input. This is not a song-quality evaluation.');
