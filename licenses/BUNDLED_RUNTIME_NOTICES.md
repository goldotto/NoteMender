# Windows runtime components

The NoteMender application is MIT licensed. Bundled interpreters, libraries and
models retain their upstream licenses; the root MIT license does not relicense them.
You may inspect, replace or modify the runtime libraries under their applicable terms.

| Component | Version | Upstream / license |
| --- | --- | --- |
| Node.js | 22.22.0 | https://nodejs.org/ — license text in runtime/node/LICENSE |
| Python | 3.11.15 | https://python.org/ — PSF license in runtime/python/LICENSE.txt |
| PyTorch / torchaudio CPU | 2.5.1 | https://github.com/pytorch/pytorch — BSD licenses in package metadata |
| Demucs | 4.0.1, htdemucs / htdemucs_6s | https://github.com/facebookresearch/demucs — MIT |
| ONNX Runtime | 1.22.1 | https://github.com/microsoft/onnxruntime — MIT |
| Qwen3-ASR / ForcedAligner | 0.6B models, qwen-asr 0.0.6 | https://github.com/QwenLM/Qwen3-ASR — Apache-2.0 |
| PyAV | 16.1.0 | https://github.com/PyAV-Org/PyAV — BSD-3-Clause |
| FFmpeg shared libraries | 8.0.1 (PyAV wheel vendor build 8.0.1-3) | https://ffmpeg.org/ — LGPL-3.0-or-later reported by these libraries |

Original Python dependency licenses and copyright statements are included in
`runtime/python/Lib/site-packages/*.dist-info/licenses/` and component dependency
directories. Qwen model license texts are included beside their model files.

FFmpeg is dynamically linked by the separate Python audio environment. Its upstream
vendor build recipes, patches and corresponding source references are provided in
the runtime source attachment on the same Release page. That attachment is not
needed to run the program. Unmodified upstream source, including its license texts,
retains its original license. Codec dependencies may have different terms; consult
the included source and build recipe before redistributing a changed runtime.

Browser dependency notices remain in THIRD_PARTY_NOTICES.md. GPU and ROSVOT
are downloaded optional components and are not bundled in the standard CPU edition.
