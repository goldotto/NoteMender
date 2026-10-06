"""Demucs adapter. Inference and separation are provided by the upstream Demucs library."""
import os
import hashlib
import json
import time
import sys
from pathlib import Path
import torch
import torchaudio.functional as AF
import soundfile as sf
from demucs.pretrained import get_model
from demucs.apply import apply_model

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("TORCH_HOME", str(ROOT / "runtime" / "models"))
COMPUTE = json.loads(os.environ.get('JIANPU_COMPUTE', '{}'))
if COMPUTE.get('mode') != 'performance':
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 2)))
elif COMPUTE.get('threads'):
    torch.set_num_threads(int(COMPUTE['threads']))
torch.backends.cuda.matmul.allow_tf32 = False
torch.backends.cudnn.allow_tf32 = False

def preserve_cpu_fft(model):
    # Keep the existing STFT/iSTFT arithmetic. Neural layers still run on CUDA.
    # On this Blackwell runtime the CUDA spectral path produced audible-scale
    # waveform differences; these CPU transforms preserve the baseline evidence.
    for submodel in getattr(model, 'models', [model]):
        spec, ispec = submodel._spec, submodel._ispec
        submodel._spec = lambda x, fn=spec: fn(x.cpu()).to(x.device)
        submodel._ispec = lambda x, *args, fn=ispec, **kwargs: fn(x.cpu(), *args, **kwargs).to(x.device)

MODEL = os.environ.get("JIANPU_SEPARATION_MODEL", "htdemucs")
if MODEL not in ["htdemucs", "htdemucs_6s"]:
    raise ValueError("Unsupported separation model")

def prepare():
    model = get_model(MODEL).cpu().eval()
    return model

def separate(source, destination, other_destination):
    started = time.perf_counter()
    fallbacks = []
    device = 'cuda' if COMPUTE.get('mode') == 'performance' and COMPUTE.get('device') != 'cpu' and torch.cuda.is_available() else 'cpu'
    if COMPUTE.get('mode') == 'performance' and COMPUTE.get('device') != 'cpu' and device == 'cpu':
        fallbacks.append('CUDA 未就绪，分轨使用 CPU')
    if device == 'cuda':
        torch.cuda.reset_peak_memory_stats()
    audio, sr = sf.read(source, dtype="float32", always_2d=True)
    if len(audio) / sr > 601:
        raise ValueError("Audio exceeds 10 minutes")
    print("正在加载 Demucs 本地模型…", flush=True)
    model = prepare()
    if device == 'cuda':
        preserve_cpu_fft(model)
    wave = torch.from_numpy(audio.T.copy())
    if wave.shape[0] == 1:
        wave = wave.repeat(2, 1)
    else:
        wave = wave[:2]
    wave = AF.resample(wave, sr, model.samplerate)
    ref = wave.mean(0)
    mean, std = ref.mean(), ref.std()
    if std < 1e-7:
        sf.write(destination, audio[:, 0] * 0, sr)
        sf.write(other_destination, audio[:, 0] * 0, sr)
        for name in [n for n in model.sources if n not in ['vocals','other']] + ['instrumental']:
            sf.write(Path(other_destination).parent / (name + '.wav'), audio[:, 0] * 0, sr)
        (Path(other_destination).parent / 'stems.json').write_text(json.dumps({'version':3,'model':MODEL,'sources':list(model.sources)+['instrumental']}), encoding='utf-8')
        return
    print("正在分离人声（" + device.upper() + "）…", flush=True)
    with torch.inference_mode():
        try:
            result = apply_model(model, ((wave - mean) / std)[None], device=device, shifts=0, split=True, overlap=0.1, progress=True, num_workers=0)[0].cpu()
        except Exception as error:
            if device != 'cuda':
                raise
            fallbacks.append(str(error)[:300])
            model.cpu()
            torch.cuda.empty_cache()
            device = 'cpu'
            print('显卡分轨失败，重试当前分轨任务（CPU）…', flush=True)
            result = apply_model(model, ((wave - mean) / std)[None], device=device, shifts=0, split=True, overlap=0.1, progress=True, num_workers=0)[0]
    stem_dir = Path(other_destination).parent
    stems = {name: result[model.sources.index(name)] * std + mean for name in model.sources}
    for name, audio in stems.items():
        target = destination if name == 'vocals' else other_destination if name == 'other' else stem_dir / (name + '.wav')
        sf.write(target, audio.T.numpy(), model.samplerate, subtype="PCM_16")
    instrumental = sum(stems[name] for name in stems if name not in ['vocals', 'drums'])
    sf.write(stem_dir / 'instrumental.wav', instrumental.T.numpy(), model.samplerate, subtype="PCM_16")
    (stem_dir / 'stems.json').write_text(json.dumps({'version':3,'model':MODEL,'sources':list(model.sources)+['instrumental']}), encoding='utf-8')
    metadata = {'device': device, 'threads': torch.get_num_threads(), 'precision': 'fp32', 'model': MODEL, 'torchVersion': torch.__version__, 'fallbacks': fallbacks, 'elapsedMs': (time.perf_counter()-started)*1000, 'peakGPUAllocatedBytes':torch.cuda.max_memory_allocated() if device=='cuda' else None}
    metadata['spectralDevice'] = 'cpu'
    metadata['fingerprint'] = MODEL + ':shifts0:overlap0.1:fp32:cpu-fft-v1:' + device + ':' + torch.__version__
    (stem_dir / 'compute.json').write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
    model.cpu()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print("人声分离完成", flush=True)

if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--prepare":
        prepared = prepare()
        digest = hashlib.sha256()
        for name, tensor in prepared.state_dict().items():
            digest.update(name.encode());digest.update(tensor.cpu().numpy().tobytes())
        (ROOT / "runtime").mkdir(exist_ok=True)
        (ROOT / "runtime" / ("demucs6-ready.json" if MODEL == "htdemucs_6s" else "demucs-ready.json")).write_text(json.dumps({"model":MODEL,"version":"4.0.1","fingerprint":digest.hexdigest()}), encoding="utf-8")
        print("Demucs 已安装，模型已缓存，可以离线分离。")
    elif len(sys.argv) == 4:
        separate(sys.argv[1], sys.argv[2], sys.argv[3])
    else:
        raise SystemExit("Usage: separate.py input.wav vocals.wav other.wav | --prepare")
