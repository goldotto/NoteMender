"""Pinned MuScriptor adapter; FP32 conditioners and selectable transformer precision."""
import argparse
import json
import sys
import time
import wave
from pathlib import Path


def progress(stage, value):
    print(json.dumps({'stage': stage, 'progress': value}), flush=True)


def event_notes(events, duration):
    # Keep upstream event IDs, repeated notes, and short durations. No 70/80 ms gate.
    notes = []
    for event in events:
        if hasattr(event, 'start_event'):
            start = event.start_event
            end = min(duration, float(event.end_time))
            onset = max(0.0, float(start.start_time))
            if end > onset:
                notes.append({'id': 'mu-' + str(start.index), 'midi': int(start.pitch),
                              'start': onset, 'end': end, 'instrument': str(start.instrument)})
    return sorted(notes, key=lambda n: (n['start'], n['id']))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
    parser.add_argument('--precision', choices=['fp32', 'fp16', 'bf16'], default='fp32')
    parser.add_argument('--threads', type=int, default=0)
    args = parser.parse_args()
    started = time.perf_counter()
    import numpy as np
    import torch
    from muscriptor import TranscriptionModel
    from muscriptor.events import ProgressEvent
    import importlib.metadata
    assert importlib.metadata.version('muscriptor') == '0.3.0', 'MuScriptor version mismatch'
    if args.threads > 0:
        torch.set_num_threads(args.threads)
    if args.device == 'cuda' and not torch.cuda.is_available():
        print('CUDA_UNAVAILABLE', file=sys.stderr)
        return 42
    if args.device == 'cpu' and args.precision != 'fp32':
        raise ValueError('CPU inference requires FP32')
    if args.precision == 'bf16' and not torch.cuda.is_bf16_supported(including_emulation=False):
        print('PRECISION_FAILED: 此显卡不支持原生 BF16', file=sys.stderr)
        return 43
    dtype = {'fp32': torch.float32, 'fp16': torch.float16, 'bf16': torch.bfloat16}[args.precision]
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    with wave.open(args.input, 'rb') as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
            raise ValueError('Expected mono PCM16 WAV at 16000Hz')
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768
    duration = len(samples) / 16000
    progress('加载 MuScriptor large · ' + args.precision.upper() + ' · ' + args.device, .01)
    try:
        # Upstream loads both an empty model AND its checkpoint onto CUDA, which
        # temporarily doubles VRAM. Stage the checkpoint on CPU, then copy into
        # the already allocated model without a second GPU weight copy.
        import muscriptor.transcription_model as upstream
        original_load_file = upstream.load_file
        try:
            if args.device == 'cuda':
                upstream.load_file = lambda filename, device=None: original_load_file(filename, device='cpu')
            model = TranscriptionModel.load_model(args.model, device=args.device, dtype=dtype)
        finally:
            upstream.load_file = original_load_file
        # Use the selected native transformer dtype, not upstream's always-FP16
        # autocast (which would silently turn BF16 back into FP16).
        assert hasattr(model._model.autocast, 'enabled'), 'Unsupported autocast API'
        model._model.autocast.enabled = False
        assert all(p.dtype == torch.float32 for p in model._model.condition_provider.parameters() if p.is_floating_point())
        assert all(p.dtype == dtype for p in model._model.transformer.parameters() if p.is_floating_point())
        # Accumulate on-device: no synchronous CPU/GPU check for every token.
        bad_logits = torch.zeros((), dtype=torch.bool, device=args.device)
        compute_logits = model._model._compute_logits
        def checked_logits(*values, **kwargs):
            logits = compute_logits(*values, **kwargs)
            bad_logits.logical_or_(torch.isnan(logits).any() | torch.isposinf(logits).any()
                                   | torch.isneginf(logits).all(dim=-1).any())
            return logits
        model._model._compute_logits = checked_logits
        load_peak = torch.cuda.max_memory_allocated() if args.device == 'cuda' else 0
        if args.device == 'cuda':
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
        loaded = time.perf_counter()
        events = []
        with torch.inference_mode():
            for event in model.transcribe((torch.from_numpy(samples).unsqueeze(0), 16000),
                                          use_sampling=False, cfg_coef=1.0, batch_size=1,
                                          beam_size=1, prelude_forcing=True):
                if isinstance(event, ProgressEvent):
                    progress('MuScriptor large 分析 · ' + str(event.completed) + ' / ' + str(event.total),
                             .05 + .9 * event.completed / max(1, event.total))
                else:
                    events.append(event)
        if bool(bad_logits.item()):
            raise FloatingPointError('模型输出出现非有限数值，请改用 FP32')
        if args.device == 'cuda':
            torch.cuda.synchronize()
        notes = event_notes(events, duration)
        output = Path(args.output)
        # No transcribe_to_midi(): that method would run an extra beat detector/model.
        output.with_suffix('.mid').write_bytes(model.events_to_midi_bytes(iter(events), beat_grid=None))
        result = {'notes': notes, 'duration': duration, 'model': 'MuScriptor large', 'precision': args.precision,
                  'device': args.device, 'threads': torch.get_num_threads(),
                  'timing': {'loadMs': (loaded-started)*1000, 'inferenceMs': (time.perf_counter()-loaded)*1000},
                  'peakCudaBytes': max(load_peak, torch.cuda.max_memory_allocated()) if args.device == 'cuda' else 0,
                  'loadPeakCudaBytes': load_peak,
                  'inferencePeakCudaBytes': torch.cuda.max_memory_allocated() if args.device == 'cuda' else 0}
        output.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        progress('MuScriptor large 完成', 1)
        return 0
    except (RuntimeError, MemoryError, FloatingPointError) as error:
        text = str(error).lower()
        if args.device == 'cuda' and any(s in text for s in ['cuda', 'out of memory', 'cublas', 'cudnn']):
            print('CUDA_FAILED: ' + str(error)[-500:], file=sys.stderr)
            return 42
        if args.precision != 'fp32':
            print('PRECISION_FAILED: ' + str(error)[-500:], file=sys.stderr)
            return 43
        raise


if __name__ == '__main__':
    sys.exit(main())
