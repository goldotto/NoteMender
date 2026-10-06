"""Qwen3 lyrics: sequential ASR/aligner loading, original-second timestamps, FP32."""
import gc
import json
import math
from pathlib import Path
import sys
import time
import unicodedata
from lyric_alignment_windows import context_windows, quiet_ranges, own_core, repair_windows, adopt_repair, units_key, stitch_segments
from nagisa_windows_compat import prepare_nagisa_for_windows

CHUNK_SECONDS = 30
LANGUAGES = {'zh': 'Chinese', 'en': 'English', 'yue': 'Cantonese', 'ja': 'Japanese', 'ko': 'Korean', 'fr': 'French', 'de': 'German', 'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'es': 'Spanish'}
ALIGN_LANGUAGES = set(LANGUAGES.values())


def progress(stage, value):
    print(json.dumps({'stage': stage, 'progress': value}, ensure_ascii=False), flush=True)


def language_code(language):
    return next((code for code, name in LANGUAGES.items() if name.lower() == str(language).lower()), str(language or 'auto').lower())


def units_without_times(text, chinese=False):
    if chinese:
        return [{'char': c} for c in text if unicodedata.category(c)[0] in 'LN']
    return [{'word': word} for word in text.split() if word.strip()]


def segment_from_alignment(text, language, items, start, end, source='qwen3-asr'):
    """Invalid/zero length timestamps remain unassigned, never spread evenly."""
    units = []
    key = 'char' if language in ('zh', 'yue') else 'word'
    for item in items:
        unit = {key: str(item.text), 'source': 'qwen3-forced-aligner'}
        a, b = item.start_time, item.end_time
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isfinite(a) and math.isfinite(b):
            a, b = max(start, min(end, start + a)), max(start, min(end, start + b))
            if b > a:
                unit.update(start=round(a, 6), end=round(b, 6))
        if 'start' not in unit:
            unit['alignmentIssue'] = '未获得有效原音时间'
        units.append(unit)
    if not units:
        units = units_without_times(text, key == 'char')
    return {'start': start, 'end': end, 'text': text, 'language': language, 'source': source, 'chars' if key == 'char' else 'words': units}


def chunk_ranges(length, sample_rate=16000):
    return [(a, min(length, a + CHUNK_SECONDS * sample_rate)) for a in range(0, length, CHUNK_SECONDS * sample_rate)]


def main(request):
    started = time.perf_counter()
    progress('加载 Qwen 歌词组件', .01)
    prepare_nagisa_for_windows()
    import numpy as np
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly
    from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner
    import_seconds = time.perf_counter() - started
    directory = Path(request['directory'])
    marker = json.loads((directory / 'ready.json').read_text(encoding='utf-8'))
    device = request['device']
    warnings, stages, devices = [], {'importSeconds': import_seconds}, set()
    if request.get('threads'):
        torch.set_num_threads(request['threads'])
    if device == 'cuda' and not torch.cuda.is_available():
        device = 'cpu'
        warnings.append('显卡不可用，已使用 CPU')
    if device == 'cuda':
        torch.cuda.reset_peak_memory_stats()
    progress('读取选定音频', .02)
    with sf.SoundFile(request['input']) as handle:
        sr = handle.samplerate
        a = round((request['from'] - request['origin']) * sr)
        b = round((request['to'] - request['origin']) * sr)
        if a < 0 or b > len(handle) + 1 or b <= a:
            raise ValueError('歌词范围超出音频资源')
        handle.seek(a)
        audio = handle.read(b - a, dtype='float32', always_2d=True).mean(axis=1)
    if not len(audio):
        raise ValueError('所选音频为空')
    if sr != 16000:
        divisor = math.gcd(sr, 16000)
        audio = resample_poly(audio, 16000 // divisor, sr // divisor).astype(np.float32)
    language = LANGUAGES.get(request['language'])
    if request['kind'] == 'align' and len(audio) / 16000 > 300:
        raise ValueError('单次文字对齐最长 5 分钟，请选择较短歌词范围')
    windows = context_windows(len(audio), quiet_ranges(audio,16000)) if request['kind'] == 'transcribe' else [(0,len(audio),0,len(audio))]
    chunks = [(a,b) for _,_,a,b in windows]
    texts, languages = [], []
    model = None

    def release():
        nonlocal model
        model = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def load_asr():
        return Qwen3ASRModel.from_pretrained(str(directory / 'models' / marker['model']), dtype=torch.float32, device_map='cuda:0' if device == 'cuda' else 'cpu', attn_implementation='eager', local_files_only=True, max_inference_batch_size=1, max_new_tokens=512)

    def load_aligner():
        return Qwen3ForcedAligner.from_pretrained(str(directory / 'models' / marker['aligner']), dtype=torch.float32, device_map='cuda:0' if device == 'cuda' else 'cpu', attn_implementation='eager', local_files_only=True)

    def run_on_device(loader, work, phase):
        nonlocal device, model
        try:
            if model is None:
                model = loader()
            result = work(model)
            devices.add(device)
            return result
        except RuntimeError as error:
            if device != 'cuda' or not any(word in str(error).lower() for word in ['cuda', 'cudnn', 'out of memory', 'cublas']):
                raise
            reason = str(error).splitlines()[0][:180]
            release()
            device = 'cpu'
            warnings.append(f'{phase}显卡失败，当前分析单元改用 CPU：{reason}')
            progress(f'{phase} · 回退 CPU', .08 if phase == '转写' else .56)
            model = loader()
            result = work(model)
            devices.add(device)
            return result

    if request['kind'] == 'transcribe':
        progress('加载 Qwen3-ASR', .05)
        phase_start = time.perf_counter()
        for i, (a, b) in enumerate(chunks):
            progress(f'Qwen 转写 {i + 1}/{len(chunks)}', .06 + .44 * i / len(chunks))
            result = run_on_device(load_asr, lambda m: m.transcribe(audio=(audio[a:b], 16000), language=language)[0], '转写')
            texts.append(result.text)
            languages.append(language_code(result.language or language))
            progress(f'Qwen 转写 {i + 1}/{len(chunks)} 完成', .06 + .44 * (i + 1) / len(chunks))
        stages['transcriptionSeconds'] = time.perf_counter() - phase_start
        release()
    else:
        texts = [request['text']]
        code = request['language']
        if code == 'auto':
            # API clients without a recognised token still need real language detection.
            progress('识别对齐语言', .08)
            phase_start = time.perf_counter()
            detected = run_on_device(load_asr, lambda m: m.transcribe(audio=(audio[:30 * 16000], 16000), language=None)[0], '语言识别')
            code = language_code(detected.language)
            stages['languageDetectionSeconds'] = time.perf_counter() - phase_start
            release()
        languages = [code]
    progress('加载 Qwen 逐字对齐模型', .52)
    segments = []
    phase_start = time.perf_counter()
    for i, ((a, b), text, code) in enumerate(zip(chunks, texts, languages)):
        start = request['from'] + a / 16000
        end = min(request['to'], request['from'] + b / 16000)
        if not text.strip():
            continue
        canonical = LANGUAGES.get(code)
        items = []
        if canonical in ALIGN_LANGUAGES:
            progress(f'逐字对齐 {i + 1}/{len(chunks)}', .55 + .42 * i / len(chunks))
            try:
                result = run_on_device(load_aligner, lambda m: m.align(audio=(audio[a:b], 16000), text=text, language=canonical)[0], '对齐')
                items = list(result.items)
            except RuntimeError as error:
                warnings.append('本段时间对齐未完成，保留文字供手工对应：' + str(error).splitlines()[0][:180])
                release()
        else:
            warnings.append(f'{code} 暂不支持自动时间对齐，保留文字供手工对应')
        segment = segment_from_alignment(text, code, items, start, end, source='qwen3-forced-aligner' if request['kind'] == 'align' else 'qwen3-asr')
        repairs=0
        # Local retries use the same corrected words and neighbouring time anchors.
        # Audio evidence is independent of the score; no note times are used here.
        for first,last,left,right in repair_windows(segment)[:6]:
            if canonical not in ALIGN_LANGUAGES:break
            text_key='char' if code in ('zh','yue') else 'word'
            retry_text=('' if text_key=='char' else ' ').join(u[text_key] for u in segment[units_key(code)][first:last])
            ra=max(0,round((left-request['from'])*16000)-4000)
            rb=min(len(audio),round((right-request['from'])*16000)+4000)
            progress(f'局部重试未定位歌词 {i + 1}/{len(chunks)}', .55+.42*i/len(chunks))
            try:
                retry_items=list(run_on_device(load_aligner,lambda m:m.align(audio=(audio[ra:rb],16000),text=retry_text,language=canonical)[0],'对齐').items)
                retry=segment_from_alignment(retry_text,code,retry_items,request['from']+ra/16000,request['from']+rb/16000)
                segment,adopted=adopt_repair(segment,retry,first,last)
                repairs+=int(adopted)
            except RuntimeError as error:
                warnings.append('局部歌词重试未完成：'+str(error).splitlines()[0][:180])
                release()
        core_a,core_b,_,_=windows[i]
        segment=own_core(segment,request['from']+core_a/16000,min(request['to'],request['from']+core_b/16000),final=i==len(windows)-1)
        segment['alignmentMethod']='pause-context-local-retry'
        segment['repairedRuns']=repairs
        segments.append(segment)
        progress(f'逐字对齐 {i + 1}/{len(chunks)} 完成', .55 + .42 * (i + 1) / len(chunks))
    segments=stitch_segments(segments)
    stages['alignmentSeconds'] = time.perf_counter() - phase_start
    peak = torch.cuda.max_memory_allocated() if torch.cuda.is_available() else 0
    release()
    unaligned = sum('start' not in unit for segment in segments for unit in segment.get('chars', segment.get('words', [])))
    if unaligned:
        warnings.append(f'{unaligned} 个字词未获得有效时间，请手工对应')
    result = {'segments': segments, 'language': languages[0] if languages else request['language'], 'engine': 'qwen3-asr', 'model': marker['model'], 'aligner': marker['aligner'], 'device': next(iter(devices)) if len(devices) == 1 else 'mixed' if devices else device, 'precision': 'fp32', 'warning': '；'.join(dict.fromkeys(warnings)), 'elapsedSeconds': time.perf_counter() - started, 'timings': stages, 'peakGPUBytes': peak}
    Path(request['output']).write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    progress('Qwen 歌词预览已生成', 1.)


if __name__ == '__main__':
    main(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
