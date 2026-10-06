import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,access,stat,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {accelerationEnv} from '../src/compute-runtime.mjs';
import {ensurePip,fileWithDigest,missingPythonPackages,pythonPackagesReady,pythonProbe,runProcess} from './install-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=await accelerationEnv(root,'cuda');
const env=runtime.env;
const python=runtime.python;
const singingDirectory=path.join(root,'runtime','singing');
const sourceDirectory=path.join(singingDirectory,'ROSVOT');
const singingDependencies=path.join(singingDirectory,'dependencies');
const singingPackages={
  pretty_midi:'0.2.10',pyworld:'0.3.5',matplotlib:'3.9.4',PyYAML:'6.0.2',einops:'0.8.1',gdown:'5.2.0',beautifulsoup4:'4.13.4',soupsieve:'2.7',mido:'1.3.3',six:'1.17.0',filelock:'3.18.0',requests:'2.32.3',pillow:'11.2.1',contourpy:'1.3.2',cycler:'0.12.1',fonttools:'4.58.5',kiwisolver:'1.4.8',pyparsing:'3.2.3','python-dateutil':'2.9.0.post0',
};
const singingModules=['torch','numpy','pretty_midi','pyworld','matplotlib','yaml','einops','gdown','bs4','soupsieve','mido','six','filelock','requests','PIL','contourpy','cycler','fontTools','kiwisolver','pyparsing','dateutil','inference.rosvot','utils.audio.pitch_utils','tasks.rosvot.rosvot_utils'];
const singingCheckpoints=['rosvot/model.pt','rosvot/config.yaml','rwbd/model.pt','rwbd/config.yaml','rmvpe/model.pt'];

async function run(command,args,extraEnv={}){
  const result=await runProcess(command,args,{cwd:root,env:{...env,...extraEnv}});
  if(result.code!==0)throw Error('安装步骤失败，退出码 '+result.code);
  return result;
}

async function sha256(file){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}

async function sourceTreeComplete(){
  try{
    for(const file of ['LICENSE','inference/rosvot.py','tasks/rosvot/rosvot_utils.py','utils/audio/pitch_utils.py'])await access(path.join(sourceDirectory,file));
    return true;
  }catch{return false;}
}

async function sourceTreeFingerprint(directory){
  const entries=[];
  async function visit(current){
    for(const entry of await readdir(current,{withFileTypes:true})){
      const file=path.join(current,entry.name);
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile())entries.push(file);
    }
  }
  await visit(directory);
  entries.sort((left,right)=>path.relative(directory,left).localeCompare(path.relative(directory,right)));
  const hash=createHash('sha256');
  for(const file of entries){hash.update(path.relative(directory,file).replaceAll(path.sep,'/'));hash.update(await readFile(file));}
  return hash.digest('hex');
}

async function checkpointsPresent(){
  let previous=null;
  try{previous=JSON.parse(await readFile(path.join(singingDirectory,'ready.json'),'utf8'));}catch{}
  try{
    for(const checkpoint of singingCheckpoints){
      const file=path.join(sourceDirectory,'checkpoints',checkpoint),info=await stat(file);
      if(!info.isFile()||info.size<(checkpoint.endsWith('.pt')?100_000:50))return false;
      const expected=previous?.fingerprints?.[checkpoint];
      if(expected&&await sha256(file)!==expected)return false;
    }
    return true;
  }catch{return false;}
}

