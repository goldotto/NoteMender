export function candidateSchemeHelp(method){
  if(method.includes('ROSVOT 原始分音')||method.includes('字词条件'))return 'ROSVOT + RMVPE，输入了 Qwen 的字词时间。这份结果尚未做后续对应修整，但模型分音已经受歌词边界影响；仅作辅助备选，适合核对换字、重新起唱。';
  if(method.includes('ROSVOT')&&(method.includes('字词对应')||method.includes('字词对齐')))return 'ROSVOT 字词条件结果再按文字边界修整。容易过分切音、并音；仅作辅助备选，试听后决定是否采用。';
  if(method.includes('ROSVOT'))return 'ROSVOT 演唱音符模型 + RMVPE 音高模型 + RWBD 边界预测。未输入 Qwen 歌词时间；适合主唱分音对照，不适合器乐。公开权重以中文演唱训练，其他语言需听审。';
  if(method.includes('歌词边界辅助'))return '原声学音符 + Qwen 字词时间 + 起音／停顿证据；只调整有证据的边界，音高沿用原候选。此方案是备选，适合检查重复同音和拖腔末尾。';
  if(/pyin/i.test(method))return 'pYIN 概率音高跟踪，配合程序分音规则；适合清晰人声或单音独奏，是实验对照，不适合和弦混音。';
  if(/crepe/i.test(method))return 'CREPE tiny 神经网络音高跟踪（torchcrepe），配合程序分音规则；适合清晰人声或单音独奏，用于比较音准及八度错误，不做歌词识别。';
  if(method.includes('Pitchy'))return 'Pitchy 的 McLeod 音高检测算法，配合程序分音规则；不是训练模型。适合清晰单音人声、哼唱或独奏，伴奏／和弦可能干扰。';
  if(method.includes('Basic Pitch'))return method.includes('无连续性')?'Basic Pitch 多音符模型，仍会筛选单条旋律，但不对音高跳跃施加连续性约束；适合排查主旋律跳音被删，也可能切换到伴奏。':'Basic Pitch 多音符模型，再按音高连续性／响度等规则筛选单条旋律；适合器乐轨和人声候选对照。';
  if(method.includes('原始候选旋律'))return 'Basic Pitch 原始音符候选包含短音，再筛选单条旋律；不是未经处理的全部模型输出。适合找漏掉的快音，也可能包含伪音。';
  if(method.includes('密集器乐'))return 'Basic Pitch 多音候选 + 程序的连续旋律追踪；适合和弦／多声部器乐，但选出的声部仍需人工确认。';
  if(method.includes('原分音')||method.includes('原首选')||method.includes('先前'))return '保留先前的声学分音或谱面版本，用于对照和恢复。具体模型取决于生成时的扒谱方式及识别链路；歌词对应本身不改变音符。';
  return '本机按段选择：人声以 Basic Pitch 与单音音高证据比较；清晰独奏优先单音跟踪，密集器乐从多音候选筛选主旋律。歌词只附加对应，ROSVOT 不参与默认首选；所用音高跟踪器取决于识别链路设置。';
}
