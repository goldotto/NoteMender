# NoteMender 2.5.0-demo.7 · 基础离线版与可选组件安装

## 本次修复

- 修复复用外部运行环境时加速验证记录与 ONNX 模型路径读取错误，恢复合格的 NVIDIA 分轨和 CREPE 路径。
- 提供与固定依赖版本匹配的既有验证记录，组件安装后无需重复验证已合格的执行路径；本机验证记录优先，未通过的 Basic Pitch CUDA 路径继续使用 CPU。
- 相同运行环境内切换 CPU／CUDA 分析时复用分析进程，减少重复加载；进度明确区分各模型的实际设备。
- 浏览器容量不足时，候选和替换前备份转存本机文件，避免整曲生成后无法采用；恢复备份兼容旧记录。

## 推荐下载

**[基础离线版 · 约 809 MB](https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/NoteMender-2.5.0-demo.7-windows-base-gui.zip)**：完整 ZIP，解压后运行 `NoteMender/Start-NoteMender.cmd`。包含 Node.js、Python、CPU 音频环境、四／六轨分离模型和浏览器扒谱模型，支持分轨、扒谱、试听和人工编辑。

**[轻量版 · 约 65 MB](https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/NoteMender-2.5.0-demo.7-windows-setup-gui.zip)**：包含程序、Node.js 与 Python 基础解释器，可先编辑及浏览器扒谱；需要的组件再从安装界面下载。

**[源码版](https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/NoteMender-2.5.0-demo.7-source-components.zip)**：开发者自行准备 Node.js 22+。已构建网页、说明和浏览器模型随源码附带。

## 安装界面

1. 首次启动，选择允许扫描已有环境或暂不扫描。
2. 扫描常用 Python 与模型缓存；也可指定已有程序目录。找到后“校验并复用”，直接使用，不复制或升级原环境。
3. 勾选需要的组件再安装。Qwen 歌词、NVIDIA 显卡和 ROSVOT 默认不勾选。界面显示安装位置、空间、阶段进度和详情，支持取消与重试。
4. 点击“进入工作台”。以后从顶部“组件管理”或 `Manage-Components.cmd` 随时添加组件。

缺少对应组件时，自动功能按钮变灰，悬停说明用途及安装入口。手工歌词与简谱编辑仍然可用。

国内源与官方源可选择优先顺序；Python、CUDA、Qwen 提供备用下载源。模型与 CUDA 文件按固定 SHA-256 校验。新组件安装在程序目录，保留 CPU 环境，不安装显卡驱动，不改系统 pip 设置。安装并不代表所有原生推理路径均通过一致性验证，未通过的路径继续回退。

## 校验与使用说明

校验文件：[`SHA256SUMS-components.txt`](https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/SHA256SUMS-components.txt)。[中文说明书](https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/NoteMender-Manual-zh-CN-current.txt)也内置于顶部“使用说明”。桌面包面向 Windows x64。识别结果仍须人工校对。

自有代码 MIT；第三方组件保留原许可，见程序内 `licenses/`。带 FFmpeg 的运行环境对应源码材料见 `runtime-sources.zip` 附件。