async function demucsReady(){
  const markerPath=path.join(root,'runtime','demucs6-ready.json');
  const checkpoint=path.join(root,'runtime','models','hub','checkpoints','5c90dfd2-34c22ccb.th');
  try{
    const marker=JSON.parse(await readFile(markerPath,'utf8'));
    if(marker.model!=='htdemucs_6s'||marker.version!=='4.0.1'||!/^[a-f0-9]{64}$/i.test(marker.fingerprint||''))return false;
    const info=await stat(checkpoint);
    if(!info.isFile()||info.size!==54_996_327)return false;
    const digest=await sha256(checkpoint);
    if(marker.checkpointFileSHA256&&marker.checkpointFileSHA256!==digest)return false;
    const packages={};
    const requirements=(await readFile(path.join(root,'requirements-demucs.txt'),'utf8')).split(/\r?\n/).filter(line=>line&&!line.startsWith('#'));
    for(const requirement of requirements){
      const [name,version]=requirement.split('==');
      if(!['torch','torchaudio'].includes(name))packages[name]=version;
    }
    const modules=['torch','torchaudio','numpy','soundfile','demucs','librosa','einops','julius','dora','omegaconf','openunmix'];
    const code=[
      'import importlib,importlib.metadata as m,json,sys',
      'expected=json.loads(sys.argv[1])',
      '[importlib.import_module(name) for name in json.loads(sys.argv[2])]',
      'actual={name:m.version(name) for name in expected}',
      'assert actual==expected,(actual,expected)',
      'import torch,torchaudio',
      "assert torch.__version__ in ('2.5.1+cpu','2.7.1+cu128')",
      "assert torchaudio.__version__ in ('2.5.1+cpu','2.7.1+cu128')",
    ].join(';');
    const probe=await pythonProbe(python,code,[JSON.stringify(packages),JSON.stringify(modules)],{cwd:root,env});
    if(probe.code!==0)return false;
    if(!marker.checkpointFileSHA256){
      await writeFile(markerPath,JSON.stringify({...marker,checkpointFileSHA256:digest}));
    }
    return true;
  }catch{return false;}
}

async function singingReady(){
  try{
    const marker=JSON.parse(await readFile(path.join(singingDirectory,'ready.json'),'utf8'));
    if(marker.version!==1||marker.adapterVersion!==1||marker.model!=='rosvot'||marker.device!=='cuda'||marker.compute?.device!=='cuda'||marker.compute?.precision!=='fp32'||marker.compute?.torchVersion!=='2.7.1+cu128')return false;
    if(!/^[a-f0-9]{64}$/i.test(marker.fingerprints?.source||''))return false;
    if(!runtime.directory||path.basename(runtime.directory)!=='gpu')return false;
    if(!await sourceTreeComplete())return false;
    for(const checkpoint of singingCheckpoints){
      const digest=marker.fingerprints?.[checkpoint];
      if(!await fileWithDigest(path.join(sourceDirectory,'checkpoints'),checkpoint,digest,{minimumBytes:checkpoint.endsWith('.pt')?100_000:50}))return false;
    }
    if(!await pythonPackagesReady({python,expected:singingPackages,modules:singingModules,cwd:sourceDirectory,env:{...env,PYTHONPATH:[singingDependencies,env.PYTHONPATH].filter(Boolean).join(path.delimiter)}}))return false;
    const cuda=await pythonProbe(python,"import torch; assert torch.__version__=='2.7.1+cu128' and torch.cuda.is_available()",[],{cwd:sourceDirectory,env:{...env,PYTHONPATH:[singingDependencies,env.PYTHONPATH].filter(Boolean).join(path.delimiter)}});
    return cuda.code===0;
  }catch{return false;}
}

async function download(url,file){
  try{await access(file);return;}catch{}
  await run('curl.exe',['--fail','--location','--retry','2','--connect-timeout','20','--max-time','900','--output',file+'.part',url]);
  await run(python,['-c','from pathlib import Path; import sys; Path(sys.argv[1]).replace(sys.argv[2])',file+'.part',file]);
}

if(process.argv.includes('--six')||!process.argv.includes('--singing')){
  if(await demucsReady())console.log('htdemucs_6s 的依赖、标记和本地模型完整，直接复用。');
  else await run(python,[path.join(root,'scripts/separate.py'),'--prepare'],{JIANPU_SEPARATION_MODEL:'htdemucs_6s'});
}

