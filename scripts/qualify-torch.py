"""Sequential CPU/CUDA parity check for optional Demucs or CREPE acceleration."""
import json
import os
import sys
import tempfile
import time
import subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
import torch

ROOT=Path(__file__).resolve().parents[1]
engine=sys.argv[1] if len(sys.argv)>1 else 'crepe'
seconds=float(sys.argv[sys.argv.index('--seconds')+1]) if '--seconds' in sys.argv else None
if seconds is not None and not 0<seconds<=30:
    raise ValueError('短检查时长应为 0–30 秒')
if engine not in ['crepe','demucs']:
    raise ValueError('请选择 crepe 或 demucs')
if '--reference' in sys.argv:
    at=sys.argv.index('--reference')
    source,output=sys.argv[at+1:at+3]
    np.random.seed(20261003)
    if engine=='crepe':
        from pitch_analysis import analyse
        Path(output).write_text(json.dumps(analyse(source,'crepe',45,88,device='cpu')),encoding='utf-8')
    else:
        import separate
        destination=Path(output);destination.mkdir(parents=True,exist_ok=True)
        separate.separate(source,str(destination/'vocals.wav'),str(destination/'other.wav'))
    sys.exit(0)
if not torch.cuda.is_available():
    raise ValueError('请先安装并检查可选显卡组件')
manifest=json.loads((ROOT/'runtime/review-corpus/manifest.json').read_text(encoding='utf-8'))
samples=manifest.get('samples',manifest.get('clips',[]))
reports=[]
reference_env={**os.environ,'PYTHONPATH':'','JIANPU_COMPUTE':json.dumps({'mode':'performance','device':'cpu','threads':0})}
if '--gpu-cpu-reference' in sys.argv:
    reference_env['PYTHONPATH']=os.environ.get('PYTHONPATH','')
def reference(source,output):
    subprocess.run([sys.executable,__file__,engine,'--reference',str(source),str(output)],env=reference_env,check=True)
if engine=='crepe':
    from pitch_analysis import analyse
else:
    os.environ['JIANPU_COMPUTE']=json.dumps({'mode':'performance','device':'cpu','threads':0})
    import separate

for sample in samples:
    source=ROOT/'runtime/review-corpus'/sample['audio']
    smoke=None
    if seconds:
        smoke=tempfile.TemporaryDirectory(prefix='jianpu-smoke-')
        audio,sr=sf.read(source,dtype='float32',always_2d=True)
        source=Path(smoke.name)/'input.wav'
        sf.write(source,audio[:round(seconds*sr)],sr,subtype='FLOAT')
    if engine=='crepe':
        # Upstream CREPE decoding includes random dither; parity comparisons share a seed.
        with tempfile.TemporaryDirectory(prefix='jianpu-reference-') as directory:
            result=Path(directory)/'result.json'
            reference(source,result)
            before=json.loads(result.read_text(encoding='utf-8'))
        np.random.seed(20261003)
        after=analyse(str(source),'crepe',45,88,device='cuda')
        a,b=before['externalFrames'],after['externalFrames']
        errors=[abs(x['pitch']-y['pitch']) for x,y in zip(a,b) if x['pitch'] is not None and y['pitch'] is not None]
        passed=len(a)==len(b) and all(x['voiced']==y['voiced'] for x,y in zip(a,b)) and max(errors,default=0)<.001 and after['externalCompute']['device']=='cuda'
        report={'sample':sample['id'],'passed':passed,'maxPitchError':max(errors,default=0),'cpuMs':before['externalCompute']['elapsedMs'],'cudaMs':after['externalCompute']['elapsedMs'],'cuda':after['externalCompute']}
    else:
        with tempfile.TemporaryDirectory(prefix='jianpu-demucs-parity-') as directory:
            destination=Path(directory)
            for device in ['cpu','cuda']:
                folder=destination/device;folder.mkdir()
                if device=='cpu':
                    reference(source,folder)
                    continue
                separate.COMPUTE={'mode':'performance','device':device,'threads':0}
                separate.separate(str(source),str(folder/'vocals.wav'),str(folder/'other.wav'))
            comparisons=[]
            for stem in ['vocals','other','bass','drums','instrumental']:
                a,_=sf.read(destination/'cpu'/(stem+'.wav'),dtype='float32')
                b,_=sf.read(destination/'cuda'/(stem+'.wav'),dtype='float32')
                maximum=float(np.max(np.abs(a-b))) if a.shape==b.shape else float('inf')
                rms=float(np.sqrt(np.mean((a-b)**2))) if a.shape==b.shape else float('inf')
                comparisons.append({'stem':stem,'maximum':maximum,'rms':rms,'passed':maximum<=.001 and rms<=.00003})
            metadata=json.loads((destination/'cuda/compute.json').read_text(encoding='utf-8'))
            cpu_metadata=json.loads((destination/'cpu/compute.json').read_text(encoding='utf-8'))
            report={'sample':sample['id'],'passed':all(x['passed'] for x in comparisons) and metadata['device']=='cuda','stems':comparisons,'cpu':cpu_metadata,'cuda':metadata}
    reports.append(report)
    print(json.dumps(report,ensure_ascii=False),flush=True)
    if smoke:
        smoke.cleanup()
    if not report['passed'] or seconds:
        break
passed=not seconds and bool(samples) and len(reports)==len(samples) and all(x['passed'] for x in reports)
directory=ROOT/'runtime/acceleration'
directory.mkdir(parents=True,exist_ok=True)
gate_path=directory/'qualification.json'
gate=json.loads(gate_path.read_text(encoding='utf-8')) if gate_path.exists() else {}
if not seconds:
    gate[engine]={'passed':passed,'torchVersion':torch.__version__,'adapterVersion':2 if engine=='demucs' else 1}
    gate_path.write_text(json.dumps(gate,ensure_ascii=False,indent=2),encoding='utf-8')
(directory/('benchmark-'+engine+'-cuda'+('-smoke' if seconds else '')+'.json')).write_text(json.dumps({'passed':passed,'partial':bool(seconds),'reports':reports},ensure_ascii=False,indent=2),encoding='utf-8')
print('一致性检查通过' if passed else '检查未通过，显卡后端保持禁用')
