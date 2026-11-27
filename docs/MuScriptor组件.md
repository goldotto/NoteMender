# MuScriptor 模型配置与使用

## 当前实现

- 在「音频与识别」选择独立的 MuScriptor 模式和已安装的型号。MuScriptor 在 Demucs 就绪时默认分离人声与器乐并按人声活动自动分段。Demucs 不可用时，所选原曲范围按一段识别。识谱只运行 MuScriptor，失败会报告原因。Qwen 可单独开启，ROSVOT 留在传统识谱模式。
- 推理依赖固定 `muscriptor==0.3.0`，支持 Small、Medium、Large。型号作为本机偏好保存；任务开始时锁定，各段及各输入沿用。
- 普通模式使用 CPU；高性能模式的自动／NVIDIA 设备先尝试 CUDA，GPU 不可用或显存不足则用同一型号重试 CPU。CPU 可指定线程。
- 选择 MuScriptor 后提供自动／FP16／BF16／FP32 精度。本机偏好不写入工程。自动模式在 CUDA 使用 FP16，CPU 始终 FP32。半精度仅用于 Transformer 权重与计算，音频特征和条件编码保持 FP32；显式关闭上游固定 FP16 autocast，避免 BF16 被悄悄改回 FP16。
- CUDA 检查点暂存 CPU，避免两份 GPU 权重同时占显存。加载仍短暂创建 FP32 模型，因此加载峰值不会随推理显存减半；8GB 显卡仍可能因可用显存不足回退。半精度不支持或非有限数值时重试 CUDA FP32；CUDA 不可用或显存不足直接转 CPU，不冒险用更大显存的 FP32 重试。
- 型号、精度、设备和适配器版本参与缓存键；摘要显示实际精度和回退原因。贪心解码也可能因浮点差异产生不同音符，不能承诺半精度与 FP32 完全相同。
- 固定贪心解码、批大小 1、上游 5 秒上下文连续处理；不调用额外节拍识别模型。
- “音轨”对应实际输入资源。展开候选中的“MuScriptor 乐器轨”查看这份缓存预测的乐器。彩色卷帘按原曲秒数显示原始短音、同音连击、和弦及鼓点，沿用 [MuScriptor 卷帘的乐器配色](https://github.com/muscriptor/muscriptor/blob/main/web/src/pianoroll.ts)。支持点击定位、独听、逐轨静音和恢复全轨。可从同一位置切换试听原曲和合成 MIDI。程序从当前段取样，按可听轨自动匹配原曲和 MIDI 的试听响度。
- 点击“用此轨生成候选”只更新当前段选择，按时间映射落在 1/16 拍编辑网格上。有复音时只在所选轨内选连续旋律，并显示未采用的原始事件数。其他段的选择仍可随候选暂存恢复。鼓组可试听并保留在原始多轨 MIDI。
- 原有连续／较高／较低旋律在“显示对照与备份”中，当前方案仍显示在常用列表。对选轨候选手动做局部重识别时，仍取同一乐器标签；没有可用音符则保留原候选。
- MuScriptor 有可用分轨时，人声段同时提供人声分离与原曲混音结果；相同资源和分析范围只分析一次，覆盖本段的结果可跨段复用。卷帘的“识别输入”可选吉他、钢琴、贝斯等已分离音频，点击“识别此音轨”只处理当前段落。原曲／MIDI 为试听模式，另有播放／暂停和速度控制。启用编辑可拖动、改长短、补音、删除与撤销，改动在暂存候选中保存并用于转简谱，原始缓存和原始 MIDI 不变。

- 「轨道纠错」用当前段已有的人声分轨给出逐音迁移建议，先预览再应用；支持多来源轨合并和单音／框选迁移。pYIN 与 CREPE 都支持的音高用来筛选错标。疑似重复或在相应伴奏分轨中也检测到的同音，默认留待核对。缺少 CREPE 时会标明使用基础音高证据。合并保留所有事件。迁移随暂存候选保存，可撤销，原始缓存及 MIDI 保持不变。
- 候选标出四轨／六轨来源；同名“其他”来自不同分离模型时可区分。“显示对照与备份”默认收起旧 Pitchy、无连续性对照和备份等项目，当前选中的方案始终保留可见，不删除已有数据。
- 可逐段逐轨选择，也可点击“各段切到 MuScriptor”预览整曲拼接。没有可用 MuScriptor 音符的段落保留原方案并列出名称。试听窗口不限制写入范围；点击采用会先自动备份，再以完整候选覆盖工作区，不再询问采用范围。
- 近同时且重叠的和弦音合组后选择声部，避免起音抖动造成碎音；重复同音及不重叠的快音分开保留。连续声部按前后音高连贯性整理，不再固定偏向 MIDI 60。
- 原始多音音符和多轨 MIDI 保存到 `runtime/muscriptor/cache`；在候选窗口可导出原始 MIDI。正式谱仍需确认采用，不自动覆盖手改内容。
- 有对齐的人声分轨时，pYIN 与 CREPE 的共同音高证据只用于人声重叠音符的择音。证据不足时沿用普通人声候选。选卷帘中的人声轨生成候选也可使用该证据。
- 已有 MuScriptor 候选可点击“重新整理候选”，读取缓存中的原始结果，按需提取人声音高证据，无需重新运行 MuScriptor；最初的候选保留为“整理前备份”。缓存已清理时明确提示，原候选不受影响。
- 有缓存时，MuScriptor 乐器轨旁提供「从缓存重新整理」和「导出原始多轨 MIDI」。
- 短音、重复同音不设额外 70–80ms 过滤／合并。单旋律提取仍会舍去和弦其他音；编辑网格碰撞、超出所选音域会明确列在候选摘要，原始结果不因此删除。
- 接入现有候选恢复／采用／备份机制；候选的实际来源、模型、分析编号和原始分析范围保存进工程。旧式按乐器家族生成的候选仍可读取和整理；须重新生成才能获得统一分段分轨的候选。取消会结束计算并清理本次临时目录。

## 安装

| 型号 | 权重大小 | 建议选法 |
| --- | ---: | --- |
| [Small](https://huggingface.co/MuScriptor/muscriptor-small) | 约 412 MB | 主要用 CPU |
| [Medium](https://huggingface.co/MuScriptor/muscriptor-medium) | 约 1.23 GB | 首次配置 |
| [Large](https://huggingface.co/MuScriptor/muscriptor-large) | 约 5.47 GB | 显存较充足的显卡 |

1. 打开「组件管理 → MuScriptor 多乐器转谱」，选择型号。点「官方模型页」，登录 Hugging Face 并接受该型号的许可及附加条款。换型号时单独确认授权。
2. 点「官方权重下载页」，从卡片链接指向的固定版本下载完整的 `model.safetensors`。各型号的文件同名，建议分别存入 small、medium 和 large 文件夹。
3. 下载完成后回到对应型号，点「导入本机权重」，粘贴 Windows「复制文件地址」得到的路径，确认条款并点「开始安装」。本机导入无需令牌。也可以点「在 NoteMender 内下载」，在密码框填入有该仓库读取权限的 Hugging Face 令牌，再点「开始安装」。
4. 显示「已安装」后，点「去识谱」。确认「音频与识别」显示正确的型号，导入约 5–10 秒的有旋律音频，点「生成简谱」。看到候选谱或乐器卷帘后，可继续试听核对。
5. 遇到 401／403，检查对应仓库的授权和令牌权限。下载中断可重试续传；大小或 SHA-256 校验失败时核对型号及文件是否下载完整。缺少 CPU 音频环境时按组件管理提示安装或复用，初次准备环境可能需联网。显存不足可以换 Small 或 Medium 再试。

[B 站下载参考](https://www.bilibili.com/video/BV16Vnr6TEQa/)

三档共用已检查的推理环境。Small、Medium 分别保存在 `runtime/muscriptor/models/small` 和 `runtime/muscriptor/models/medium`，旧 Large 沿用已就绪的原位置；共享依赖在 `runtime/muscriptor/dependencies`。安装后可离线推理。令牌只用于本次官方下载，下载后可在 Hugging Face 撤销。

## 原始 MIDI 与简谱的区别

原始 MIDI 使用上游 `events_to_midi_bytes` 写出，包含其 MIDI 校验和重叠处理；JSON 保留适配器收集的音符事件。简谱进一步转成单旋律、转换拍位并对齐编辑网格。二者都不代表人工确认的正确答案。MuScriptor 不识别歌词；人声与复杂伴奏是否更好需要逐曲比较，不能以输出音符更多为准。

## 固定制品与许可

- 代码：[muscriptor/muscriptor](https://github.com/muscriptor/muscriptor)，PyPI 0.3.0，MIT。
- 每档固定版本、大小、SHA-256 和架构见 [模型清单](../public/muscriptor-spec.mjs)。本机导入和官方下载都检验固定大小与 SHA-256。
- 权重使用 **CC BY-NC 4.0 与作者附加条款**，各型号的官方链接列在安装部分。公开附件排除三档权重。


## 使用限制

原始事件传递正确不代表声部选择或听感正确；不同精度可能输出不同音符。模型需在目标设备与合法样本上自行比较，先用短片段试听。显存取决于精度、加载峰值及其他进程占用；显卡执行失败仍需保留 CPU 回退。

CLI 维护入口：`node scripts/install-muscriptor.mjs`。只检查推理依赖可加 `--dependencies-only`，不会下载权重或写入已安装标记。CLI 使用 NOTEMENDER_MUSCRIPTOR_VARIANT 指定 small、medium 或 large，默认兼容旧 Large。正常安装要求当前进程环境中 `NOTEMENDER_MUSCRIPTOR_TERMS=accepted`，并提供 `NOTEMENDER_MUSCRIPTOR_FILE` 或 `NOTEMENDER_HF_TOKEN`；不要把令牌写入脚本、命令参数或持久配置。

## 本机异常排查（源码命令）

用 Node.js 22+ 在源码目录运行。

~~~powershell
node scripts/review-muscriptor.mjs '原曲.wav' '原始结果.json' --output '诊断.json'
~~~

原音使用与缓存对应的整曲 PCM16 WAV，可另加 --vocals '人声.wav' 或 --other '其他乐器.wav'。分轨需与原曲从同一时间点开始且覆盖同样长的范围。添加 --clip '切分对照.json' 可读取含原曲秒数的 {clip:[起点,终点],notes:[…]} 实验输出。普通片段缓存用 --clip-cache '片段缓存.json' 起点秒数 指定。两种片段选项都可重复，可加 --compare 起点 终点 统一比较范围。

报告的 windows 给出 5 秒窗的 MIDI 持续时间和原音音高证据。suspected-missing 是疑似漏音，suspected-label 是疑似错标，insufficient-evidence 是证据不足，no-anomaly 表示本窗未检测到异常。repairs 的 from／to 是待核对范围，clipFrom／clipTo 包含重识别所需的前后文。comparisons 中的 added／missing 是 80 毫秒容差下未匹配的起音，需要试听判断是否正确。混音的音高证据以占主导的稳定音为主，弱人声、低音区和复杂复音可能漏检。此命令仅读取原始文件，报告写入新文件或标准输出。
