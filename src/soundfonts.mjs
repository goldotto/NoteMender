import {readFile,stat,mkdir,rename,unlink,open} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SAMPLE_TIMBRES,sampleSpec,sampleURLs} from '../public/timbre-catalog.mjs';
import {componentBinding} from './component-config.mjs';

export const soundfontFile=(directory,spec)=>path.join(directory,spec.instrument+'-mp3.js');
export async function soundfontLocation(root,id,{localOnly=false}={}){const spec=sampleSpec(id);if(!spec)throw Error('未知采样音色');const builtin=path.join(root,'public','soundfonts');try{await stat(soundfontFile(builtin,spec));return {directory:builtin,external:false,builtin:true};}catch(error){if(error.code!=='ENOENT')throw error;}const binding=localOnly?null:await componentBinding(root,'sound-'+spec.id);return {directory:binding?.directory||path.join(root,'runtime','soundfonts'),external:Boolean(binding)};}
export function parseSoundfont(bytes,spec){
  if(bytes.length!==spec.size||createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw Error('采样音色文件不完整或校验失败，请重新安装。');
  // Consume only the pinned object literal as data. Never evaluate the JS wrapper.
  const source=bytes.toString('utf8'),marker='MIDI.Soundfont.'+spec.instrument+' = ',at=source.indexOf(marker);if(at<0)throw Error('采样文件格式不符');
  const samples=JSON.parse(source.slice(at+marker.length).trim().replace(/;\s*$/,'').replace(/,\s*}$/,'}')),result={};
  const names=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  for(let midi=21;midi<=108;midi++){const name=names[midi%12]+(Math.floor(midi/12)-1),value=samples[name];if(typeof value!=='string'||!/^data:audio\/mp3;base64,[A-Za-z0-9+/]+=*$/.test(value))throw Error('采样缺失或格式错误：'+name);result[midi]=value;}
  return result;
}
export async function inspectSoundfont(root,id,where){try{const spec=sampleSpec(id),file=soundfontFile(where.directory,spec),info=await stat(file);if(info.size!==spec.size)throw Error('音色文件缺失或未下载完整');parseSoundfont(await readFile(file),spec);return {ready:true};}catch(error){return {ready:false,reason:error.code==='ENOENT'?'尚未安装此乐器采样':error.message};}}

export async function installSoundfont(root,id,{region='auto',signal,onProgress=()=>{},fetchImpl=fetch}={}){
  const spec=sampleSpec(id),where=await soundfontLocation(root,id,{localOnly:true}),target=soundfontFile(where.directory,spec),partial=target+'.part';
  await mkdir(where.directory,{recursive:true});if((await inspectSoundfont(root,id,where)).ready)return;
  const errors=[];
  for(const url of sampleURLs(spec,region)){
    signal?.throwIfAborted();const timeout=AbortSignal.timeout(90000),combined=signal?AbortSignal.any([signal,timeout]):timeout;let file;
    try{await unlink(partial).catch(()=>{});onProgress({stage:'下载'+spec.name+'采样 · '+new URL(url).hostname,progress:0});const response=await fetchImpl(url,{signal:combined});if(!response.ok||!response.body)throw Error('HTTP '+response.status);file=await open(partial,'w');let length=0;for await(const chunk of response.body){combined.throwIfAborted();length+=chunk.length;if(length>spec.size)throw Error('采样文件大小异常');await file.write(chunk);onProgress({progress:length/spec.size});}await file.close();file=null;parseSoundfont(await readFile(partial),spec);await rename(partial,target);return;
    }catch(error){if(signal?.aborted)throw error;errors.push(new URL(url).hostname+'：'+error.message);}finally{await file?.close().catch(()=>{});await unlink(partial).catch(()=>{});}
  }throw Error('采样下载未完成，可重试。'+errors.join('；'));
}

export function soundfontService(root){let cached=null;
  return async(req,res,url,send,token)=>{
    if(!url.pathname.startsWith('/api/timbres/'))return false;
    if(req.headers['x-studio-token']!==token){send(403,{error:'会话已过期，请刷新'});return true;}
    try{if(req.method!=='GET'){send(405,{error:'方法不支持'});return true;}const id=url.pathname.slice('/api/timbres/'.length),spec=sampleSpec(id);if(!spec){send(404,{error:'未知采样音色'});return true;}const where=await soundfontLocation(root,id),file=soundfontFile(where.directory,spec),info=await stat(file),key=file+':'+info.mtimeMs+':'+info.size;if(cached?.key!==key)cached={key,bank:parseSoundfont(await readFile(file),spec)};send(200,cached.bank);}catch(error){cached=null;send(400,{error:error.code==='ENOENT'?'内置乐器采样缺失，请修复程序文件；暂用合成音色。':error.message});}return true;
  };
}
