// Pinned upstream artifacts. Weights have their own noncommercial terms, not MIT.
export const MUSCRIPTOR=Object.freeze({
  version:'0.3.0',variant:'large',repo:'MuScriptor/muscriptor-large',
  revision:'8809fdfbed2affa7ade94a7059e746e3880720e7',
  size:5465642136,sha256:'ac4eb6ea87dfc26b6ca6b954c6b967ab87ad4c7d08e078b25214f13ed051f397',
  config:{dim:1536,num_heads:24,num_layers:48,card:1395},
  wheel:{size:1666422,sha256:'e633f4c8c3d66e9859e87ed6afe9cb6cd9b7dc5be9c1d2b01e5d288773052d24',url:'https://files.pythonhosted.org/packages/10/06/9c282ff269cbf2ae2042b0ff86ac70c8008eaa8093ff6587d3246104192e/muscriptor-0.3.0-py3-none-any.whl'},
  license:'CC BY-NC 4.0 + supplementary terms',adapterVersion:2,
});

export const MUSCRIPTOR_PRECISIONS=Object.freeze(['auto','bf16','fp16','fp32']);
export function normalizeMuPrecision(value){return MUSCRIPTOR_PRECISIONS.includes(value)?value:'auto';}
export function muPrecisionPlan(device,requested){
  if(device!=='cuda')return [{device:'cpu',precision:'fp32'}];
  // FP16 is the measured speed/consistency default. BF16 remains opt-in:
  // its shorter mantissa can change autoregressive note decisions substantially.
  const precision=requested==='auto'?'fp16':requested;
  return [...(precision==='fp32'?[]:[{device:'cuda',precision}]),{device:'cuda',precision:'fp32'},{device:'cpu',precision:'fp32'}];
}
