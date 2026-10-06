# Bundled third-party software

Original license texts are preserved beside this file. Runtime bundles and model assets retain upstream copyright.

- @esbuild/win32-x64 0.25.12 — MIT
- @soundtouchjs/audio-worklet 2.1.1 — MPL-2.0
- @soundtouchjs/core 2.1.1 — MPL-2.0
- @soundtouchjs/interpolation-strategy-lanczos 2.1.1 — MPL-2.0
- @soundtouchjs/worklet-base 2.1.1 — MPL-2.0
- @spotify/basic-pitch 1.0.1 — Apache-2.0
- @tensorflow/tfjs 3.21.0 — Apache-2.0
- @tensorflow/tfjs-backend-cpu 3.21.0 — Apache-2.0
- @tensorflow/tfjs-backend-webgl 3.21.0 — Apache-2.0
- @tensorflow/tfjs-converter 3.21.0 — Apache-2.0
- @tensorflow/tfjs-core 3.21.0 — Apache-2.0
- @tensorflow/tfjs-data 3.21.0 — Apache-2.0
- @tensorflow/tfjs-layers 3.21.0 — Apache-2.0 AND MIT
- @tonejs/midi 2.0.28 — MIT
- @types/long 4.0.2 — MIT
- @types/node 26.6.2 — MIT
- @types/node-fetch 2.6.13 — MIT
- @types/offscreencanvas 2019.3.0 — MIT
- @types/seedrandom 2.4.34 — MIT
- @types/webgl-ext 0.0.30 — MIT
- @types/webgl2 0.0.6 — MIT
- @webgpu/types 0.1.16 — BSD-3-Clause
- ansi-regex 5.0.1 — MIT
- ansi-styles 4.3.0 — MIT
- argparse 1.0.10 — MIT
- array-flatten 3.0.0 — MIT
- asynckit 0.4.0 — MIT
- call-bind-apply-helpers 1.0.2 — MIT
- chalk 4.1.2 — MIT
- cliui 7.0.4 — ISC
- color-convert 2.0.1 — MIT
- color-name 1.1.4 — MIT
- combined-stream 1.0.8 — MIT
- core-js 3.50.0 — MIT
- delayed-stream 1.0.0 — MIT
- dunder-proto 1.0.1 — MIT
- emoji-regex 8.0.0 — MIT
- es-define-property 1.0.1 — MIT
- es-errors 1.3.0 — MIT
- es-object-atoms 1.1.2 — MIT
- es-set-tostringtag 2.1.0 — MIT
- esbuild 0.25.12 — MIT
- escalade 3.2.0 — MIT
- fft.js 4.0.4 — MIT
- form-data 4.0.6 — MIT
- function-bind 1.1.2 — MIT
- get-caller-file 2.0.5 — ISC
- get-intrinsic 1.3.0 — MIT
- get-proto 1.0.1 — MIT
- gopd 1.2.0 — MIT
- has-flag 4.0.0 — MIT
- has-symbols 1.1.0 — MIT
- has-tostringtag 1.0.2 — MIT
- hasown 2.0.4 — MIT
- is-fullwidth-code-point 3.0.0 — MIT
- long 4.0.0 — Apache-2.0
- math-intrinsics 1.1.0 — MIT
- midi-file 1.2.4 — MIT
- mime-db 1.52.0 — MIT
- mime-types 2.1.35 — MIT
- node-fetch 2.6.13 — MIT
- pitchy 4.1.0 — MIT
- regenerator-runtime 0.13.11 — MIT
- require-directory 2.1.1 — MIT
- safe-buffer 5.2.1 — MIT
- seedrandom 3.0.5 — MIT
- sprintf-js 1.0.3 — BSD-3-Clause
- string-width 4.2.3 — MIT
- string_decoder 1.3.0 — MIT
- strip-ansi 6.0.1 — MIT
- supports-color 7.2.0 — MIT
- tr46 0.0.3 — MIT
- undici-types 8.9.0 — MIT
- webidl-conversions 3.0.1 — BSD-2-Clause
- whatwg-url 5.0.0 — MIT
- wrap-ansi 7.0.0 — MIT
- y18n 5.0.8 — ISC
- yargs 16.2.2 — MIT
- yargs-parser 20.2.9 — ISC

## License scope and source

The root MIT license applies to project-authored files only. Upstream
libraries, model assets, licenses and third_party/ retain their original terms.

SoundTouchJS 2.1.1 is MPL-2.0. The unmodified upstream TypeScript source for
the bundled modules is included in third_party/soundtouchjs. Upstream:
https://github.com/cutterbl/SoundTouchJS/tree/v2.1.1
Build: npm ci, then npm run build. The npm versions are pinned by the lockfile.

Optional Python components are downloaded separately by the installer:
- Demucs: https://github.com/facebookresearch/demucs
- librosa (pYIN): https://github.com/librosa/librosa
- torchcrepe: https://github.com/maxrmorrison/torchcrepe
- PyTorch: https://github.com/pytorch/pytorch
- ONNX Runtime: https://github.com/microsoft/onnxruntime
- ROSVOT / RMVPE: https://github.com/RickyL-2000/ROSVOT
- Qwen3-ASR / ForcedAligner: https://github.com/QwenLM/Qwen3-ASR

Those components and checkpoints follow their upstream licenses. The
application license does not relicense them.
