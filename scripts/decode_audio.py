"""Decode local audio with PyAV/FFmpeg, using its actual container, not extension."""
import json
import sys
from pathlib import Path
import av
import numpy as np
import soundfile as sf

def decode(source, destination):
    source = Path(source)
    if not source.is_file() or source.stat().st_size > 120 * 1024 * 1024:
        raise ValueError('Audio must be a local file up to 120 MB')
    chunks, count = [], 0
    with source.open('rb') as handle, av.open(handle, options={'protocol_whitelist': 'file,pipe'}) as container:
        if not container.streams.audio:
            raise ValueError('No audio stream in file')
        stream = container.streams.audio[0]
        metadata = {'container': container.format.name, 'codec': stream.codec_context.name,
                    'sourceRate': stream.codec_context.sample_rate}
        resampler = av.AudioResampler(format='fltp', layout='stereo', rate=22050)
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                count += converted.samples
                if count > 22050 * 600:
                    raise ValueError('Audio exceeds 10 minutes')
                chunks.append(converted.to_ndarray())
        for converted in resampler.resample(None):
            count += converted.samples
            chunks.append(converted.to_ndarray())
    if not chunks or count > 22050 * 600:
        raise ValueError('Empty or oversized audio')
    audio = np.concatenate(chunks, axis=1).T
    sf.write(destination, audio, 22050, subtype='PCM_16')
    metadata.update(seconds=len(audio) / 22050, sampleRate=22050, channels=2)
    return metadata

if __name__ == '__main__':
    print(json.dumps(decode(sys.argv[1], sys.argv[2]), ensure_ascii=True))
