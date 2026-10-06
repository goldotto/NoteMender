import {spawn} from 'node:child_process';
import {mkdir,writeFile,rename,readFile,unlink,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {pythonFor} from '../src/python-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),gpu=process.argv.includes('--gpu'),name=gpu?'gpu':'cpu',directory=path.join(root,'runtime','acceleration',name);
async function run(python,args){await new Promise((resolve,reject)=>{const child=spawn(python,args,{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,PIP_DISABLE_PIP_VERSION_CHECK:'1',PIP_DEFAULT_TIMEOUT:'120',PIP_RETRIES:'8'}});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(`组件安装失败（${code}）`)));});}
const ortVersion='1.22.0'; // CPU and Windows CUDA wheels both exist for this release.
const dependencies=[`onnxruntime${gpu?'-gpu':''}==${ortVersion}`,'numpy==1.26.4','flatbuffers==25.2.10','protobuf==5.29.5','coloredlogs==15.0.1','humanfriendly==10.0','packaging==24.2',`sympy==${gpu?'1.14.0':'1.13.1'}`];
await mkdir(directory,{recursive:true});await unlink(path.join(directory,'ready.json')).catch(()=>{});
const python=await pythonFor(root);let installed=false;
for(const index of ['https://pypi.tuna.tsinghua.edu.cn/simple','https://pypi.org/simple'])try{await run(python,['-m','pip','install','--upgrade','--target',directory,'--index-url',index,...dependencies]);installed=true;break;}catch(error){console.error(error.message);}
if(!installed)throw Error('加速组件未安装完成，当前运行环境保持可用。');
async function cudaWheel(packageName){
  const filename=packageName+'-2.7.1+cu128-cp311-cp311-win_amd64.whl',url='https://download.pytorch.org/whl/cu128/'+filename.replace('+','%2B');
  const cache=path.join(root,'runtime/acceleration/downloads');await mkdir(cache,{recursive:true});
  const target=path.join(cache,filename),partial=target+'.part';
  const response=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('官方 CUDA 组件下载不可用：'+response.status);
  const expected=Number(response.headers.get('content-length')),sha=response.headers.get('x-amz-meta-checksum-sha256');
  async function valid(file){try{
    if((await stat(file)).size!==expected)return false;
    if(sha){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')===sha;}
    return false;
  }catch{return false;}}
  if(await valid(target))return target;
  for(let attempt=0;attempt<8;attempt++){
    console.log('下载 '+packageName+' CUDA 组件（支持断点续传）…');
    try{await run('curl.exe',['--fail','--location','--continue-at','-','--connect-timeout','30','--speed-time','120','--speed-limit','1024','--output',partial,url]);}catch(error){console.error(error.message);continue;}
    if(!await valid(partial))throw Error('CUDA 安装包校验失败，请移除对应 .part 文件后重试。');
    await rename(partial,target);return target;
  }
  throw Error('下载未完成，重新运行可从已有进度继续。');
}
if(gpu){const wheels=[];for(const name of ['torch','torchaudio'])wheels.push(await cudaWheel(name));await run(python,['-m','pip','install','--upgrade','--no-deps','--target',directory,...wheels]);}
const modelDirectory=path.join(root,'runtime/models/basic-pitch');await mkdir(modelDirectory,{recursive:true});
const modelPath=path.join(modelDirectory,'nmp.onnx');let model;
try{model=await readFile(modelPath);}catch{}
if(!model){
  for(const url of ['https://raw.githubusercontent.com/spotify/basic-pitch/main/basic_pitch/saved_models/icassp_2022/nmp.onnx','https://cdn.jsdelivr.net/gh/spotify/basic-pitch@main/basic_pitch/saved_models/icassp_2022/nmp.onnx'])try{
    const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`模型下载失败 ${response.status}`);const data=Buffer.from(await response.arrayBuffer());
    if(data.length<100000||data.subarray(0,100).toString().includes('git-lfs'))throw Error('下载内容不是完整 ONNX 模型');
    await writeFile(modelPath+'.part',data);await rename(modelPath+'.part',modelPath);model=data;break;
  }catch(error){console.error(error.message);}
}
if(!model)throw Error('模型尚未下载完成，请重试本脚本。');
await writeFile(path.join(directory,'ready.json'),JSON.stringify({version:1,component:name,ortVersion,torchVersion:gpu?'2.7.1+cu128':null,modelSHA256:createHash('sha256').update(model).digest('hex')}));
console.log(`已安装${gpu?'显卡':'CPU'}加速组件。请运行 scripts/benchmark-compute.mjs 验证；未通过验证前继续使用当前后端。`);
