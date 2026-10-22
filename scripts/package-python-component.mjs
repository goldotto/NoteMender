import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';import {execFileSync} from 'node:child_process';
import {makeZip} from '../src/update-zip.mjs';
import {sha256} from '../src/update-security.mjs';
const [input,output,specFile]=process.argv.slice(2);if(!input||!output||!specFile)throw Error('需要：已审核的 Python 目录、组件 ZIP 路径、组件描述路径');
const version=execFileSync(path.join(input,'python.exe'),['-c','import platform; print(platform.python_version())'],{encoding:'utf8',windowsHide:true}).trim();if(!/^3\.11\.\d+$/.test(version)||!path.basename(output).includes(version))throw Error('组件名称必须包含实际 Python 3.11 版本');
const files=[];
async function walk(dir,rel=''){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=path.posix.join(rel,entry.name);if(entry.isSymbolicLink())throw Error('解释器不允许目录链接');if(entry.isDirectory())await walk(path.join(dir,entry.name),name);else files.push({path:'public/python/'+name,data:await readFile(path.join(dir,entry.name))});}}
await walk(input);const zip=makeZip(files),file=path.basename(output);
await writeFile(output,zip,{flag:'wx'});
await writeFile(specFile,JSON.stringify({file,version,size:zip.length,sha256:sha256(zip),urls:[`https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/${file}`],files:files.map(f=>({path:f.path,size:f.data.length,sha256:sha256(f.data)}))},null,2)+'\n');
console.log(`已生成隔离解释器组件：${files.length} 文件，${(zip.length/1024/1024).toFixed(1)} MiB；尚未上传`);
