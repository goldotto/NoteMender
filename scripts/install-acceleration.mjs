import {mkdir,readFile,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {pythonFor} from '../src/python-runtime.mjs';
import {accelerationModelReady,accelerationReady,accelerationRepairPlan,ensurePip,fileWithDigest,missingPythonPackages,runProcess} from './install-runtime.mjs';
import {sources} from './download-sources.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const gpu=process.argv.includes('--gpu');
const component=gpu?'gpu':'cpu';
const directory=path.join(root,'runtime','acceleration',component);
const modelPath=path.join(root,'runtime','models','basic-pitch','nmp.onnx');
const modelSpec=JSON.parse(await readFile(path.join(root,'scripts','component-models.json'),'utf8')).basic;
const python=await pythonFor(root);
const ortVersion=gpu?'1.22.0':'1.22.1';
const env={...process.env,PIP_DISABLE_PIP_VERSION_CHECK:'1',PIP_DEFAULT_TIMEOUT:'120',PIP_RETRIES:'8'};

async function run(command,args,extraEnv={}){
  const result=await runProcess(command,args,{cwd:root,env:{...env,...extraEnv}});
  if(result.code!==0)throw Error(`组件安装失败（${result.code}）`);
  return result;
}

const probeEnv={...env,PYTHONPATH:[directory,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)};
const pinnedModelReady=await fileWithDigest(path.dirname(modelPath),modelSpec.file,modelSpec.sha256,{minimumBytes:modelSpec.size});
const existingReady=pinnedModelReady&&await accelerationReady({directory,modelPath,component,python,cwd:root,env:probeEnv});
if(existingReady){
  console.log(`已发现可用的${gpu?'GPU':'CPU'}加速组件与完整模型，直接复用本地文件。`);
  process.exit(0);
}

// Bootstrap pip only when actual package repair is needed. Keep the local
// marker available while checking its model fingerprint.
await mkdir(directory,{recursive:true});
const packageVersions={
  [gpu?'onnxruntime-gpu':'onnxruntime']:ortVersion,
  numpy:'1.26.4',flatbuffers:'25.2.10',protobuf:'5.29.5',coloredlogs:'15.0.1',humanfriendly:'10.0',packaging:'24.2',sympy:gpu?'1.14.0':'1.13.1',
};
const packageModules={
  [gpu?'onnxruntime-gpu':'onnxruntime']:'onnxruntime',
  numpy:'numpy',flatbuffers:'flatbuffers',protobuf:'google.protobuf',coloredlogs:'coloredlogs',humanfriendly:'humanfriendly',packaging:'packaging',sympy:'sympy',
};
const torchVersions=gpu?{torch:'2.7.1+cu128',torchaudio:'2.7.1+cu128'}:{};
const torchModules=gpu?{torch:'torch',torchaudio:'torchaudio'}:{};
const missingDependencies=await missingPythonPackages({python,expected:packageVersions,modules:packageModules,cwd:root,env:probeEnv});
const missingTorch=gpu?await missingPythonPackages({python,expected:torchVersions,modules:torchModules,cwd:root,env:probeEnv}):[];
const repair=accelerationRepairPlan({ready:existingReady,modelReady:await accelerationModelReady({directory,modelPath,component}),missingDependencies,missingTorch});
if(repair.reuse){
  console.log(`已发现可用的${gpu?'GPU':'CPU'}加速组件与完整模型，直接复用本地文件。`);
  process.exit(0);
}
if(repair.bootstrapPip)await ensurePip(python,{cwd:root,env});
if(repair.installDependencies){
  const dependencies=repair.missingDependencies.map(name=>`${name}==${packageVersions[name]}`);
  let installed=false;
  for(const index of sources('pypi'))try{
    await run(python,['-m','pip','install','--upgrade','--no-deps','--target',directory,'--index-url',index,...dependencies]);
    installed=true;
    break;
  }catch(error){console.error(error.message);}
  if(!installed)throw Error('加速组件未安装完成，当前运行环境保持可用。');
}

async function cudaWheel(packageName){
  const filename=packageName+'-2.7.1+cu128-cp311-cp311-win_amd64.whl';
  const spec=JSON.parse(await readFile(path.join(root,'scripts','cuda-wheel-manifest.json'),'utf8'))[packageName];
  const urls=[...sources('cuda').map(base=>base+filename.replace('+','%2B')),spec.official];
  const cache=path.join(root,'runtime/acceleration/downloads');
  await mkdir(cache,{recursive:true});
  const target=path.join(cache,filename),partial=target+'.part';
  const sha=spec.sha256;
  async function valid(file){
    try{
      if((await stat(file)).size<100_000)return false;
      if(!sha)return false;
      const hash=createHash('sha256');
      for await(const chunk of createReadStream(file))hash.update(chunk);
      return hash.digest('hex')===sha;
    }catch{return false;}
  }
  if(await valid(target))return target;
  for(const url of [...new Set(urls)]){
    console.log('下载 '+packageName+' CUDA 组件（支持断点续传）…');
    try{await run('curl.exe',['--fail','--location','--continue-at','-','--connect-timeout','30','--speed-time','120','--speed-limit','1024','--output',partial,url]);}
    catch(error){console.error(error.message);continue;}
    if(!await valid(partial)){await unlink(partial).catch(()=>{});console.error('此下载源文件未通过官方 SHA-256 校验，切换下一源。');continue;}
    await rename(partial,target);
    return target;
  }
  throw Error('下载未完成，重新运行可从已有进度继续。');
}

if(repair.installTorch){
  const wheels=[];
  for(const name of repair.missingTorch)wheels.push(await cudaWheel(name));
  await run(python,['-m','pip','install','--upgrade','--no-deps','--target',directory,...wheels]);
}

const stillMissing=await missingPythonPackages({python,expected:packageVersions,modules:packageModules,cwd:root,env:probeEnv});
const stillMissingTorch=gpu?await missingPythonPackages({python,expected:torchVersions,modules:torchModules,cwd:root,env:probeEnv}):[];
if(stillMissing.length||stillMissingTorch.length)throw Error(`加速组件依赖仍不完整：${[...stillMissing,...stillMissingTorch].join(', ')}`);

await mkdir(path.dirname(modelPath),{recursive:true});
let modelIsComplete=false;
try{
  const existing=await stat(modelPath);
    if(existing.isFile()&&existing.size===modelSpec.size&&pinnedModelReady){
    const result=await runProcess(python,['-c',"import onnxruntime as ort,sys; ort.InferenceSession(sys.argv[1],providers=['CPUExecutionProvider'])",modelPath],{cwd:root,env:probeEnv,stdio:'pipe'});
    modelIsComplete=result.code===0;
  }
}catch{}
if(!modelIsComplete){
  await unlink(modelPath+'.part').catch(()=>{});
  for(const url of ['https://raw.githubusercontent.com/spotify/basic-pitch/main/basic_pitch/saved_models/icassp_2022/nmp.onnx','https://cdn.jsdelivr.net/gh/spotify/basic-pitch@main/basic_pitch/saved_models/icassp_2022/nmp.onnx'])try{
    const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error(`模型下载失败 ${response.status}`);
    const data=Buffer.from(await response.arrayBuffer());
    if(data.length!==modelSpec.size||createHash('sha256').update(data).digest('hex')!==modelSpec.sha256)throw Error('ONNX 模型未通过固定 SHA-256 校验');
    await writeFile(modelPath+'.part',data);
    await rename(modelPath+'.part',modelPath);
    const result=await runProcess(python,['-c',"import onnxruntime as ort,sys; ort.InferenceSession(sys.argv[1],providers=['CPUExecutionProvider'])",modelPath],{cwd:root,env:probeEnv,stdio:'pipe'});
    if(result.code!==0){await unlink(modelPath).catch(()=>{});throw Error('ONNX 模型文件未通过完整性检查');}
    modelIsComplete=true;
    break;
  }catch(error){console.error(error.message);}
}
if(!modelIsComplete)throw Error('模型尚未下载完成，请重试本脚本。');

const model=await readFile(modelPath);
await writeFile(path.join(directory,'ready.json'),JSON.stringify({version:1,component,ortVersion,torchVersion:gpu?'2.7.1+cu128':null,modelSHA256:createHash('sha256').update(model).digest('hex')}));
if(!await accelerationReady({directory,modelPath,component,python,cwd:root,env:probeEnv})){
  await unlink(path.join(directory,'ready.json')).catch(()=>{});
  throw Error('已安装的加速组件未通过导入、版本或模型完整性检查。');
}
console.log(`已安装${gpu?'显卡':'CPU'}加速组件。请运行 scripts/benchmark-compute.mjs 验证；未通过验证前继续使用当前后端。`);
