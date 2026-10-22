import {mkdir,readFile,writeFile,rename,stat,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {MUSCRIPTOR} from '../public/muscriptor-spec.mjs';
import {muscriptorRuntime,inspectMuscriptor} from '../src/muscriptor-runtime.mjs';
import {runProbe} from '../src/component-discovery.mjs';
import {ensurePinnedFile,verifiedDownload} from './download-model.mjs';
import {ensurePip,runProcess} from './install-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const progress=(stage,value)=>console.log(JSON.stringify({stage,progress:value}));
// No credential is persisted, included in arguments, or printed in installer logs.
export async function downloadWeights(target,{token=process.env.NOTEMENDER_HF_TOKEN,fetchImpl=fetch,onProgress=progress}={}){
  if(await verifiedDownload(target,MUSCRIPTOR))return;
  if(!token)throw Error('large 权重需要 Hugging Face 授权：在组件卡片临时填写只读令牌，或指定已经下载的 model.safetensors 文件。不要在反馈或聊天中发送令牌。');
  const partial=target+'.part';let offset=0;try{offset=(await stat(partial)).size;}catch{}
  if(offset>MUSCRIPTOR.size)offset=0;
  if(offset===MUSCRIPTOR.size&&await verifiedDownload(partial,MUSCRIPTOR)){await rename(partial,target);return;}
  if(offset===MUSCRIPTOR.size)offset=0;
  const controller=new AbortController();let timer;const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),60000);};
  let file;
  try{
    touch();const response=await fetchImpl(`https://huggingface.co/${MUSCRIPTOR.repo}/resolve/${MUSCRIPTOR.revision}/model.safetensors`,{headers:{Authorization:'Bearer '+token,...(offset?{Range:`bytes=${offset}-`}:{})},signal:controller.signal});
    if(!response.ok)throw Error([401,403].includes(response.status)?'Hugging Face 授权失败：请确认账号已接受 large 条款，令牌具有此仓库的读取权限。':'模型下载失败，HTTP '+response.status);
    if(response.status===206){if(!new RegExp(`^bytes ${offset}-\\d+/${MUSCRIPTOR.size}$`).test(response.headers.get('content-range')||''))throw Error('下载续传范围不匹配');}
    else offset=0;
    file=await open(partial,offset?'a':'w');let count=offset,last=0;
    for await(const bytes of response.body){touch();count+=bytes.length;if(count>MUSCRIPTOR.size)throw Error('下载大小超出固定模型大小');await file.writeFile(bytes);if(Date.now()-last>750){onProgress('下载 MuScriptor large · '+(count/1e9).toFixed(2)+' / 5.47 GB',.1+.8*count/MUSCRIPTOR.size);last=Date.now();}}
    await file.close();file=null;onProgress('校验 large 模型 SHA-256',.92);
    if(!await verifiedDownload(partial,MUSCRIPTOR))throw Error('large 权重完整性检查失败；请重试，不会把未完成文件当作已安装');
    await rename(partial,target);
  }catch(error){if(error.name==='AbortError')throw Error('下载连接超时，已保留部分文件，可重试续传');throw error;}
  finally{clearTimeout(timer);await file?.close();}
}
export async function installMuscriptor({dependenciesOnly=false}={}){
  if(!dependenciesOnly&&process.env.NOTEMENDER_MUSCRIPTOR_TERMS!=='accepted')throw Error('请先阅读并接受 MuScriptor large 的非商用许可和附加使用条款');
  const runtime=await muscriptorRuntime(root,{localOnly:true}),directory=runtime.directory;
  await mkdir(directory,{recursive:true});await mkdir(runtime.dependencies,{recursive:true});
  const env={...runtime.env,HF_HUB_OFFLINE:'0'},python=runtime.python;
  progress('复用已有 Python / PyTorch，检查推理依赖',.01);
  const torch=await runProbe(python,['-c','import torch; from packaging.version import Version; assert Version(torch.__version__.split("+")[0])>=Version("2.3"); print(torch.__version__)'],{cwd:root,env});
  if(torch.code!==0)throw Error('需要已有 PyTorch 2.3 或更新环境，请先安装或复用“人声与器乐分轨”组件');
  await ensurePip(python,{cwd:root,env});
  const wheel=path.join(directory,'muscriptor-0.3.0-py3-none-any.whl');
  await ensurePinnedFile({target:wheel,spec:MUSCRIPTOR.wheel,candidates:[process.env.NOTEMENDER_MUSCRIPTOR_WHEEL].filter(Boolean),urls:[MUSCRIPTOR.wheel.url],env,cwd:root});
  const region=process.env.NOTEMENDER_DOWNLOAD_REGION,index=region==='global'?'https://pypi.org/simple':'https://pypi.tuna.tsinghua.edu.cn/simple';
  // Scoped dependencies only: never upgrade or install torch into the reused environment.
  const dependencyProbe=await runProbe(python,['-c','import muscriptor,importlib.metadata as m; assert m.version("muscriptor")=="0.3.0"'],{cwd:root,env});
  if(dependencyProbe.code!==0){
    let installed=false;
    for(const source of [...new Set([index,'https://pypi.org/simple'])]){
      progress('安装独立的 MuScriptor 推理依赖（不安装网页服务或节拍模型）',.04);
      const result=await runProcess(python,['-m','pip','install','--disable-pip-version-check','--no-warn-script-location','--no-deps','--upgrade','--target',runtime.dependencies,'--index-url',source,wheel,'numpy==2.2.6','einops==0.8.1','mido==1.3.3','safetensors==0.6.2','huggingface-hub==0.36.0','packaging==24.2','filelock==3.19.1','fsspec==2025.9.0','pyyaml==6.0.3','requests==2.32.5','tqdm==4.67.1','typing-extensions==4.15.0','urllib3==2.5.0','certifi==2025.10.5','charset-normalizer==3.4.4','idna==3.11'],{cwd:root,env});
      if(result.code===0){installed=true;break;}
    }
    if(!installed)throw Error('MuScriptor 依赖安装失败，原 Python / 显卡环境未修改');
  }
  if(dependenciesOnly){const result=await runProbe(python,['-c','import muscriptor; print("MuScriptor import OK")'],{cwd:root,env});if(result.code!==0)throw Error(result.stderr);progress('推理依赖检查通过；尚未安装 large 权重',1);return;}
  const target=path.join(directory,'model.safetensors'),local=process.env.NOTEMENDER_MUSCRIPTOR_FILE;
  if(local){if(!path.isAbsolute(local))throw Error('请填写模型文件的完整路径');await ensurePinnedFile({target,spec:MUSCRIPTOR,candidates:[local],env,cwd:root});}
  else await downloadWeights(target);
  // Architecture is fixed to the published large config (no size inference from filename).
  await writeFile(path.join(directory,'config.json'),JSON.stringify(MUSCRIPTOR.config,null,2));
  await writeFile(path.join(directory,'ready.json'),JSON.stringify({variant:'large',packageVersion:MUSCRIPTOR.version,sha256:MUSCRIPTOR.sha256,revision:MUSCRIPTOR.revision,precision:'selectable',termsAcceptedAt:new Date().toISOString()},null,2));
  const checked=await inspectMuscriptor(root,runtime,{run:runProbe});
  if(!checked.ready)throw Error(checked.reason);
  progress('MuScriptor large 已安装；实际歌曲效果与运行速度仍需听审',1);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await installMuscriptor({dependenciesOnly:process.argv.includes('--dependencies-only')});
