import {spawn} from 'node:child_process';

// Windows venv python.exe is a launcher with a separate interpreter child.
// End only this application's owned process tree, never all Python processes.
export function terminateProcess(child,{platform=process.platform,spawnImpl=spawn}={}){
  if(!child||typeof child.exitCode==='number'||child.signalCode)return Promise.resolve();
  if(platform!=='win32'||!Number.isInteger(child.pid)||child.pid<=0){child.kill();return Promise.resolve();}
  return new Promise(resolve=>{
    let killer;
    try{killer=spawnImpl('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
    catch{child.kill();resolve();return;}
    killer.once('error',()=>{child.kill();resolve();});
    killer.once('close',code=>{if(code!==0&&child.exitCode===null)child.kill();resolve();});
  });
}
