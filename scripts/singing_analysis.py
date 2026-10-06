"""Optional ROSVOT adapter: preserve independent note and word boundaries in seconds."""
import os
import sys
import json
import time
from pathlib import Path
from singing_words import word_intervals, ids_for_interval

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT / 'runtime' / 'singing' / 'ROSVOT'
request_mode = sys.argv[1] == '--request'
request = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8')) if request_mode else None
input_file, output_file = (request['input'], request['output']) if request_mode else map(lambda p: str(Path(p).resolve()), sys.argv[1:3])
word_tables = {}
os.environ['TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD'] = '1'  # Upstream checkpoints use the original PyTorch checkpoint format.
os.chdir(REPO)
sys.path.insert(0, str(REPO))
import torch
import numpy as np
if not torch.cuda.is_available():
    raise RuntimeError('ROSVOT requires the optional NVIDIA GPU component')
torch.backends.cuda.matmul.allow_tf32 = False
torch.backends.cudnn.allow_tf32 = False
torch.cuda.reset_peak_memory_stats()
started = time.perf_counter()
sys.argv = ['rosvot', '-p', input_file, '-o', str(Path(output_file).parent), '--bsz', '1', '--ds_workers', '0', '--no_save_midi', '--no_save_every_npy', '--no_save_final_npy']
from inference.rosvot import RosvotInfer
from utils.audio.pitch_utils import boundary2Interval
from tasks.rosvot.rosvot_utils import regulate_real_note_itv, regulate_ill_slur

if request_mode:
    import soundfile as sf
    entries = []
    with sf.SoundFile(input_file) as handle:
        for part in request['windows']:
            handle.seek(round((part['from'] - request['origin']) * handle.samplerate))
            audio = handle.read(round((part['to'] - part['from']) * handle.samplerate), dtype='float32', always_2d=True).mean(axis=1)
            filename = str(Path(output_file).parent / (part['id'] + '.wav'))
            sf.write(filename, audio, handle.samplerate)
            duration = len(audio) / handle.samplerate
            intervals, rejected = word_intervals(part['words'], duration)
            entry = {'item_name': part['id'], 'wav_fn': filename}
            if any(i['lyricIds'] for i in intervals):
                entry['word_durs'] = [i['end'] - i['start'] for i in intervals]
            else:
                # A batch must use a consistent word_durs schema, including silence.
                entry['word_durs'] = [duration]
            entries.append(entry)
            word_tables[part['id']] = {'intervals': intervals, 'words': part['words'], 'rejected': rejected}
    metadata = str(Path(output_file).parent / 'metadata.json')
    Path(metadata).write_text(json.dumps(entries), encoding='utf-8')
    sys.argv[sys.argv.index('-p'):sys.argv.index('-p')+2] = ['--metadata', metadata]

class EvidenceInfer(RosvotInfer):
    def save_result(self, output):
        hop = self.hparams['hop_size'] / self.hparams['audio_sample_rate']
        intervals = boundary2Interval(output['note_bd_pred']) * hop
        events = []
        for i, (midi, interval) in enumerate(zip(output['note_pred'], intervals)):
            start, end = map(float, interval)
            if 21 <= int(midi) <= 108 and end > start:
                onset = int(round(start / hop))
                evidence = output['note_bd_logits']
                events.append({'start':start,'end':end,'midi':int(midi),'confidence':float(evidence[min(onset,len(evidence)-1)]),'eventId':f'rosvot-{i}','source':'rosvot','reviewFlags':[]})
        f0 = output.get('f0')
        frames = [] if f0 is None else [{'second':float(i*hop),'hz':float(hz)} for i,hz in enumerate(f0) if np.isfinite(hz) and hz>0]
        regulated, mapping = [], None
        table = word_tables.get(output['item_name'])
        if table and events:
            try:
                times, mapping = regulate_real_note_itv(boundary2Interval(output['note_bd_pred']), output['note_bd_pred'], output['word_bd'], output['word_durs'], self.hparams['hop_size'], self.hparams['audio_sample_rate'])
                pitches, times, mapping = regulate_ill_slur(output['note_pred'], times, mapping)
                for i, (midi, (a, b), word_index) in enumerate(zip(pitches, times, mapping)):
                    if 21 <= int(midi) <= 108 and b > a:
                        regulated.append({'start':float(a),'end':float(b),'midi':int(midi),'eventId':f'rosvot-aligned-{i}','lyricIds':ids_for_interval(int(word_index),table['intervals'],float(a),float(b),table['words'])})
            except Exception as error:
                table['warning'] = '字词调节失败：' + str(error)
        self.evidence = {'events':events,'alignedEvents':regulated,'note2words':None if mapping is None else mapping.tolist(),'wordIntervals':table['intervals'] if table else [],'rejectedWordIds':table['rejected'] if table else [],'warning':table.get('warning') if table else None,'wordBoundaries':[float(i*hop) for i,x in enumerate(output['word_bd']) if x], 'pitchFrames':frames}
        self.results[output['item_name']] = self.evidence
        print(json.dumps({'stage':'人声分音与字词对应','progress':len(self.results)/max(1,len(word_tables))}),flush=True)
        return {'item_name':output['item_name'],'pitches':output['note_pred'].tolist(),'note_durs':[(float(b)-float(a)) for a,b in intervals],'note2words':None if mapping is None else mapping.tolist()}

engine = EvidenceInfer(num_gpus=1)
engine.results = {}
engine.run()
result = {'windows':[{'id':key,**value} for key,value in engine.results.items()]} if request_mode else getattr(engine, 'evidence', {'events':[], 'wordBoundaries':[], 'pitchFrames':[]})
result['compute'] = {'device':'cuda','model':'rosvot','precision':'fp32','elapsedMs':(time.perf_counter()-started)*1000,'peakGPUAllocatedBytes':torch.cuda.max_memory_allocated(),'torchVersion':torch.__version__}
Path(output_file).write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
