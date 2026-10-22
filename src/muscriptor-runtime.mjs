import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {componentBinding} from './component-config.mjs';
import {accelerationEnv} from './compute-runtime.mjs';
import {MUSCRIPTOR} from '../public/muscriptor-spec.mjs';
import {sha256File} from '../scripts/install-runtime.mjs';

export async function muscriptorRuntime(root,{localOnly=false,device='auto'}={}){
  const binding=localOnly?null:await componentBinding(root,'muscriptor'),compute=await accelerationEnv(root,device);
  const directory=binding?.directory||path.join(root,'runtime','muscriptor');
  const dependencies=binding?.dependencies||path.join(directory,'dependencies');
  return {python:binding?.python||compute.python,directory,dependencies,overlay:binding?.overlay||compute.directory,external:Boolean(binding),
    env:{...compute.env,PYTHONPATH:[dependencies,binding?.overlay||compute.directory,compute.env.PYTHONPATH].filter(Boolean).join(path.delimiter),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}};
}
export async function inspectMuscriptor(root,where,{deep=false,run,signal}={}){
  try{
    const model=path.join(where.directory,'model.safetensors'),info=await stat(model);
    const marker=JSON.parse(await readFile(path.join(where.directory,'ready.json'),'utf8'));
    const config=JSON.parse(await readFile(path.join(where.directory,'config.json'),'utf8'));
    if(marker.variant!=='large'||marker.sha256!==MUSCRIPTOR.sha256||marker.packageVersion!==MUSCRIPTOR.version||info.size!==MUSCRIPTOR.size||Object.entries(MUSCRIPTOR.config).some(([k,v])=>config[k]!==v))return {ready:false,reason:'MuScriptor large 文件或版本不匹配，请重新安装'};
    if(deep&&await sha256File(model)!==MUSCRIPTOR.sha256)return {ready:false,reason:'MuScriptor large 权重校验失败'};
    signal?.throwIfAborted();
    if(run){const result=await run(where.python,['-c','import muscriptor,torch,importlib.metadata as m,json; assert m.version("muscriptor")=="0.3.0"; print(json.dumps({"ready":True,"torchVersion":torch.__version__,"cuda":torch.cuda.is_available(),"bf16":torch.cuda.is_available() and torch.cuda.is_bf16_supported(including_emulation=False)}))'],{cwd:root,signal,env:where.env});if(result.code!==0)return {ready:false,reason:'MuScriptor 推理依赖不可用；请重装组件（不会覆盖原环境）'};return {...JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),variant:'large'};}
    return {ready:true,variant:'large'};
  }catch(error){if(signal?.aborted)throw error;return {ready:false,reason:error.code==='ENOENT'?'MuScriptor large 尚未安装':error.message};}
}
