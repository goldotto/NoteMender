import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {accelerationEnv} from './compute-runtime.mjs';
import {terminateProcess} from './process-control.mjs';
// One reusable process per execution configuration. Cancellation discards it so no
// abandoned Python computation survives an HTTP disconnect.
export class NativeAnalysis {
  constructor(root,{spawnImpl=spawn}={}){this.root=root;this.spawnImpl=spawnImpl;this.child=null;this.pending=null;this.sequence=0;}
  stop(reason=Error('分析进程已停止')){
    const child=this.child;this.child=null;this.key=null;if(child)this.stopping=terminateProcess(child);
    const pending=this.pending;this.pending=null;pending?.reject(reason);
    return this.stopping;
  }
  async start(config){
    const key=JSON.stringify({device:config.device||'auto',threads:config.threads||0});
    if(this.child&&this.key===key)return;
    await this.stop();const runtime=await accelerationEnv(this.root,config.device);
    const child=this.spawnImpl(runtime.python,[path.join(this.root,'scripts/native_analysis.py'),'--serve',String(config.threads||0)],{cwd:this.root,windowsHide:true,env:runtime.env,stdio:['pipe','pipe','pipe']});
    this.child=child;this.key=key;let output='',error='';
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-3000);});
    child.stdout.on('data',chunk=>{
      output+=chunk.toString();let index;
      while((index=output.indexOf('\n'))>=0){const line=output.slice(0,index);output=output.slice(index+1);let message;try{message=JSON.parse(line);}catch{continue;}
        if(this.child!==child||message.id!==this.pending?.id)continue;
        const pending=this.pending;this.pending=null;message.error?pending.reject(Error(message.error)):pending.resolve(message.result);
      }
    });
    child.stdin.on?.('error',e=>{if(this.child===child)this.stop(Error('原生进程通信失败：'+e.message));});
    child.on('error',e=>{if(this.child===child)this.stop(Error('无法启动原生分析：'+e.message));});
    child.on('close',()=>{if(this.child===child)this.stop(Error(error.trim()||'原生分析进程已退出'));});
  }
  async request(command,config={},signal){
    if(signal?.aborted)throw new DOMException('已取消','AbortError');
    if(this.pending||this.starting)throw Error('原生分析正在运行');
    this.starting=true;
    try{await this.start(config);}finally{this.starting=false;}
    if(signal?.aborted){this.stop();throw new DOMException('已取消','AbortError');}
    return new Promise((resolve,reject)=>{
      const id=++this.sequence,abort=()=>this.stop(new DOMException('已取消','AbortError'));
      const cleanup=()=>{signal?.removeEventListener('abort',abort);clearTimeout(timer);};
      const timer=setTimeout(()=>this.stop(Error('原生分析未响应')),180000);timer.unref?.();
      this.pending={id,resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}};
      signal?.addEventListener('abort',abort,{once:true});
      this.child.stdin.write(JSON.stringify({...command,id})+'\n',error=>{if(error)this.stop(error);});
    });
  }
  async analyse(bytes,kind,config={},options={},signal){
    const dir=await mkdtemp(path.join(tmpdir(),'jianpu-native-')),input=path.join(dir,kind==='basic'?'input.f32':'input.wav'),output=path.join(dir,'output.bin');
    try{
      await writeFile(input,bytes);
      const result=await this.request({kind,input,output,device:config.actualDevice||config.device||'auto',...options},config,signal);
      return kind==='basic'?{metadata:result,bytes:await readFile(output)}:result;
    }finally{await Promise.all([input,output].map(file=>unlink(file).catch(()=>{})));await rmdir(dir).catch(()=>{});}
  }
}
