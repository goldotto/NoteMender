# NoteMender

NoteMender 是本机运行的音频转谱与校对工具。从原曲生成旋律候选，边听边改音符与歌词，再把工作区谱子交给内置改谱台修订和输出。

> 2.5.0 安装包和在线更新暂时撤回，等待 MuScriptor 模型选项完善。

[查看可下载版本](https://github.com/goldotto/NoteMender/releases) · [更新说明](RELEASE_NOTES.md) · [使用说明](说明书.txt) · [报告问题](https://github.com/goldotto/NoteMender/issues)

## 从听谱到成品

- **识别。** 传统采谱适合较轻的本机环境。选装 MuScriptor large 可查看多乐器卷帘，逐轨试听、纠错和选择段落候选。也可直接导入 MIDI。
- **校对。** 原曲波形、保音高变速、定位标记与区段复听。可以拖动、框选、剪切、合并音符，把常用旋律存入片段剪贴板。采用候选前自动备份原谱。
- **歌词。** 支持选装识别、导入带时间的歌词、手动对齐与修订。日语歌词可查看罗马音。
- **记谱。** 简谱与五线谱共用工程，五线谱可点音试听及修改音高和时值。简谱预览提供节奏整理、打印／PDF 和 SVG，另可导出 MusicXML、MIDI、WAV 及工程 JSON。
- **改谱台。** 顶栏入口直接打开当前整谱，供后期改谱、排版和成品导出。需要带入原音和对齐点时，从「导出乐谱」选择「送到改谱台」。
- **语言。** 界面和使用说明支持简体中文、English、日本語。

识别结果需要听审。工作区编辑以单旋律为主。分轨和乐器分类可能出错，可以在采用前比较候选。

## Windows x64 安装

| 安装包 | 内置内容 | 离线能力 |
| --- | --- | --- |
| 基础版（推荐，base） | 精简版全部内容、Python、CPU 音频环境、扒谱及四／六轨分轨模型 | 扒谱、分轨、编辑、试听与导出 |
| 精简版（lite） | 程序、Node.js、内置说明与小型采样音色 | 编辑、试听、MIDI 和歌词导入与谱子导出 |

从 [GitHub 发行页](https://github.com/goldotto/NoteMender/releases) 下载对应的完整 Setup.exe，并对照 SHA256SUMS。选装 Qwen 歌词、NVIDIA 加速、ROSVOT 和 MuScriptor 可以在安装后通过「组件管理」添加。MuScriptor 权重需取得官方授权。安装包未使用 Windows 发布者证书。

已有具备签名安装凭据的版本可通过「版本与更新」从 GitHub 下载小型程序更新，保留模型、组件及工作数据。旧版如果只看到国内索引，请将来源切到 GitHub 后重新检查。无法在线升级时，先保存工程和原音，再安装到新目录，从组件管理复用已有环境。见[安装与迁移](docs/安装与迁移.md)。

[CNB 镜像仓库](https://cnb.cool/goldotto/NoteMender)和 [Gitee 镜像仓库](https://gitee.com/goldotto/note-mender)上的版本以各自发行页为准。

## 从源码运行

需要 Node.js 22 或更新版本。

~~~sh
npm ci
npm run build
npm start
~~~

服务监听本机。使用「组件管理」添加分析能力，或指定已有兼容环境。程序不修改系统 Python 或安装显卡驱动。开发与回归可运行 npm test，识别细节见[识别方案](docs/识别方案说明.md)、[组件说明](docs/组件说明.md)和[五线谱工作区](docs/五线谱模式框架.md)。

## 反馈与许可证

问题可在 [GitHub Issues](https://github.com/goldotto/NoteMender/issues) 提交，也可通过程序内邮件反馈发送至 goldotto@proton.me。请提供版本、构建编号及复现步骤。程序不自动上传工程、音频或诊断报告。

NoteMender 自有代码采用 [MIT](LICENSE)。内置改谱台及其他上游资源保留各自许可证。MuScriptor 权重受 CC BY-NC 4.0 和附加条款限制。FluidR3 预渲染采样保留 CC BY 3.0 署名。详见 [NOTICE](NOTICE) 与[第三方说明](licenses/THIRD_PARTY_NOTICES.md)。
