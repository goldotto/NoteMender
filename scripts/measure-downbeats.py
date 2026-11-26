"""Run Beat This! against a local WAV and a verified local checkpoint."""
import json
import sys
from pathlib import Path
from time import perf_counter

started = perf_counter()
source, checkpoint, overlay = map(Path, sys.argv[1:])
if not checkpoint.is_file():
    raise FileNotFoundError("Missing Beat This! checkpoint")
sys.path.insert(0, str(overlay))

import torch
from beat_this.inference import Audio2Beats
from beat_this.preprocessing import load_audio

torch.set_num_threads(4)
audio, rate = load_audio(source)
duration = len(audio) / rate
if not 1 <= duration <= 1200:
    raise ValueError("Audio must be between 1 second and 20 minutes")
beats, downbeats = Audio2Beats(checkpoint_path=str(checkpoint), device="cpu", dbn=False)(audio, rate)
print(json.dumps({
    "duration": duration,
    "beats": [float(value) for value in beats if 0 <= value <= duration],
    "downbeats": [float(value) for value in downbeats if 0 <= value <= duration],
    "elapsedMs": round((perf_counter() - started) * 1000),
}, allow_nan=False))
