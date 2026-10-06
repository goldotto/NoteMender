import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {accelerationEnv} from '../src/compute-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=await accelerationEnv(root,'cuda');
async function run(command,args,env={}){await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:'inherit',env:{...runtime.env,...env}});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('安装步骤失败，退出码 '+code)));});}
async function fingerprint(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function download(url,file){try{await access(file);return;}catch{}await run('curl.exe',['--fail','--location','--retry','2','--connect-timeout','20','--max-time','900','--output',file+'.part',url]);await run(runtime.python,['-c','from pathlib import Path; import sys; Path(sys.argv[1]).replace(sys.argv[2])',file+'.part',file]);}
if(process.argv.includes('--six')||!process.argv.includes('--singing'))await run(runtime.python,[path.join(root,'scripts/separate.py'),'--prepare'],{JIANPU_SEPARATION_MODEL:'htdemucs_6s'});
if(process.argv.includes('--singing')){
  const directory=path.join(root,'runtime/singing'),deps=path.join(directory,'dependencies');await mkdir(directory,{recursive:true});
  const archive=path.join(directory,'ROSVOT.zip');await download('https://codeload.github.com/RickyL-2000/ROSVOT/zip/refs/heads/main',archive);
  await run(runtime.python,[path.join(root,'scripts/extract-candidate-archive.py'),archive,path.join(directory,'ROSVOT'),'--strip-root']);
  const env={PYTHONPATH:[deps,runtime.env.PYTHONPATH].filter(Boolean).join(path.delimiter)};
  const requirements=['pretty_midi==0.2.10','pyworld==0.3.5','matplotlib==3.9.4','pyyaml==6.0.2','einops==0.8.1','gdown==5.2.0','beautifulsoup4==4.13.4','soupsieve==2.7','mido==1.3.3','six==1.17.0','filelock==3.18.0','requests==2.32.3','pillow==11.2.1','contourpy==1.3.2','cycler==0.12.1','fonttools==4.58.5','kiwisolver==1.4.8','pyparsing==3.2.3','python-dateutil==2.9.0.post0'];
  // Reuse the existing CUDA/Python runtime; dependencies stay inside this optional directory.
  let installed=false;try{await run(runtime.python,['-c',"import importlib.metadata as m,sys; assert all(m.version(x.split('==')[0].replace('pyyaml','PyYAML'))==x.split('==')[1] for x in sys.argv[1:])",...requirements],env);installed=true;}catch{}
  for(const index of ['https://pypi.tuna.tsinghua.edu.cn/simple','https://pypi.org/simple'])if(!installed)try{await run(runtime.python,['-m','pip','install','--target',deps,'--no-deps','--index-url',index,...requirements],env);installed=true;break;}catch(e){console.error(e.message);}if(!installed)throw Error('可选人声依赖下载失败');
  const supplied=process.argv.find(a=>a.startsWith('--checkpoints='))?.slice('--checkpoints='.length),checkpointZip=supplied||path.join(directory,'checkpoints.zip');
  if(!supplied)try{await access(checkpointZip);}catch{await run(runtime.python,['-m','gdown','1JNtNT37KiLq9uFQqHk7JFs-3trxd3bRh','-O',checkpointZip],env);}
  await run(runtime.python,[path.join(root,'scripts/extract-candidate-archive.py'),checkpointZip,path.join(directory,'ROSVOT')]);
  const required=['rosvot/model.pt','rosvot/config.yaml','rwbd/model.pt','rwbd/config.yaml','rmvpe/model.pt'];for(const name of required)await access(path.join(directory,'ROSVOT/checkpoints',name));
  await run(runtime.python,['-c',"import wave,sys; f=wave.open(sys.argv[1],'wb'); f.setparams((1,2,22050,0,'NONE','not compressed')); f.writeframes(bytes(22050*2)); f.close()",path.join(directory,'smoke.wav')]);
  await run(runtime.python,[path.join(root,'scripts/singing_analysis.py'),path.join(directory,'smoke.wav'),path.join(directory,'smoke.json')],env);
  const fingerprints={source:await fingerprint(archive)};for(const name of required)fingerprints[name]=await fingerprint(path.join(directory,'ROSVOT/checkpoints',name));
  const report=JSON.parse(await readFile(path.join(directory,'smoke.json'),'utf8'));
  await writeFile(path.join(directory,'ready.json'),JSON.stringify({version:1,adapterVersion:1,model:'rosvot',device:'cuda',fingerprints,compute:report.compute,installedAt:new Date().toISOString()}));
}
console.log('候选组件安装完成。刷新页面后可使用。');
