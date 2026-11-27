// Pinned upstream artifacts. Weights have separate noncommercial terms.
const upstream=Object.freeze({
  version:'0.3.0',
  wheel:{size:1666422,sha256:'e633f4c8c3d66e9859e87ed6afe9cb6cd9b7dc5be9c1d2b01e5d288773052d24',url:'https://files.pythonhosted.org/packages/10/06/9c282ff269cbf2ae2042b0ff86ac70c8008eaa8093ff6587d3246104192e/muscriptor-0.3.0-py3-none-any.whl'},
  license:'CC BY-NC 4.0 + supplementary terms',adapterVersion:2,
});

export const MU_MODEL_IDS=Object.freeze(['small','medium','large']);
export const MU_MODEL_KEY='notemender-mu-model';
function model(variant,revision,size,sha256,dim,num_heads,num_layers,card){
  const repo='MuScriptor/muscriptor-'+variant;
  const page='https://huggingface.co/'+repo;
  return Object.freeze({...upstream,variant,repo,revision,size,sha256,
    name:'MuScriptor '+variant[0].toUpperCase()+variant.slice(1),page,
    files:page+'/tree/'+revision,
    url:page+'/resolve/'+revision+'/model.safetensors',
    space:Math.ceil(size*1.2/1024**3*10)/10,
    config:Object.freeze({dim,num_heads,num_layers,card})});
}

export const MU_MODELS=Object.freeze({
  small:model('small','8c127f603b807520fa465c838e9bfee8a91ada4e',411888600,'bbd482c786b895cf7d8f44185073d951adae2ebb8a66f82ca84cd1f84569549c',768,12,14,1393),
  medium:model('medium','f32236969308476e01fd3aae67357de5feb05a2d',1228144472,'ac80adbdf85d87231735fd948af7013441c0afced316c4e9067fd5d8a7fb97ec',1024,16,24,1395),
  large:model('large','8809fdfbed2affa7ade94a7059e746e3880720e7',5465642136,'ac4eb6ea87dfc26b6ca6b954c6b967ab87ad4c7d08e078b25214f13ed051f397',1536,24,48,1395),
});
// Compatibility for callers without a model field and the original Large cache.
export const MUSCRIPTOR=MU_MODELS.large;
export function muModel(variant='large'){
  if(!MU_MODEL_IDS.includes(variant))throw Error('MuScriptor 模型选项无效');
  return MU_MODELS[variant];
}
export function defaultMuVariant(variants){
  return ['large','medium','small'].find(id=>variants?.[id]?.ready)||'medium';
}
export function muVariantFromModel(value){
  const variant=/^MuScriptor (small|medium|large)$/i.exec(value||'')?.[1].toLowerCase();
  return variant||null;
}

export const MUSCRIPTOR_PRECISIONS=Object.freeze(['auto','bf16','fp16','fp32']);
export function normalizeMuPrecision(value){return MUSCRIPTOR_PRECISIONS.includes(value)?value:'auto';}
export function muPrecisionPlan(device,requested){
  if(device!=='cuda')return [{device:'cpu',precision:'fp32'}];
  // FP16 is the measured speed/consistency default. BF16 remains opt-in:
  // its shorter mantissa can change autoregressive note decisions substantially.
  const precision=requested==='auto'?'fp16':requested;
  return [...(precision==='fp32'?[]:[{device:'cuda',precision}]),{device:'cuda',precision:'fp32'},{device:'cpu',precision:'fp32'}];
}
