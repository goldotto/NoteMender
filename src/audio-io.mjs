import {createWriteStream} from 'node:fs';
import {IncomingMessage} from 'node:http';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';

// Keep only the WAV signature and the incremental digest while writing the request.
export async function writeAudioInput(source,file,{limit=Infinity,tooLarge='音频资源过大',signal,hashInput=true}={}){
  const hash=hashInput?createHash('sha256'):null,header=Buffer.alloc(12);
  let size=0;
  async function* chunks(){
    const input=Buffer.isBuffer(source)?[source]:source instanceof IncomingMessage?source.iterator({destroyOnReturn:false}):source;
    for await(const chunk of input){
      signal?.throwIfAborted();
      if(size+chunk.length>limit)throw Object.assign(Error(tooLarge),{code:'AUDIO_TOO_LARGE'});
      if(size<header.length)chunk.copy(header,size,0,Math.min(chunk.length,header.length-size));
      size+=chunk.length;
      hash?.update(chunk);
      yield chunk;
    }
  }
  await pipeline(chunks(),createWriteStream(file,{flags:'wx'}),{signal});
  return {hash,header,size};
}
export const isWave=header=>header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WAVE';

export async function openAudioFile(file){
  const handle=await open(file,'r');
  return handle.createReadStream();
}
