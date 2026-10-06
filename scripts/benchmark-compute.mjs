import * as tf from '@tensorflow/tfjs';
import {BasicPitch,outputToNotesPoly,noteFramesToTime} from '@spotify/basic-pitch';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NativeAnalysis} from '../src/native-analysis.mjs';
import {modelFingerprint} from '../src/compute-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const device=process.argv.includes('--cuda')?'cuda':'cpu',arg=process.argv.indexOf('--seconds'),seconds=arg>=0?Number(process.argv[arg+1]):null;
const gpuCPU=process.argv.includes('--gpu-cpu'),runtimeDevice=gpuCPU?'cuda':device,gateKey=gpuCPU?'cudaCPU':device;
const useReference=process.argv.includes('--use-reference'),referenceDir=path.join(root,'runtime/acceleration/tfjs-reference');
const runner=new NativeAnalysis(root),reports=[];
function wavSamples(bytes){
  let pos=12,fmt,data;
  while(pos+8<=bytes.length){const name=bytes.toString('ascii',pos,pos+4),size=bytes.readUInt32LE(pos+4);if(name==='fmt ')fmt=bytes.subarray(pos+8,pos+8+size);if(name==='data')data=bytes.subarray(pos+8,pos+8+size);pos+=8+size+(size%2);}
  if(!fmt||!data||fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(2)!==1||fmt.readUInt32LE(4)!==22050||fmt.readUInt16LE(14)!==16)throw Error('验收素材应为 22050Hz 单声道 PCM16 WAV');
  return Float32Array.from({length:Math.min(data.length/2,seconds?Math.floor(seconds*22050):Infinity)},(_,i)=>data.readInt16LE(i*2)/32768);
}
const notes=(frames,onsets,onset=.22,frame=.16,length=6,low=45)=>noteFramesToTime(outputToNotesPoly(frames,onsets,onset,frame,length,true,440*2**((88-69)/12),440*2**((low-69)/12)));
const sameNotes=(before,after)=>before.length===after.length&&before.every((note,i)=>note.pitchMidi===after[i].pitchMidi&&Math.abs(note.startTimeSeconds-after[i].startTimeSeconds)<1e-8&&Math.abs(note.durationSeconds-after[i].durationSeconds)<1e-8);
function matrices(result){const array=new Float32Array(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength/4),rows=result.metadata.rows,frames=[],onsets=[];for(let row=0;row<rows;row++){frames.push(Array.from(array.subarray(row*88,(row+1)*88)));onsets.push(Array.from(array.subarray(rows*88+row*88,rows*88+(row+1)*88)));}return {frames,onsets};}
try{
  await tf.setBackend('cpu');await tf.ready();
  const json=JSON.parse(await readFile(path.join(root,'public/models/basic-pitch/model.json'),'utf8')),weights=[];
  for(const group of json.weightsManifest)for(const name of group.paths)weights.push(await readFile(path.join(root,'public/models/basic-pitch',name)));
  const buffer=Buffer.concat(weights),model=await tf.loadGraphModel({load:async()=>({modelTopology:json.modelTopology,signature:json.signature,weightSpecs:json.weightsManifest.flatMap(x=>x.weights),weightData:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)})}),basic=new BasicPitch(Promise.resolve(model));
  const manifest=JSON.parse(await readFile(path.join(root,'runtime/review-corpus/manifest.json'),'utf8'));
  const clips=manifest.clips||manifest.samples;
  if(!Array.isArray(clips))throw Error('验收素材清单缺少 clips');
  const probe=await runner.request({kind:'probe'},{device:runtimeDevice});
  const baselineFingerprint=await modelFingerprint(root);
  if(!seconds&&!useReference)await mkdir(referenceDir,{recursive:true});
  let warmed=false;
  for(const clip of clips){
    const name=clip.audio||clip.file||clip.wav||clip.id+'.wav',samples=wavSamples(await readFile(path.join(root,'runtime/review-corpus',name))),started=performance.now(),frames=[],onsets=[];
    const referenceName=path.join(referenceDir,clip.id),audioHash=createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex');
    let legacyMs;
    if(useReference){
      const reference=JSON.parse(await readFile(referenceName+'.json','utf8'));
      if(reference.model!==baselineFingerprint||reference.audioHash!==audioHash)throw Error('冻结概率基线的音频或模型发生变化，需要重新生成');
      const cached=matrices({metadata:{rows:reference.rows},bytes:await readFile(referenceName+'.bin')});
      frames.push(...cached.frames);onsets.push(...cached.onsets);legacyMs=reference.legacyMs;
    }else{
      tf.engine().startScope();try{await basic.evaluateModel(samples,(f,o)=>{frames.push(...f);onsets.push(...o);},()=>{});}finally{tf.engine().endScope();}
      legacyMs=performance.now()-started;
      if(!seconds){const values=Float32Array.from([...frames.flat(),...onsets.flat()]);await writeFile(referenceName+'.bin',Buffer.from(values.buffer));await writeFile(referenceName+'.json',JSON.stringify({model:baselineFingerprint,audioHash,rows:frames.length,legacyMs}));}
    }
    const raw=await runner.analyse(Buffer.from(samples.buffer),'basic',{device:runtimeDevice,actualDevice:device},{},undefined),native=matrices(raw),before=notes(frames,onsets),after=notes(native.frames,native.onsets);
    let maximum=0,sum=0,count=0,shape=frames.length===native.frames.length;
    if(shape)for(const [a,b] of [[frames,native.frames],[onsets,native.onsets]])for(let i=0;i<a.length;i++)for(let j=0;j<88;j++){const delta=Math.abs(a[i][j]-b[i][j]);maximum=Math.max(maximum,delta);sum+=delta;count++;}
    const comparisons=[];
    for(const [onset,frame] of [[.22,.16],[.3,.25]])for(const length of [1,6])for(const low of [21,45])comparisons.push({onset,frame,length,low,equal:sameNotes(notes(frames,onsets,onset,frame,length,low),notes(native.frames,native.onsets,onset,frame,length,low))});
    const equal=sameNotes(before,after)&&comparisons.every(x=>x.equal);
    const key=note=>[note.pitchMidi,note.startTimeSeconds,note.durationSeconds].join(':');
    const oldKeys=new Set(before.map(key)),newKeys=new Set(after.map(key));
    const noteDifferences={removed:before.filter(n=>!newKeys.has(key(n))),added:after.filter(n=>!oldKeys.has(key(n)))};
    if(!equal)await writeFile(path.join(root,'runtime/acceleration',`differences-${gateKey}-${clip.id}.json`),JSON.stringify({clip:clip.id,noteDifferences,comparisons},null,2));
    const report={clip:clip.id||name,seconds:samples.length/22050,legacyMs,native:raw.metadata,maximum,mean:sum/(count||1),shape,noteAgreement:equal,comparisons,notesBefore:before.length,notesAfter:after.length,cold:!warmed,passed:shape&&equal&&maximum<=1e-4&&sum/(count||1)<=1e-5&&raw.metadata.device===device};warmed=true;reports.push(report);console.log(JSON.stringify(report));
    if(!report.passed)break;
    if(seconds)break;
  }
  const passed=!seconds&&reports.length===clips.length&&reports.every(x=>x.passed),directory=path.join(root,'runtime/acceleration');await mkdir(directory,{recursive:true});
  const onnxFingerprint=createHash('sha256').update(await readFile(path.join(root,'runtime/models/basic-pitch/nmp.onnx'))).digest('hex'),legacyFingerprint=await modelFingerprint(root);
  await writeFile(path.join(directory,`benchmark-${gateKey}${seconds?'-smoke':''}.json`),JSON.stringify({at:new Date().toISOString(),device,passed,partial:Boolean(seconds),referenceUsed:useReference,probe,reports},null,2));
  let gate={};try{gate=JSON.parse(await readFile(path.join(directory,'qualification.json'),'utf8'));}catch{}
  // A short smoke test never marks an untested backend as qualified.
  if(!seconds){gate[gateKey]={passed,legacyFingerprint,onnxFingerprint,runtimeVersion:probe.ortVersion,torchVersion:runtimeDevice==='cuda'?probe.torchVersion:null,adapterVersion:1};await writeFile(path.join(directory,'qualification.json'),JSON.stringify(gate,null,2));}
  model.dispose();console.log(passed?'全部冻结素材通过，一致性后端已启用。':'本次未启用新后端，请检查差异报告。');
}finally{runner.stop();}
