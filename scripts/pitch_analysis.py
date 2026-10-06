"""Optional pitch evidence only: no score edits and no remote inference."""
import json
import sys
import numpy as np
import soundfile as sf
import librosa

def analyse(source, engine, low, high, device='cpu', threads=0):
    started = __import__('time').perf_counter()
    fallbacks = []
    if device == 'auto':
        try:
            import torch
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        except ImportError:
            device = 'cpu'
    audio, sr = sf.read(source, dtype='float32', always_2d=True)
    if len(audio) / sr > 30:
        raise ValueError('实验音高分析每段最长 30 秒')
    audio = librosa.resample(audio.mean(axis=1), orig_sr=sr, target_sr=22050)
    sr, hop = 22050, 220
    fmin, fmax = librosa.midi_to_hz(low), librosa.midi_to_hz(high)
    if engine == 'pyin':
        hz, voiced, confidence = librosa.pyin(audio, fmin=float(fmin), fmax=float(fmax), sr=sr, frame_length=2048, hop_length=hop, center=True)
    elif engine == 'crepe':
        try:
            import torch
            import torchcrepe
        except ImportError as error:
            raise ValueError('torchcrepe 尚未安装；请使用 pYIN，或安装 requirements-experimental.txt') from error
        if threads:
            torch.set_num_threads(threads)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        if device == 'cuda':
            torch.cuda.reset_peak_memory_stats()
        with torch.inference_mode():
            try:
                hz, confidence = torchcrepe.predict(torch.from_numpy(audio)[None], sr, hop, float(fmin), float(min(fmax, 2006)), 'tiny', batch_size=256, device=device, return_periodicity=True)
            except Exception as error:
                if device != 'cuda':
                    raise
                fallbacks.append(str(error)[:300])
                device = 'cpu'
                torch.cuda.empty_cache()
                hz, confidence = torchcrepe.predict(torch.from_numpy(audio)[None], sr, hop, float(fmin), float(min(fmax, 2006)), 'tiny', batch_size=256, device=device, return_periodicity=True)
            hz, confidence = hz.cpu(), confidence.cpu()
            confidence = torchcrepe.threshold.Silence(-70.)(confidence, torch.from_numpy(audio)[None], sr, hop)
            hz = hz[0].numpy()
            confidence = confidence[0].numpy()
            voiced = confidence >= .5
    else:
        raise ValueError('未知实验引擎')
    rms = librosa.feature.rms(y=audio, frame_length=2048, hop_length=hop)[0]
    frames = []
    for i, (frequency, probability, active) in enumerate(zip(hz, confidence, voiced)):
        valid = bool(active and np.isfinite(frequency) and frequency > 0)
        frames.append({'second': i * hop / sr, 'hz': float(frequency) if valid else 0, 'pitch': float(librosa.hz_to_midi(frequency)) if valid else None, 'confidence': float(probability) if np.isfinite(probability) else 0, 'voiced': valid, 'rms': float(rms[min(i, len(rms)-1)])})
    return {'externalEngine': engine, 'externalFrames': frames, 'externalCompute': {'device': device if engine == 'crepe' else 'cpu', 'threads': threads or 'auto', 'fallbacks': fallbacks, 'elapsedMs': (__import__('time').perf_counter()-started)*1000, 'peakGPUAllocatedBytes':torch.cuda.max_memory_allocated() if engine=='crepe' and device=='cuda' else None}}

if __name__ == '__main__':
    try:
        result = analyse(sys.argv[1], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
        with open(sys.argv[2], 'w', encoding='utf-8') as out:
            json.dump(result, out, ensure_ascii=False, allow_nan=False)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
