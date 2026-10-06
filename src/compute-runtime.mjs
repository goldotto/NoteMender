import {access,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pythonFor} from './python-runtime.mjs';
import {normalizeCompute} from '../public/compute-settings.mjs';
export function requestCompute(url){return normalizeCompute({mode:url.searchParams.get('compute'),device:url.searchParams.get('device')||'auto',threads:Number(url.searchParams.get('threads')||0)},os.availableParallelism());}
export async function accelerationEnv(root,device='auto'){
  let directory=null;
  for(const name of device==='cpu'?['cpu','gpu']:['gpu','cpu']){
    const candidate=path.join(root,'runtime','acceleration',name);
    try{await access(path.join(candidate,'ready.json'));await access(path.join(candidate,'onnxruntime','__init__.py'));if(name==='gpu')await access(path.join(candidate,'torch','__init__.py'));directory=candidate;break;}catch{}
  }
  return {python:await pythonFor(root),directory,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONPATH:[directory,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),TORCH_HOME:path.join(root,'runtime','models')}};
}
export async function modelFingerprint(root){
  const hash=createHash('sha256'),model=JSON.parse(await readFile(path.join(root,'public/models/basic-pitch/model.json'),'utf8'));
  hash.update(JSON.stringify(model));
  for(const group of model.weightsManifest)for(const file of group.paths)hash.update(await readFile(path.join(root,'public/models/basic-pitch',file)));
  return hash.digest('hex');
}
export async function qualification(root,probe,cpuProbe=probe){
  try{
    const value=JSON.parse(await readFile(path.join(root,'runtime/acceleration/qualification.json'),'utf8'));
    const legacy=await modelFingerprint(root),onnx=createHash('sha256').update(await readFile(path.join(root,'runtime/models/basic-pitch/nmp.onnx'))).digest('hex');
    const result={};
    for(const device of ['cpu','cuda','cudaCPU']){
      const gate=value[device];
      const actual=device==='cpu'?cpuProbe:probe;
      result[device]=Boolean(gate?.passed&&gate.legacyFingerprint===legacy&&gate.onnxFingerprint===onnx&&gate.runtimeVersion===actual.ortVersion&&(!gate.torchVersion||gate.torchVersion===actual.torchVersion)&&gate.adapterVersion===1);
    }
    return {...result,legacy,onnx};
  }catch{return {cpu:false,cuda:false};}
}
export async function torchQualifications(root,probe){
  try{const value=JSON.parse(await readFile(path.join(root,'runtime/acceleration/qualification.json'),'utf8'));return Object.fromEntries(['demucs','crepe'].map(engine=>[engine,Boolean(value[engine]?.passed&&value[engine].torchVersion===probe.torchVersion&&value[engine].adapterVersion===(engine==='demucs'?2:1))]));}catch{return {demucs:false,crepe:false};}
}
