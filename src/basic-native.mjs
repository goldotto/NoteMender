import {computeQuery} from '../public/compute-settings.mjs';
export async function nativeBasic(samples,execution,token){
  const device=execution.basicBackend==='onnx-cuda'?'cuda':'cpu';
  const response=await fetch('/api/analysis/basic-pitch?'+computeQuery({...execution,device}),{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/octet-stream'},body:samples});
  if(!response.ok)throw Error((await response.json()).error||'原生 Basic Pitch 失败');
  const metadata=JSON.parse(decodeURIComponent(response.headers.get('X-Analysis-Metadata')||'')),values=new Float32Array(await response.arrayBuffer());
  if(!Number.isInteger(metadata.rows)||metadata.columns!==88||values.length!==metadata.rows*176)throw Error('原生 Basic Pitch 输出形状错误');
  const frames=[],onsets=[],size=metadata.rows*88;
  for(let row=0;row<metadata.rows;row++){frames.push(Array.from(values.subarray(row*88,(row+1)*88)));onsets.push(Array.from(values.subarray(size+row*88,size+(row+1)*88)));}
  return {frames,onsets,metadata};
}
