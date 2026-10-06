import {spawn} from 'node:child_process';
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {accelerationEnv} from '../src/compute-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=await accelerationEnv(root,'auto');
const directory=path.join(root,'runtime/lyrics-qwen');await mkdir(directory,{recursive:true});
await new Promise((resolve,reject)=>{const child=spawn(runtime.python,[path.join(root,'scripts/install_qwen_lyrics.py'),root,...process.argv.slice(2)],{cwd:root,windowsHide:true,env:{...runtime.env,PYTHONPATH:[path.join(directory,'dependencies'),runtime.env.PYTHONPATH].filter(Boolean).join(path.delimiter)},stdio:'inherit'});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Qwen 歌词组件安装未完成，可重新运行续传')));});
console.log(process.argv.includes('--dependencies-only')?'歌词依赖已安装，模型尚需安装。':'歌词组件就绪，回到程序打开“歌词对照”。');
