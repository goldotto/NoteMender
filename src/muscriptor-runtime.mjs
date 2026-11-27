import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {componentBinding} from './component-config.mjs';
import {accelerationEnv} from './compute-runtime.mjs';
import {muModel} from '../public/muscriptor-spec.mjs';
import {sha256File} from '../scripts/install-runtime.mjs';

export async function muscriptorRuntime(root,{localOnly=false,device='auto',variant='large'}={}){
  muModel(variant);
  const binding=localOnly||variant!=='large'?null:await componentBinding(root,'muscriptor');
  const compute=await accelerationEnv(root,device);
  const home=path.join(root,'runtime','muscriptor');
  const directory=variant==='large'?(binding?.directory||home):path.join(home,'models',variant);
  const dependencies=binding?.dependencies||path.join(binding?.directory||home,'dependencies');
  return {variant,home,python:binding?.python||compute.python,directory,dependencies,overlay:binding?.overlay||compute.directory,external:Boolean(binding),
    env:{...compute.env,PYTHONPATH:[dependencies,binding?.overlay||compute.directory,compute.env.PYTHONPATH].filter(Boolean).join(path.delimiter),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}};
}
export async function inspectMuscriptor(root,where,{deep=false,run,signal}={}){
  const spec=muModel(where.variant);
  try{
    const model=path.join(where.directory,'model.safetensors'),info=await stat(model);
    const marker=JSON.parse(await readFile(path.join(where.directory,'ready.json'),'utf8'));
    const config=JSON.parse(await readFile(path.join(where.directory,'config.json'),'utf8'));
    if(marker.variant!==spec.variant||(marker.revision!==spec.revision&&!(spec.variant==='large'&&!marker.revision))||!info.isFile()||marker.sha256!==spec.sha256||marker.packageVersion!==spec.version||info.size!==spec.size||Object.entries(spec.config).some(([k,v])=>config[k]!==v))return {ready:false,reason:spec.name+' 文件或版本不匹配，请重新安装'};
    if(deep&&await sha256File(model)!==spec.sha256)return {ready:false,reason:spec.name+' 权重校验失败'};
    signal?.throwIfAborted();
    if(run){const result=await run(where.python,['-c','import muscriptor,torch,importlib.metadata as m,json; assert m.version("muscriptor")=="0.3.0"; print(json.dumps({"ready":True,"torchVersion":torch.__version__,"cuda":torch.cuda.is_available(),"bf16":torch.cuda.is_available() and torch.cuda.is_bf16_supported(including_emulation=False)}))'],{cwd:root,signal,env:where.env});if(result.code!==0)return {ready:false,reason:'MuScriptor 推理依赖不可用；请重装组件（不会覆盖原环境）'};return {...JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)),variant:spec.variant};}
    return {ready:true,variant:spec.variant};
  }catch(error){if(signal?.aborted)throw error;return {ready:false,reason:error.code==='ENOENT'?spec.name+' 尚未安装':error.message};}
}