if(process.argv.includes('--singing')){
  if(await singingReady())console.log('ROSVOT 的依赖、标记和本地检查点完整，直接复用。');
  else{
    await mkdir(singingDependencies,{recursive:true});
    const archive=path.join(singingDirectory,'ROSVOT.zip');
    const haveSource=await sourceTreeComplete();
    if(!haveSource){
      await download('https://codeload.github.com/RickyL-2000/ROSVOT/zip/refs/heads/main',archive);
      await run(python,[path.join(root,'scripts/extract-candidate-archive.py'),archive,sourceDirectory,'--strip-root']);
    }
    const singingEnv={...env,PYTHONPATH:[singingDependencies,env.PYTHONPATH].filter(Boolean).join(path.delimiter)};
    let installed=await pythonPackagesReady({python,expected:singingPackages,modules:singingModules,cwd:sourceDirectory,env:singingEnv});
    if(!installed){
      const moduleAliases={PyYAML:'yaml',beautifulsoup4:'bs4',pillow:'PIL',fonttools:'fontTools','python-dateutil':'dateutil'};
      const modules=Object.fromEntries(Object.keys(singingPackages).map(name=>[name,moduleAliases[name]||name]));
      const missing=await missingPythonPackages({python,expected:singingPackages,modules,cwd:sourceDirectory,env:singingEnv});
      if(!missing.length)throw Error('可选人声依赖版本完整，但 ROSVOT 或 Torch 导入失败；请检查源文件及显卡运行环境。');
      await ensurePip(python,{cwd:root,env});
      for(const index of ['https://pypi.tuna.tsinghua.edu.cn/simple','https://pypi.org/simple'])if(!installed)try{
        await run(python,['-m','pip','install','--upgrade','--target',singingDependencies,'--no-deps','--index-url',index,...missing.map(name=>`${name}==${singingPackages[name]}`)],{PYTHONPATH:singingEnv.PYTHONPATH});
        installed=await pythonPackagesReady({python,expected:singingPackages,modules:singingModules,cwd:sourceDirectory,env:singingEnv});
      }catch(error){console.error(error.message);}
      if(!installed)throw Error('可选人声依赖下载或导入失败');
    }
    const supplied=process.argv.find(argument=>argument.startsWith('--checkpoints='))?.slice('--checkpoints='.length);
    const checkpointZip=supplied||path.join(singingDirectory,'checkpoints.zip');
    const haveCheckpoints=await checkpointsPresent();
    if(!haveCheckpoints){
      if(!supplied)try{await access(checkpointZip);}catch{await run(python,['-m','gdown','1JNtNT37KiLq9uFQqHk7JFs-3trxd3bRh','-O',checkpointZip],{PYTHONPATH:singingEnv.PYTHONPATH});}
      await run(python,[path.join(root,'scripts/extract-candidate-archive.py'),checkpointZip,sourceDirectory],{PYTHONPATH:singingEnv.PYTHONPATH});
    }
    for(const checkpoint of singingCheckpoints)await access(path.join(sourceDirectory,'checkpoints',checkpoint));
    await run(python,['-c',"import wave,sys; f=wave.open(sys.argv[1],'wb'); f.setparams((1,2,22050,0,'NONE','not compressed')); f.writeframes(bytes(22050*2)); f.close()",path.join(singingDirectory,'smoke.wav')]);
    await run(python,[path.join(root,'scripts/singing_analysis.py'),path.join(singingDirectory,'smoke.wav'),path.join(singingDirectory,'smoke.json')],{PYTHONPATH:singingEnv.PYTHONPATH});
    const fingerprints={source:haveSource?await sourceTreeFingerprint(sourceDirectory):await sha256(archive)};
    for(const name of singingCheckpoints)fingerprints[name]=await sha256(path.join(sourceDirectory,'checkpoints',name));
    const report=JSON.parse(await readFile(path.join(singingDirectory,'smoke.json'),'utf8'));
    await writeFile(path.join(singingDirectory,'ready.json'),JSON.stringify({version:1,adapterVersion:1,model:'rosvot',device:'cuda',fingerprints,compute:report.compute,installedAt:new Date().toISOString()}));
    if(!await singingReady()){
      await unlink(path.join(singingDirectory,'ready.json')).catch(()=>{});
      throw Error('ROSVOT 安装后未通过依赖导入、CUDA 或完整检查点校验。');
    }
  }
}

console.log('候选组件安装完成。');
