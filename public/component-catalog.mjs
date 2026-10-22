export const COMPONENTS=Object.freeze([
  {id:'base',name:'编辑核心（内置）',description:'人工编辑、试听、MIDI 导入与谱子导出，不包含分析模型。',download:'随程序提供',space:0,required:true},
  {id:'basic',name:'基础扒谱模型',description:'Basic Pitch 浏览器推理模型；基础版内置，精简版可添加。',download:'约 0.9 MB',space:.01},
  {id:'python',name:'Python 基础解释器',description:'仅分析组件需要；隔离在程序目录，不修改系统 Python。',download:'约 16 MB',space:.15},
  {id:'audio-env',name:'CPU 音频环境',description:'Torch CPU、音频解码和音高分析依赖。仅复用实际检查通过的环境。',download:'约 0.6 GB（缺失时）',space:3,requires:['python']},
  {id:'audio',name:'人声与器乐分轨',description:'Demucs 四轨分离；支持人声、贝斯、鼓和其他器乐。基础离线版包含。',download:'约 84 MB（环境另计）',space:.12,requires:['audio-env']},
  {id:'six',name:'吉他／钢琴分轨',description:'Demucs 六轨模型，增加吉他与钢琴的独立候选。基础离线版包含。',download:'约 55 MB（缺失时）',space:.12,requires:['audio']},
  {id:'lyrics',name:'歌词识别与时间对齐',description:'Qwen3-ASR 0.6B 与 ForcedAligner。自动转写及对齐歌词；不安装也能手工输入歌词。',download:'约 3.9 GB',space:4.5,requires:['audio-env']},
  {id:'gpu',name:'NVIDIA 显卡加速',description:'CUDA 12.8 的 PyTorch 与 ONNX Runtime。用于合格的分轨与音高路径；安装不代表所有模型都已通过一致性验证。需要兼容的 NVIDIA 显卡和驱动。',download:'约 3 GB',space:12,requires:['python','basic']},
  {id:'cpu',name:'原生 CPU 推理组件',description:'ONNX Runtime 多线程后端；未通过一致性检查的 Basic Pitch 路径仍使用当前后端。',download:'约 20 MB',space:.12,requires:['python','basic']},
  {id:'singing',name:'演唱精细分音（实验）',description:'ROSVOT 额外人声候选，适合比较演唱分音；需要显卡组件与额外检查点。',download:'约 1 GB，依检查点而定',space:3,requires:['audio','gpu']},
  {id:'muscriptor',name:'MuScriptor large 多乐器转谱（实验）',description:'large 约 13 亿参数；按乐器家族生成多音 MIDI 与单旋律候选。不做歌词识别或音轨分离。权重仅限非商用，须先接受 Hugging Face 条款。优先复用已有 PyTorch。',download:'large 权重约 5.47 GB，另有小型推理依赖',space:7,requires:['audio-env']},
]);
export function orderedComponents(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>COMPONENTS.length)throw Error('请选择组件');
  const selected=new Set();
  function add(id){const item=COMPONENTS.find(c=>c.id===id);if(!item||id==='base')throw Error('不支持的组件');for(const dependency of item.requires||[])add(dependency);selected.add(id);}
  ids.forEach(add);return [...selected];
}
export const DOWNLOAD_SOURCES={
  basic:['https://cdn.jsdelivr.net/gh/spotify/basic-pitch@main/basic_pitch/saved_models/icassp_2022/nmp.onnx','https://fastly.jsdelivr.net/gh/spotify/basic-pitch@main/basic_pitch/saved_models/icassp_2022/nmp.onnx','https://raw.githubusercontent.com/spotify/basic-pitch/main/basic_pitch/saved_models/icassp_2022/nmp.onnx'],
  pypi:['https://pypi.tuna.tsinghua.edu.cn/simple','https://mirrors.aliyun.com/pypi/simple/','https://pypi.org/simple'],
  cuda:['https://mirror.sjtu.edu.cn/pytorch-wheels/cu128/','https://download.pytorch.org/whl/cu128/'],
  qwen:['https://modelscope.cn','https://hf-mirror.com','https://huggingface.co'],
};
