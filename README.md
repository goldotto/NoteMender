# NoteMender

本机运行的单旋律简谱制作与校对工具。自动识别提供候选，你可以一边听原曲，一边修改音符和歌词，最后整理并导出谱子。

[CNB 国内源码与下载](https://cnb.cool/goldotto/NoteMender) · [GitHub](https://github.com/goldotto/NoteMender) · [Gitee](https://gitee.com/goldotto/note-mender) · [更新说明](RELEASE_NOTES.md) · [使用说明](说明书.txt)

## 主要功能

- 音符跨行拖动、精确时间调整、框选、复制粘贴、切割、合并与撤销重做。
- 数字唱名选音，同时保留专业音高选择；连续写音符支持排队、试听后一次写入。
- 原音波形、实时拍位、标记循环与 0.10–2.00 倍保音高变速。
- 按段生成、比较和采用候选；未经确认不覆盖正式谱。
- 歌词转写、原音对齐、人工校对及关联编辑；音符与歌词联动默认关闭。
- 多种合成与采样音色，独立正式简谱排版，打印／PDF、SVG、MIDI、WAV 和 JSON 导出。
- 可选组件检查、下载及已有环境复用，运行日志与可预览的问题报告。
- 五线谱提供模式入口和筹备框架，尚不支持正式绘制、编辑。

自动识别可能漏音、错音或识别错误时长，复杂伴奏和快速演唱尤其需要人工校对。

## Windows 安装

Windows 安装包内置 CNB 国内更新入口，构建编号以发行页、安装包文件名和程序“版本与更新”显示为准。旧构建首次迁移请先保存工作并关闭程序，再将相同版本类型的安装包安装到新的空目录；保留旧目录及模型，从组件管理复用已有环境，之后可在程序内检查并下载更新。

在 [CNB 发行版](https://cnb.cool/goldotto/NoteMender/-/releases/tag/v2.5.0-demo.7) 下载 Windows x64 完整 EXE；另有 [GitHub 发行版](https://github.com/goldotto/NoteMender/releases) 和 [Gitee 发行版](https://gitee.com/goldotto/note-mender/releases)。各站附件以对应发行页为准。

| 版本 | 内置内容 | 适用场景 |
| --- | --- | --- |
| 精简版 | 程序、Node.js、说明与小型采样音色；无 Python 或分析模型 | 人工编辑、试听、MIDI 导入与谱子导出 |
| 基础版（推荐） | 精简版全部内容，加 Python、CPU 音频环境、扒谱模型及四／六轨分轨模型 | 离线扒谱、分轨、人工校对与导出 |

安装包都是完整文件，无需合并分片。Qwen 歌词、NVIDIA 加速、ROSVOT、MuScriptor 为选装项，默认不下载。MuScriptor 权重需要按官方条款申请访问，不随程序公开转存。

运行安装包并选择新的空目录。可选组件在安装后的本机组件页面继续检查、复用和下载，也可以跳过。请对照所下载文件的 SHA-256 核验完整性。安装包未使用 Windows 发布者证书签名。

已有用户先保存工程、候选与原音资源，保留旧目录，再按[安装与迁移](docs/安装与迁移.md)操作。普通程序更新保留已有模型和组件；不能通过在线检查获得可信信息时，使用发行版中的完整安装包。旧 ZIP 缺少有效更新凭据时需要一次手动迁移。

## 从源码运行

需要 Node.js 22+：

~~~text
npm ci
npm run build
npm start
~~~

服务仅监听本机。精简源码不附带个人运行环境或模型；从“组件管理”添加分析能力，也可以经检查后复用已有兼容环境。不会覆盖系统 Python 或安装显卡驱动。首次加载模型可能较慢，建议先分析短片段。

## 基本使用

1. 导入音频，生成所需区间的候选；也可直接导入 MIDI 或手工输入。
2. 试听比较候选，确认后放入工作区修改。
3. 慢放或循环原音，点击音符修改；Ctrl 多选或框选可进行批量操作。
4. 需要歌词时，先校正文字与原曲时间，再关联音符。
5. 经常保存 JSON 工程；更换设备时同时迁移原音资源或重新关联。
6. 从“导出乐谱”进入正式简谱排版，调整导出副本并预览、打印或下载。

程序顶部“使用说明”可搜索完整说明，另见[识别方案](docs/识别方案说明.md)、[组件说明](docs/组件说明.md)及[五线谱框架](docs/五线谱模式框架.md)。

## 开发与反馈

~~~text
npm test
~~~

程序入口为 server.mjs，编辑器为 public/app.mjs，浏览器分析入口为 src/worker.mjs。构建与测试文件随源码提供。

问题可提交到 [Gitee Issues](https://gitee.com/goldotto/note-mender/issues)、[GitHub Issues](https://github.com/goldotto/NoteMender/issues)，或发送到公开反馈邮箱 goldotto@proton.me。请附版本、构建编号、复现步骤及检查过的报告，勿附凭据、私人路径或未经授权的歌曲。程序不会自动上传工程、音频或错误报告。

## 许可证与第三方项目

自有代码采用 [MIT](LICENSE)，允许商用。第三方组件与模型各自遵守原许可，并不统一变成 MIT。

主要使用 Basic Pitch、Pitchy、Demucs、librosa／pYIN、torchcrepe、Qwen3-ASR、ROSVOT、MuScriptor、ONNX Runtime、TensorFlow.js、SoundTouchJS 和 Tonejs/Midi。MuScriptor 权重受 CC BY-NC 4.0 及附加条款限制；FluidR3 预渲染采样保留 CC BY 3.0 署名材料。完整来源见 [NOTICE](NOTICE)、[第三方说明](licenses/THIRD_PARTY_NOTICES.md)和随包许可证。
