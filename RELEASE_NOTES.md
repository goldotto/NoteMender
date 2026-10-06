# NoteMender 2.5.0-demo.7

## 下载选项

| 版本 | 下载大小（约） | 包含功能 |
| --- | --- | --- |
| 源码版 | 1.9 MB | 源码、构建文件和使用说明 |
| 下载环境版 | 65 MB | 程序、Node.js 和基础 Python；功能组件按需安装 |
| 标准离线版 | 4.78 GB，小分片 | CPU 识别、四／六轨分离、Qwen 歌词转写及对齐 |
| 显卡离线扩展 | 4.29 GB，小分片 | 可用的 NVIDIA 计算组件；安装到标准离线版 |

- **下载环境版**：`windows-setup.zip`。附 Node.js 与 Python 基础解释器；按需运行 `Download-Components.cmd` 下载分轨、歌词或显卡组件。
- **标准离线版**：下载 `windows-offline.zip.001` 等全部分片、`offline-manifest.json`、`Extract-NoteMender.ps1` 与 `Extract-NoteMender.cmd`，放在同一目录，运行解压脚本。附 CPU 音频环境、四／六轨 Demucs 和 Qwen 歌词模型，解压后启动即可使用。
- **源码版**：`source.zip`，供开发者构建；需要 Node.js 22+。
- **显卡离线扩展**：下载 `windows-gpu-addon.zip.001` 等全部显卡分片、`gpu-manifest.json`、`Extract-GPU-Addon.cmd` 和共用的 `Extract-NoteMender.ps1`。运行显卡解压脚本后，在解压目录运行 `Install-GPU-Addon.cmd`，输入标准离线版程序目录。包含 PyTorch／torchaudio 2.7.1+cu128 与 ONNX Runtime GPU 1.22.0；需要相容的 NVIDIA 驱动，CPU 环境保留。

解压后双击 `Start-NoteMender.cmd`。标准离线版使用 CPU；显卡扩展按已有一致性验证启用可用路径，未通过的路径继续回退。ROSVOT 保留可选下载入口。

标准离线版解压过程建议预留 12 GB 空闲空间；同时保留所有下载分片、扩展解压目录并安装显卡扩展时，建议预留 30 GB。完成后可以删除下载分片和显卡扩展的解压目录，保留安装好的程序目录。所有下载文件的大小与 SHA-256 见 `SHA256SUMS.txt` 和分片清单。

## 修复

全部分片也可一键下载：下载 `Download-Release-Parts.ps1` 与 `Download-Offline.cmd`（标准离线版）或 `Download-GPU-Addon.cmd`（显卡扩展），放到准备存放安装包的目录，运行对应 CMD。脚本复用已下载文件，校验 SHA-256，未完成的下载可续传。下载完成后再运行解压 CMD。两个离线包总大小不变，采用约 200 MB 小分片。

- 补齐歌词接口依赖的 Qwen 适配器，防止组件显示就绪但无法执行。
- 修复歌词组件在含中文和空格的安装目录中初始化失败的问题。
- 自动节拍测量不可用时，使用当前 BPM 生成候选并显示提醒。
- 加速环境同时检查实际包文件；仅有就绪标记不会被误认为安装成功。
- 启动与下载入口统一为 NoteMender 名称；组件下载增加国内镜像及官方源回退。

自动识别仍需要人工核对。正式谱保持单声部；复杂伴奏、滑音和快速演唱可能漏音、错音或时值错误。工程另存为 JSON；换设备需复制音频资源或重新关联原音。

## 第三方运行组件

项目自有代码采用 MIT。整合包依赖保留各自许可；FFmpeg 动态库及对应源代码说明见 `licenses/BUNDLED_RUNTIME_NOTICES.md` 和本 Release 的运行组件源码附件。
