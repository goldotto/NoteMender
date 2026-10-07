# NoteMender（听谱）

本机运行的单声部简谱制作与校对工具。自动识别提供初稿，操作者可以边听原曲边修改音符和歌词。

## 主要功能

- 横向自由缩放的简谱；拖动音符位置、左右边界，或输入精确数值。
- Ctrl 自由多选、跨行框选、复制粘贴、切割、合并、批量升降音和撤销重做。
- 原音波形、播放光标、循环试听与 0.50–1.50 倍保音高慢放。
- 按段生成主旋律候选；切换人声、吉他、钢琴、贝斯等分轨及识别方案。
- 歌词转写、原音时间对齐、同屏编辑；支持按歌词切分长音。音符与歌词联动由操作者主动开启。
- JSON 工程保存与恢复，MIDI 导入，SVG、MIDI、合成 WAV 和打印导出。

自动识别仍可能漏音、错音或把时长识别错。候选经确认后才进入工作区，保留备选供比较；本项目欢迎通过 [Issues](https://github.com/goldotto/NoteMender/issues) 反馈问题或提交修复。

## 界面

![内置示例的简谱编辑界面](docs/editor.jpg)

## 下载与运行

到 [最新预览版](https://github.com/goldotto/NoteMender/releases/tag/v2.5.0-demo.7) 按用途选择。桌面版本支持 Windows x64。

| 下载 | 包含内容 | 使用方式 |
| --- | --- | --- |
| `windows-base-gui.zip` 基础离线版（推荐，约 0.81 GB） | 程序、Node.js、Python、CPU 音频环境和四／六轨分轨模型 | 解压后双击 `Start-NoteMender.cmd`；首次显示安装与组件管理界面 |
| `windows-setup-gui.zip` 轻量版（约 65 MB） | 程序、Node.js、Python 基础解释器及浏览器识别模型 | 可编辑、试听和浏览器扒谱；需要分轨等功能时在组件管理勾选 |
| `source-components.zip` 源码版 | 最新源码、已构建网页、模型和说明 | 自行准备 Node.js 22+；见下面的命令 |

基础版无需首次下载即可分轨、扒谱、试听和人工编辑。Qwen 歌词、NVIDIA 显卡和 ROSVOT 实验组件按需添加，默认不勾选。未安装自动歌词识别时，手工歌词输入与编辑仍然可用。

首次启动会询问是否扫描常用环境和模型缓存；也可跳过。只有你允许后才扫描。发现兼容组件后，点击“校验并复用”直接关联，不重新下载。复用的外部程序和环境应继续保留，换电脑时需要重新关联。

以后随时点击程序顶部“组件管理”，或双击 `Manage-Components.cmd`。安装界面提供组件清单、磁盘空间、下载源选择、进度、取消与重试。新依赖和模型放在本程序目录；不会覆盖系统环境或安装显卡驱动。

下载源提供中国大陆镜像与官方源，失败自动切换。模型文件和 CUDA wheel 使用固定 SHA-256 校验；网络连通性仍取决于所在网络和镜像服务。大型下载支持续传，失败后可在相同目录重试。

```text
npm ci
npm run build
npm start
```

源码版也含已构建网页和浏览器模型；有 Node.js 时可直接使用启动脚本。服务只监听本机，地址由启动器自动打开。标准离线版 CPU 处理耗时取决于歌曲及硬件；原生加速必须通过一致性检查，未通过时继续使用现有浏览器后端。

### 可选组件

打开“组件管理”勾选所需组件即可。人声／器乐四轨及吉他／钢琴六轨在基础版中已经包含；轻量版可补装。Qwen 用于歌词转写和时间对齐，显卡组件用于支持的加速路径，ROSVOT 用于额外的人声候选。安装状态、显卡可用状态与后端一致性验证是不同事项，安装后仍会保留未通过路径的回退。

需要命令行安装的开发者仍可使用 `scripts/install-components.ps1` 和对应单组件脚本。细节见 [组件说明](docs/组件说明.md)。

## 使用

1. 导入歌曲，点“生成简谱”。可只生成指定区块。
2. 在候选窗口选择要保留的音轨及方案，点“放入工作区修改”。收起候选后可再次打开。
3. 慢放或循环原音，点击音符修改；需要多音操作时 Ctrl 点击或框选。
4. 如需歌词，打开“歌词对照”，先校正文字与原音时间，再关联音符。
5. 经常使用“保存工程”另存 JSON。更换设备时复制 `runtime/audio-resources/`，或重新关联原音。

程序顶部“使用说明”提供可搜索的内置说明书；也可阅读 [说明书.txt](说明书.txt) 和 [识别方案说明](docs/识别方案说明.md)。工程 JSON 的导入和保存上限均为 32 MB。

## 反馈与参与

请说明操作步骤、预期结果、实际结果及运行环境。识别问题请标明出错时间、使用的音轨和识别方案；只上传你愿意公开且有权分享的最小复现素材。

```text
npm ci
npm run build
npm test
```

程序入口为 `server.mjs`，编辑器为 `public/app.mjs`，浏览器识别入口为 `src/worker.mjs`。构建脚本和自动测试随代码提供。

## 许可证与第三方项目

项目自有代码采用 [MIT 许可证](LICENSE)，允许使用、修改、分发及商用，须保留版权和许可声明。第三方代码、模型及组件仍遵守各自许可证。

使用的主要项目包括 [Basic Pitch](https://github.com/spotify/basic-pitch)、[Pitchy](https://github.com/ianprime0509/pitchy)、[Demucs](https://github.com/facebookresearch/demucs)、[librosa / pYIN](https://github.com/librosa/librosa)、[torchcrepe](https://github.com/maxrmorrison/torchcrepe)、[ROSVOT](https://github.com/RickyL-2000/ROSVOT)、[Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)、[SoundTouchJS](https://github.com/cutterbl/SoundTouchJS)、[ONNX Runtime](https://github.com/microsoft/onnxruntime)、[TensorFlow.js](https://github.com/tensorflow/tfjs) 和 [Tonejs/Midi](https://github.com/Tonejs/Midi)。各组件与模型保留原有许可，详见 [第三方说明](licenses/THIRD_PARTY_NOTICES.md)。
