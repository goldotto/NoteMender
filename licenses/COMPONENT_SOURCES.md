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

### Japanese lyric reading

The offline romaji view bundles [Kuroshiro 1.2.0](https://github.com/hexenq/kuroshiro)
and its [Kuromoji analyzer 1.1.0](https://github.com/hexenq/kuroshiro-analyzer-kuromoji)
under MIT, with [Kuromoji 0.1.2](https://github.com/takuyaa/kuromoji.js) under Apache-2.0.
The bundled MeCab IPADIC dictionary retains the NAIST and ICOT terms in
Kuromoji-IPADIC-NOTICE.txt. The remaining library licenses are in this directory.
