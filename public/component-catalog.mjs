export const COMPONENTS=Object.freeze([
  {id:'base',name:'基础编辑与扒谱',description:'简谱编辑、试听、Basic Pitch 与 Pitchy 识别。基础版已经包含。',download:'基础版已包含',space:0,required:true},
  {id:'audio',name:'人声与器乐分轨',description:'Demucs 四轨分离；支持人声、贝斯、鼓和其他器乐。基础离线版包含。',download:'约 0.65 GB（缺失时）',space:3},
  {id:'six',name:'吉他／钢琴分轨',description:'Demucs 六轨模型，增加吉他与钢琴的独立候选。基础离线版包含。',download:'约 55 MB（缺失时）',space:.12,requires:['audio']},
  {id:'lyrics',name:'歌词识别与时间对齐',description:'Qwen3-ASR 0.6B 与 ForcedAligner。自动转写及对齐歌词；不安装也能手工输入歌词。',download:'约 3.9 GB',space:4.5,requires:['audio']},
  {id:'gpu',name:'NVIDIA 显卡加速',description:'CUDA 12.8 的 PyTorch 与 ONNX Runtime。用于合格的分轨与音高路径；安装不代表所有模型都已通过一致性验证。需要兼容的 NVIDIA 显卡和驱动。',download:'约 3 GB',space:12,requires:['audio']},
  {id:'cpu',name:'原生 CPU 推理组件',description:'ONNX Runtime 多线程后端；未通过一致性检查的 Basic Pitch 路径仍使用当前后端。',download:'约 20 MB',space:.12,requires:['audio']},
  {id:'singing',name:'演唱精细分音（实验）',description:'ROSVOT 额外人声候选，适合比较演唱分音；需要显卡组件与额外检查点。',download:'约 1 GB，依检查点而定',space:3,requires:['audio','gpu']},
]);
export function orderedComponents(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>COMPONENTS.length)throw Error('请选择组件');
  const selected=new Set();
  function add(id){const item=COMPONENTS.find(c=>c.id===id);if(!item||id==='base')throw Error('不支持的组件');for(const dependency of item.requires||[])add(dependency);selected.add(id);}
  ids.forEach(add);return [...selected];
}
export const DOWNLOAD_SOURCES={
  pypi:['https://pypi.tuna.tsinghua.edu.cn/simple','https://mirrors.aliyun.com/pypi/simple/','https://pypi.org/simple'],
  cuda:['https://mirror.sjtu.edu.cn/pytorch-wheels/cu128/','https://download.pytorch.org/whl/cu128/'],
  qwen:['https://modelscope.cn','https://hf-mirror.com','https://huggingface.co'],
};
