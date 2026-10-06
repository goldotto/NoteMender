# NoteMender 2.5.0-demo.7

## 下载选项

- **下载环境版**：`windows-setup.zip`。附 Node.js 与 Python 基础解释器；按需运行 `Download-Components.cmd` 下载分轨、歌词或显卡组件。
- **标准离线版**：下载 `windows-offline.zip.001` 等全部分片、`offline-manifest.json`、`Extract-NoteMender.ps1` 与 `Extract-NoteMender.cmd`，放在同一目录，运行解压脚本。附 CPU 音频环境、四／六轨 Demucs 和 Qwen 歌词模型，解压后启动即可使用。
- **源码版**：`source.zip`，供开发者构建；需要 Node.js 22+。

解压后双击 `Start-NoteMender.cmd`。GPU 与 ROSVOT 是独立可选组件，标准离线版使用 CPU。

## 修复

- 补齐歌词接口依赖的 Qwen 适配器，防止组件显示就绪但无法执行。
- 自动节拍测量不可用时，使用当前 BPM 生成候选并显示提醒。
- 加速环境同时检查实际包文件；仅有就绪标记不会被误认为安装成功。
- 启动与下载入口统一为 NoteMender 名称；组件下载增加国内镜像及官方源回退。

自动识别仍需要人工核对。正式谱保持单声部；复杂伴奏、滑音和快速演唱可能漏音、错音或时值错误。工程另存为 JSON；换设备需复制音频资源或重新关联原音。

## 第三方运行组件

项目自有代码采用 MIT。整合包依赖保留各自许可；FFmpeg 动态库及对应源代码说明见 `licenses/BUNDLED_RUNTIME_NOTICES.md` 和本 Release 的运行组件源码附件。
