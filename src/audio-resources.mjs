import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {TRACKS} from '../public/candidate-tools.mjs';
import {isWave,openAudioFile,writeAudioInput} from './audio-io.mjs';

export async function saveAudioResource(root,input,metadata={},limit=Infinity){
  const source=TRACKS.includes(metadata.source)?metadata.source:'original';
  const audioStart=Number(metadata.audioStart||0),audioEnd=Number(metadata.audioEnd);
  if(!Number.isFinite(audioStart)||audioStart<0||!Number.isFinite(audioEnd)||audioEnd<=audioStart||audioEnd>3600)throw Error('无效资源时间范围');
  const value={source,audioStart,audioEnd,model:String(metadata.model||'original').slice(0,80)};
  const resources=path.join(root,'runtime','audio-resources');
  await mkdir(resources,{recursive:true});
  const temp=await mkdtemp(path.join(resources,'upload-'));
  try{
    const file=path.join(temp,'audio.wav');
    const {hash,header}=await writeAudioInput(typeof input==='string'?createReadStream(input):input,file,{limit});
    if(!isWave(header))throw Error('需要 WAV 音频');
    const id=hash.update(JSON.stringify(value)).digest('hex'),directory=path.join(resources,id);
    await mkdir(directory,{recursive:true});
    await rename(file,path.join(directory,'audio.wav'));
    await writeFile(path.join(directory,'metadata.json'),JSON.stringify({id,...value}));
    return {id,...value};
  }finally{await rm(temp,{recursive:true,force:true});}
}
export function audioResourceService(root){return async(req,res,url,send,token)=>{
  if(!url.pathname.startsWith('/api/resources/'))return false;
  if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
  try{
    if(url.pathname==='/api/resources/audio'&&req.method==='POST'){
      const metadata={source:url.searchParams.get('source'),audioStart:Number(url.searchParams.get('start')),audioEnd:Number(url.searchParams.get('end')),model:url.searchParams.get('model')};
      send(200,await saveAudioResource(root,req,metadata,120*1024*1024));return true;
    }
    const match=/^\/api\/resources\/audio\/([a-f0-9]{64})$/.exec(url.pathname);
    if(match&&req.method==='GET'){send(200,await openAudioFile(path.join(root,'runtime','audio-resources',match[1],'audio.wav')),'audio/wav');return true;}
    send(404,{error:'资源不存在'});
  }catch(e){if(!res.destroyed)send(e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'音频资源缺失，请重新关联原音':e.message});}return true;
};}
