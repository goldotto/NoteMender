"""Use librosa's beat tracker; regress the beat times to avoid FFT-bin rounding."""
import json
import sys
import numpy as np
import soundfile as sf
import librosa
from pathlib import Path

def measure(source):
    audio,sr=sf.read(source,dtype='float32',always_2d=True)
    if len(audio)/sr>600: raise ValueError('Audio exceeds 10 minutes')
    x=audio.mean(axis=1)
    if sr!=22050:x=librosa.resample(x,orig_sr=sr,target_sr=22050)
    sr=22050;duration=len(x)/sr;results=[]
    for start in sorted(set([0,max(0,duration/2-30),max(0,duration-65)])):
        clip=x[int(start*sr):int(min(duration,start+60)*sr)]
        tempo,beats=librosa.beat.beat_track(y=clip,sr=sr,hop_length=256,units='time')
        if len(beats)<8:continue
        slope,origin=np.polyfit(np.arange(len(beats)),beats,1)
        bpm=60/slope
        if 30<=bpm<=300:results.append({'start':start,'bpm':float(bpm),'timingError':float(np.median(np.abs(beats-(origin+slope*np.arange(len(beats))))))})
    if not results:raise ValueError('No steady beat found')
    values=np.array([r['bpm'] for r in results]);median=float(np.median(values))
    _,full_beats=librosa.beat.beat_track(y=x,sr=sr,hop_length=256,units='time')
    return {'bpm':round(median,1),'spread':float(np.max(np.abs(values-median))),'sections':results,'beats':[round(float(t),4) for t in full_beats],'method':'librosa beat tracking + time regression'}

if __name__=='__main__':Path(sys.argv[2]).write_text(json.dumps(measure(sys.argv[1])),encoding='utf-8')
