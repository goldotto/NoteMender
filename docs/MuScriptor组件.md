# MuScriptor large：安装、候选与验证范围

## 当前实现

- 可选识别器，默认仍为现有自动策略；选择 MuScriptor 时直接分析所选原曲范围，不再额外运行 Demucs、Qwen、ROSVOT 或 Basic Pitch。
- 固定 `muscriptor==0.3.0` 和 **large** 权重。模型约 13 亿参数，权重 5,465,642,136 字节；不会自动改用 medium/small。
- 普通模式使用 CPU；高性能模式的自动／NVIDIA 设备先尝试 CUDA，GPU 不可用或显存不足则用同一 large 模型重试 CPU。CPU 可指定线程。
- 选择 MuScriptor 后提供自动／FP16／BF16／FP32 精度。本机偏好不写入工程。自动模式在 CUDA 使用 FP16，CPU 始终 FP32。半精度仅用于 Transformer 权重与计算，音频特征和条件编码保持 FP32；显式关闭上游固定 FP16 autocast，避免 BF16 被悄悄改回 FP16。
- CUDA 检查点暂存 CPU，避免两份 GPU 权重同时占显存。加载仍短暂创建 FP32 模型，因此加载峰值不会随推理显存减半；8GB 显卡仍可能因可用显存不足回退。半精度不支持或非有限数值时重试 CUDA FP32；CUDA 不可用或显存不足直接转 CPU，不冒险用更大显存的 FP32 重试。
- 各精度、设备、适配器版本分别缓存；摘要显示实际精度和回退原因。贪心解码也可能因浮点差异产生不同音符，不能承诺半精度与 FP32 完全相同。
- 固定贪心解码、批大小 1、上游 5 秒上下文连续处理；不调用额外节拍识别模型。
- 模型输出按乐器家族提供连续／高／低声部的单旋律候选，不是新的分离音轨。检测到 voice 时优先展示人声；其他家族按名称排序，不能将吉他伴奏候选直接当作歌曲主旋律。
- 近同时且重叠的和弦音合组后选择声部，避免起音抖动造成碎音；重复同音及不重叠的快音分开保留。连续声部按前后音高连贯性整理，不再固定偏向 MIDI 60。仍可能选错声部，不保证人声识别正确。
- 原始多音音符和多轨 MIDI 保存到 `runtime/muscriptor/cache`；在候选窗口可导出原始 MIDI。正式谱仍需确认采用，不自动覆盖手改内容。
- 已有 MuScriptor 候选可点击“重新整理候选”，读取缓存中的原始结果，不重新运行模型；最初的候选保留为“整理前备份”。缓存已清理时明确提示，原候选不受影响。
- 短音、重复同音不设额外 70–80ms 过滤／合并。单旋律提取仍会舍去和弦其他音；编辑网格碰撞、超出所选音域会明确列在候选摘要，原始结果不因此删除。
- 接入现有候选恢复／采用／备份机制；候选的乐器家族、模型和分析编号保存进工程。取消会结束计算并清理本次临时目录。

## 安装

1. 打开“组件管理”，选择“MuScriptor large 多乐器转谱（实验）”。复用现有 Python/PyTorch，不覆盖显卡环境。
2. 在 [large 官方页面](https://huggingface.co/MuScriptor/muscriptor-large) 登录并接受该仓库条款。medium 授权不代替 large 授权。
3. 阅读组件卡片的许可提示并确认。可选两种权重来源：
   - 已有 `model.safetensors`：填写完整本机文件路径；按固定大小及 SHA-256 校验后复用。
   - 尚未下载：在卡片临时填写能读取此受限仓库的 Hugging Face 只读令牌，点击安装。令牌不写入配置、工程或日志；无需向开发者发送令牌。
4. 安装与下载进度、取消、失败重试沿用组件管理。权重仅从 Hugging Face 官方仓库下载；凭据不交给第三方镜像。下载失败不显示已安装。
5. 安装通过后在“本机扒谱方式”选 MuScriptor large，先试短片段，再自行听审。需要 GPU 时同时选择高性能模式。

运行资源在 `runtime/muscriptor`，推理依赖在其 `dependencies` 子目录。离线使用无需令牌；下载完成后可撤销令牌。不要将带个人路径的 runtime 配置、诊断日志、令牌或私人曲目上传仓库。

## 原始 MIDI 与简谱的区别

原始 MIDI 使用上游 `events_to_midi_bytes` 写出，包含其 MIDI 校验和重叠处理；JSON 保留适配器收集的音符事件。简谱进一步转成单旋律、转换拍位并对齐编辑网格。二者都不代表人工确认的正确答案。MuScriptor 不识别歌词；人声与复杂伴奏是否更好需要逐曲比较，不能以输出音符更多为准。

## 固定制品与许可

- 代码：[muscriptor/muscriptor](https://github.com/muscriptor/muscriptor)，PyPI 0.3.0，MIT。
- 权重：`MuScriptor/muscriptor-large`，revision `8809fdfbed2affa7ade94a7059e746e3880720e7`。
- SHA-256：`ac4eb6ea87dfc26b6ca6b954c6b967ab87ad4c7d08e078b25214f13ed051f397`。
- 权重采用 **CC BY-NC 4.0 与作者附加使用条款**；不随本项目改成 MIT。不在基础发行包或源码中夹带 gated 权重。
- 架构固定为 dim=1536、24 heads、48 layers、card=1395；随安装写出对应配置，避免按文件名猜测模型大小。

## 使用限制

原始事件传递正确不代表声部选择或听感正确；不同精度可能输出不同音符。模型需在目标设备与合法样本上自行比较，先用短片段试听。显存取决于精度、加载峰值及其他进程占用；显卡执行失败仍需保留 CPU 回退。

CLI 维护入口：`node scripts/install-muscriptor.mjs`。只检查推理依赖可加 `--dependencies-only`，不会下载权重或写入已安装标记。正常安装要求当前进程环境中 `NOTEMENDER_MUSCRIPTOR_TERMS=accepted`，并提供 `NOTEMENDER_MUSCRIPTOR_FILE` 或 `NOTEMENDER_HF_TOKEN`；不要把令牌写入脚本、命令参数或持久配置。


