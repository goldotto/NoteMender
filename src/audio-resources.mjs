import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {TRACKS} from '../public/candidate-tools.mjs';
export async function saveAudioResource(root,bytes,metadata={}){
  const source=TRACKS.includes(metadata.source)?metadata.source:'original';
  const audioStart=Number(metadata.audioStart||0),audioEnd=Number(metadata.audioEnd);
  if(!Number.isFinite(audioStart)||audioStart<0||!Number.isFinite(audioEnd)||audioEnd<=audioStart||audioEnd>3600)throw Error('无效资源时间范围');
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('需要 WAV 音频');
  const value={source,audioStart,audioEnd,model:String(metadata.model||'original').slice(0,80)};
  const id=createHash('sha256').update(bytes).update(JSON.stringify(value)).digest('hex'),directory=path.join(root,'runtime','audio-resources',id);
  await mkdir(directory,{recursive:true});
  const temp=path.join(directory,randomUUID()+'.tmp');
  try{await writeFile(temp,bytes);await rename(temp,path.join(directory,'audio.wav'));}finally{await unlink(temp).catch(()=>{});}
  await writeFile(path.join(directory,'metadata.json'),JSON.stringify({id,...value}));
  return {id,...value};
}
export function audioResourceService(root){return async(req,res,url,send,token)=>{
  if(!url.pathname.startsWith('/api/resources/'))return false;
  if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
  try{
    if(url.pathname==='/api/resources/audio'&&req.method==='POST'){
      let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>120*1024*1024)throw Error('音频资源过大');chunks.push(c);}
      send(200,await saveAudioResource(root,Buffer.concat(chunks),{source:url.searchParams.get('source'),audioStart:Number(url.searchParams.get('start')),audioEnd:Number(url.searchParams.get('end')),model:url.searchParams.get('model')}));return true;
    }
    const match=/^\/api\/resources\/audio\/([a-f0-9]{64})$/.exec(url.pathname);
    if(match&&req.method==='GET'){send(200,await readFile(path.join(root,'runtime','audio-resources',match[1],'audio.wav')),'audio/wav');return true;}
    send(404,{error:'资源不存在'});
  }catch(e){send(e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'音频资源缺失，请重新关联原音':e.message});}return true;
};}
