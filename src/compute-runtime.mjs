import {access,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pythonFor} from './python-runtime.mjs';
import {normalizeCompute} from '../public/compute-settings.mjs';
import {componentBinding,audioRuntime} from './component-config.mjs';
export function requestCompute(url){return normalizeCompute({mode:url.searchParams.get('compute'),device:url.searchParams.get('device')||'auto',threads:Number(url.searchParams.get('threads')||0)},os.availableParallelism());}
export async function basicModelFile(root){
  const local=path.join(root,'runtime','models','basic-pitch','nmp.onnx');
  try{await access(local);return local;}catch{}
  return path.join((await audioRuntime(root)).modelHome,'basic-pitch','nmp.onnx');
}
export async function accelerationEnv(root,device='auto'){
  let directory=null,python=await pythonFor(root),qualificationFile=null;
  for(const name of device==='cpu'?['cpu','gpu']:['gpu','cpu']){
    const binding=await componentBinding(root,name);
    if(binding?.python){directory=binding.directory;python=binding.python;qualificationFile=binding.qualificationFile;break;}
    const candidate=path.join(root,'runtime','acceleration',name);
    try{await access(path.join(candidate,'ready.json'));await access(path.join(candidate,'onnxruntime','__init__.py'));if(name==='gpu')await access(path.join(candidate,'torch','__init__.py'));directory=candidate;break;}catch{}
  }
  qualificationFile ||= directory?path.join(path.dirname(directory),'qualification.json'):path.join(root,'runtime','acceleration','qualification.json');
  const modelFile=await basicModelFile(root);
  return {python,directory,qualificationFile,modelFile,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',PYTHONPATH:[directory,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),TORCH_HOME:(await audioRuntime(root)).modelHome,JIANPU_BASIC_MODEL:modelFile}};
}
export async function modelFingerprint(root){
  const hash=createHash('sha256'),model=JSON.parse(await readFile(path.join(root,'public/models/basic-pitch/model.json'),'utf8'));
  hash.update(JSON.stringify(model));
  for(const group of model.weightsManifest)for(const file of group.paths)hash.update(await readFile(path.join(root,'public/models/basic-pitch',file)));
  return hash.digest('hex');
}
export async function computeQualification(root,device){
  const filename=(await accelerationEnv(root,device)).qualificationFile;
  try{return JSON.parse(await readFile(filename,'utf8'));}
  catch(error){
    // An existing local decision (including a failed check) takes precedence.
    // Only a missing record uses the published, version-bound baseline.
    if(error.code!=='ENOENT')throw error;
    return JSON.parse(await readFile(path.join(root,'scripts','compute-qualification.json'),'utf8'));
  }
}
export async function qualification(root,probe,cpuProbe=probe){
  try{
    const legacy=await modelFingerprint(root),onnx=createHash('sha256').update(await readFile(await basicModelFile(root))).digest('hex');
    const readGate=async device=>{try{return await computeQualification(root,device);}catch{return {};}};
    const cpu=await readGate('cpu'),gpu=await readGate('cuda');
    const matches=(gate,actual)=>Boolean(gate?.passed&&gate.legacyFingerprint===legacy&&gate.onnxFingerprint===onnx&&gate.runtimeVersion===actual.ortVersion&&(!gate.torchVersion||gate.torchVersion===actual.torchVersion)&&gate.adapterVersion===1);
    // The GPU package's separately verified CPU provider can also serve CPU
    // inference. It must match the actual CPU process, not merely be installed.
    return {cpu:matches(cpu.cpu,cpuProbe)||matches(cpu.cudaCPU,cpuProbe),cuda:matches(gpu.cuda,probe),cudaCPU:matches(gpu.cudaCPU,probe),legacy,onnx};
  }catch{return {cpu:false,cuda:false};}
}
export async function torchQualifications(root,probe){
  try{const value=await computeQualification(root,'cuda');return Object.fromEntries(['demucs','crepe'].map(engine=>[engine,Boolean(value[engine]?.passed&&value[engine].torchVersion===probe.torchVersion&&value[engine].adapterVersion===(engine==='demucs'?2:1))]));}catch{return {demucs:false,crepe:false};}
}
