import {mkdir,readFile,writeFile,rename,stat,open,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {MUSCRIPTOR,muModel} from '../public/muscriptor-spec.mjs';
import {muscriptorRuntime,inspectMuscriptor} from '../src/muscriptor-runtime.mjs';
import {runProbe} from '../src/component-discovery.mjs';
import {ensurePinnedFile,verifiedDownload} from './download-model.mjs';
import {ensurePip,runProcess} from './install-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const progress=(stage,value)=>console.log(JSON.stringify({stage,progress:value}));
// No credential is persisted, included in arguments, or printed in installer logs.
export async function downloadWeights(target,{token=process.env.NOTEMENDER_HF_TOKEN,fetchImpl=fetch,onProgress=progress,signal,spec=MUSCRIPTOR}={}){
  if(await verifiedDownload(target,spec))return;
  if(!token)throw Error(spec.variant+' 权重需要 Hugging Face 授权：在组件卡片临时填写只读令牌，或指定已经下载的 model.safetensors 文件。不要在反馈或聊天中发送令牌。');
  const partial=target+'.part';let offset=0;try{offset=(await stat(partial)).size;}catch{}
  if(offset>spec.size)offset=0;
  if(offset===spec.size&&await verifiedDownload(partial,spec)){await rename(partial,target);return;}
  if(offset===spec.size)offset=0;
  const controller=new AbortController();let timer;const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),60000);};
  const cancel=()=>controller.abort();
  signal?.throwIfAborted();signal?.addEventListener('abort',cancel,{once:true});
  let file;
  try{
    touch();const response=await fetchImpl(spec.url,{headers:{Authorization:'Bearer '+token,...(offset?{Range:`bytes=${offset}-`}:{})},signal:controller.signal});
    if(!response.ok)throw Error([401,403].includes(response.status)?'Hugging Face 授权失败：请确认账号已接受 '+spec.variant+' 条款，令牌具有此仓库的读取权限。':'模型下载失败，HTTP '+response.status);
    if(response.status===206){if(!offset||response.headers.get('content-range')!==`bytes ${offset}-${spec.size-1}/${spec.size}`)throw Error('下载续传范围不匹配');}
    else offset=0;
    file=await open(partial,offset?'a':'w');let count=offset,last=0;
    for await(const bytes of response.body){touch();count+=bytes.length;if(count>spec.size)throw Error('下载大小超出固定模型大小');await file.writeFile(bytes);if(Date.now()-last>750){onProgress('下载 '+spec.name+' · '+(count/1e9).toFixed(2)+' / '+(spec.size/1e9).toFixed(2)+' GB',.1+.8*count/spec.size);last=Date.now();}}
    await file.close();file=null;controller.signal.throwIfAborted();
    if(count!==spec.size)throw Error(spec.name+' 下载未完成，已保留部分文件，可重试续传');
    onProgress('校验 '+spec.name+' 模型 SHA-256',.92);
    if(!await verifiedDownload(partial,spec)){await unlink(partial);throw Error(spec.name+' 权重完整性检查失败，请重试');}
    signal?.throwIfAborted();
    await rename(partial,target);
  }catch(error){signal?.throwIfAborted();if(error.name==='AbortError')throw Error('下载连接超时，已保留部分文件，可重试续传');throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);await file?.close();}
}
export async function installMuscriptor({dependenciesOnly=false,variant=process.env.NOTEMENDER_MUSCRIPTOR_VARIANT}={}){
  const spec=muModel(variant),token=process.env.NOTEMENDER_HF_TOKEN;
  delete process.env.NOTEMENDER_HF_TOKEN;
  if(!dependenciesOnly&&process.env.NOTEMENDER_MUSCRIPTOR_TERMS!=='accepted')throw Error('请先阅读并接受 '+spec.name+' 的非商用许可和附加使用条款');
  const runtime=await muscriptorRuntime(root,{localOnly:true,variant:spec.variant}),directory=runtime.directory;
  await mkdir(directory,{recursive:true});await mkdir(runtime.dependencies,{recursive:true});
  const env={...runtime.env,HF_HUB_OFFLINE:'0'},python=runtime.python;
  progress('复用已有 Python / PyTorch，检查推理依赖',.01);
  const torch=await runProbe(python,['-c','import torch; from packaging.version import Version; assert Version(torch.__version__.split("+")[0])>=Version("2.3"); print(torch.__version__)'],{cwd:root,env});
  if(torch.code!==0)throw Error('需要已有 PyTorch 2.3 或更新环境，请先安装或复用“CPU 音频环境”');
  const region=process.env.NOTEMENDER_DOWNLOAD_REGION,index=region==='global'?'https://pypi.org/simple':'https://pypi.tuna.tsinghua.edu.cn/simple';
  // Scoped dependencies only: never upgrade or install torch into the reused environment.
  const dependencyProbe=await runProbe(python,['-c','import muscriptor,importlib.metadata as m; assert m.version("muscriptor")=="0.3.0"'],{cwd:root,env});
  if(dependencyProbe.code!==0){
    await ensurePip(python,{cwd:root,env});
    const wheel=path.join(runtime.home,'muscriptor-0.3.0-py3-none-any.whl');
    await ensurePinnedFile({target:wheel,spec:spec.wheel,candidates:[process.env.NOTEMENDER_MUSCRIPTOR_WHEEL].filter(Boolean),urls:[spec.wheel.url],env,cwd:root});
    let installed=false;
    for(const source of [...new Set([index,'https://pypi.org/simple'])]){
      progress('安装独立的 MuScriptor 推理依赖（不安装网页服务或节拍模型）',.04);
      const result=await runProcess(python,['-m','pip','install','--disable-pip-version-check','--no-warn-script-location','--no-deps','--upgrade','--target',runtime.dependencies,'--index-url',source,wheel,'numpy==2.2.6','einops==0.8.1','mido==1.3.3','safetensors==0.6.2','huggingface-hub==0.36.0','packaging==24.2','filelock==3.19.1','fsspec==2025.9.0','pyyaml==6.0.3','requests==2.32.5','tqdm==4.67.1','typing-extensions==4.15.0','urllib3==2.5.0','certifi==2025.10.5','charset-normalizer==3.4.4','idna==3.11'],{cwd:root,env});
      if(result.code===0){installed=true;break;}
    }
    if(!installed)throw Error('MuScriptor 依赖安装失败，原 Python / 显卡环境未修改');
  }
  if(dependenciesOnly){const result=await runProbe(python,['-c','import muscriptor; print("MuScriptor import OK")'],{cwd:root,env});if(result.code!==0)throw Error(result.stderr);progress('推理依赖检查通过',1);return;}
  const target=path.join(directory,'model.safetensors'),local=process.env.NOTEMENDER_MUSCRIPTOR_FILE;
  if(local){
    if(!path.isAbsolute(local))throw Error('请填写模型文件的完整路径');
    if(!await verifiedDownload(local,spec))throw Error(spec.name+' 权重校验失败。请确认所选型号，并从对应的官方版本重新下载完整文件。');
    await ensurePinnedFile({target,spec,candidates:[local],env,cwd:root});
  }else await downloadWeights(target,{spec,token});
  const configFile=path.join(directory,'config.json'),readyFile=path.join(directory,'ready.json');
  await writeFile(configFile+'.tmp',JSON.stringify(spec.config,null,2));
  await rename(configFile+'.tmp',configFile);
  const marker={variant:spec.variant,packageVersion:spec.version,sha256:spec.sha256,revision:spec.revision,precision:'selectable',termsAcceptedAt:new Date().toISOString()};
  await writeFile(readyFile+'.tmp',JSON.stringify(marker,null,2));
  await rename(readyFile+'.tmp',readyFile);
  const checked=await inspectMuscriptor(root,runtime,{run:runProbe});
  if(!checked.ready)throw Error(checked.reason);
  progress(spec.name+' 已安装',1);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await installMuscriptor({dependenciesOnly:process.argv.includes('--dependencies-only')});
