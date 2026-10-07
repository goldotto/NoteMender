import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';

export function runProcess(command,args,{cwd,env=process.env,stdio='inherit'}={}){
  return new Promise((resolve,reject)=>{
    const capture=stdio==='pipe',child=spawn(command,args,{cwd,env,windowsHide:true,stdio:capture?['ignore','pipe','pipe']:stdio});
    let stdout='',stderr='';
    if(capture){child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);}
    child.once('error',reject);
    child.once('close',code=>resolve({code,stdout,stderr}));
  });
}

export async function ensurePip(python,{cwd,env,run=runProcess}={}){
  const options={cwd,env,stdio:'pipe'};
  const available=await run(python,['-m','pip','--version'],options);
  if(available.code===0)return;
  if(env?.NOTEMENDER_READONLY_PYTHON==='1')throw Error('复用环境没有 pip，且包内离线 pip 不可用；请重新解压轻量版或基础版。不会修改外部 Python。');
  const bootstrapped=await run(python,['-m','ensurepip','--upgrade','--default-pip'],{cwd,env});
  if(bootstrapped.code!==0)throw Error('离线初始化 pip 失败；请确认 Python 自带 ensurepip wheel 完整。');
  const checked=await run(python,['-m','pip','--version'],options);
  if(checked.code!==0)throw Error('ensurepip 已运行，但 pip 仍不可用。');
}

export async function sha256File(file){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}

function packageProbe(expected,modules){
  return [
    'import importlib,importlib.metadata as m,json,sys',
    'expected=json.loads(sys.argv[1])',
    'modules=json.loads(sys.argv[2])',
    '[importlib.import_module(name) for name in modules]',
    'actual={name:m.version(name) for name in expected}',
    'assert actual==expected,(actual,expected)',
  ].join(';');
}

export async function pythonProbe(python,code,args=[],{cwd,env=process.env,run=runProcess}={}){
  return run(python,['-c',code,...args],{cwd,env,stdio:'pipe'});
}

export async function pythonPackagesReady({python,expected,modules,cwd,env=process.env,run=runProcess}){
  try{
    const result=await pythonProbe(python,packageProbe(expected,modules),[JSON.stringify(expected),JSON.stringify(modules)],{cwd,env,run});
    return result.code===0;
  }catch{return false;}
}

export async function missingPythonPackages({python,expected,modules,cwd,env=process.env,run=runProcess}){
  const code=[
    'import importlib,importlib.metadata as metadata,json,sys',
    'expected=json.loads(sys.argv[1])',
    'modules=json.loads(sys.argv[2])',
    'missing=[]',
    'for name,version in expected.items():',
    ' try:',
    '  if metadata.version(name)!=version: missing.append(name)',
    ' except metadata.PackageNotFoundError:',
    '  missing.append(name)',
    'for name,module in modules.items():',
    ' if name not in missing:',
    '  try: importlib.import_module(module)',
    '  except Exception: missing.append(name)',
    'print(json.dumps(missing))',
  ].join('\n');
  try{
    const result=await pythonProbe(python,code,[JSON.stringify(expected),JSON.stringify(modules)],{cwd,env,run});
    if(result.code!==0)return Object.keys(expected);
    const missing=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    return Array.isArray(missing)?missing.filter(name=>Object.hasOwn(expected,name)):Object.keys(expected);
  }catch{return Object.keys(expected);}
}

export async function accelerationReady({directory,modelPath,component,python,cwd,env=process.env,run=runProcess}){
  try{
    const marker=JSON.parse(await readFile(path.join(directory,'ready.json'),'utf8'));
    if(!await accelerationModelReady({directory,modelPath,component}))return false;
    const expected={
      [component==='gpu'?'onnxruntime-gpu':'onnxruntime']:marker.ortVersion,
      numpy:'1.26.4',flatbuffers:'25.2.10',protobuf:'5.29.5',coloredlogs:'15.0.1',humanfriendly:'10.0',packaging:'24.2',sympy:component==='gpu'?'1.14.0':'1.13.1',
    };
    const modules=['onnxruntime','numpy','flatbuffers','google.protobuf','coloredlogs','humanfriendly','packaging','sympy'];
    if(component==='gpu'){
      expected.torch='2.7.1+cu128';expected.torchaudio='2.7.1+cu128';modules.push('torch','torchaudio');
    }
    return await pythonPackagesReady({python,expected,modules,cwd,env,run});
  }catch{return false;}
}

export async function accelerationModelReady({directory,modelPath,component}){
  try{
    const marker=JSON.parse(await readFile(path.join(directory,'ready.json'),'utf8'));
    const versions=component==='gpu'?['1.22.0']:['1.22.0','1.22.1'];
    if(marker.version!==1||marker.component!==component||!versions.includes(marker.ortVersion))return false;
    if(component==='gpu'&&marker.torchVersion!=='2.7.1+cu128')return false;
    if(component==='cpu'&&marker.torchVersion!==null)return false;
    if(!/^[a-f0-9]{64}$/i.test(marker.modelSHA256||''))return false;
    const info=await stat(modelPath);
    return info.isFile()&&info.size>=100_000&&await sha256File(modelPath)===marker.modelSHA256.toLowerCase();
  }catch{return false;}
}

export function accelerationRepairPlan({ready=false,modelReady,missingDependencies=[],missingTorch=[]}){
  const dependencies=[...new Set(missingDependencies)],torch=[...new Set(missingTorch)];
  const installDependencies=dependencies.length>0,installTorch=torch.length>0;
  return {
    reuse:ready&&!installDependencies&&!installTorch,
    bootstrapPip:installDependencies||installTorch,
    installDependencies,
    installTorch,
    missingDependencies:dependencies,
    missingTorch:torch,
    checkOrDownloadModel:!modelReady,
  };
}

export async function fileWithDigest(directory,relative,expectedDigest,{minimumBytes=1}={}){
  try{
    const file=path.resolve(directory,relative),base=path.resolve(directory);
    if(file!==base&&!file.startsWith(base+path.sep))return false;
    const info=await stat(file);
    return info.isFile()&&info.size>=minimumBytes&&await sha256File(file)===expectedDigest;
  }catch{return false;}
}
