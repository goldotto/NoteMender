"""FP32 inference adapter. The existing JS note decoder owns score creation."""
import hashlib
import json
import os
import sys
import time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SAMPLES, OVERLAP, HOP, FPS = 43844, 7680, 36164, 86
SESSIONS = {}
THREADS = 0

def peak_memory():
    if os.name != 'nt':
        return None
    import ctypes
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in ['PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage', 'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage']]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    kernel = ctypes.WinDLL('kernel32')
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    psapi = ctypes.WinDLL('psapi')
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
    if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        return counters.PeakWorkingSetSize
    return None

def windows(audio):
    # Match basic-pitch-ts prepareData: 3840 leading zeros, padEnd=true.
    padded = np.concatenate((np.zeros(OVERLAP // 2, np.float32), audio))
    count = int(np.ceil(len(padded) / HOP))
    for start in range(0, count * HOP, HOP):
        part = padded[start:start + SAMPLES]
        yield np.pad(part, (0, SAMPLES - len(part)))[:, None]

def gpu_memory(device):
    if device != 'cuda':
        return None
    import torch
    free,total=torch.cuda.mem_get_info()
    # ORT owns its allocations; this is whole-device usage after inference, not a process peak.
    return {'usedBytes':total-free,'totalBytes':total}

def probe():
    result = {'ortVersion': None, 'providers': [], 'torchCUDA': False, 'torchVersion': None}
    try:
        import onnxruntime as ort
        result.update(ortVersion=ort.__version__, providers=ort.get_available_providers())
    except Exception as error:
        result['ortError'] = str(error)
    try:
        import torch
        result['torchVersion'] = torch.__version__
        result['torchThreads'] = torch.get_num_threads()
        result['torchCUDA'] = torch.cuda.is_available()
        if result['torchCUDA']:
            capability = torch.cuda.get_device_capability()
            architectures = torch.cuda.get_arch_list()
            if 'sm_' + str(capability[0]) + str(capability[1]) not in architectures and not any(x.startswith('compute_') for x in architectures):
                result['torchCUDA'] = False
                result['cudaReason'] = '当前 PyTorch 构建未包含此显卡架构'
            result.update(gpuName=torch.cuda.get_device_name(), gpuMemory=torch.cuda.get_device_properties(0).total_memory)
    except Exception as error:
        result['torchError'] = str(error)
    return result

def session(device):
    import onnxruntime as ort
    key = (device, THREADS)
    if key not in SESSIONS:
        if device == 'cuda':
            try:
                import torch  # Loads matching CUDA/cuDNN DLLs from optional component.
            except ImportError:
                pass
            if hasattr(ort, 'preload_dlls'):
                ort.preload_dlls()
        options = ort.SessionOptions()
        if THREADS:
            options.intra_op_num_threads = THREADS
        providers = [('CUDAExecutionProvider', {'use_tf32': '0', 'cudnn_conv_algo_search': 'HEURISTIC'})] if device == 'cuda' else ['CPUExecutionProvider']
        current = ort.InferenceSession(str(ROOT / 'runtime/models/basic-pitch/nmp.onnx'), sess_options=options, providers=providers)
        if device == 'cuda' and current.get_providers()[0] != 'CUDAExecutionProvider':
            raise RuntimeError('CUDA provider 未实际启用')
        SESSIONS[key] = current
    return SESSIONS[key]

def infer_blocks(blocks, device, batch, infer):
    # Retry only the failed group. Successful groups remain in output order.
    output, fallbacks, index = [], [], 0
    while index < len(blocks):
        size = min(batch, len(blocks) - index)
        try:
            frames, onsets = infer(np.stack(blocks[index:index + size]), device)
            output.extend(zip(frames, onsets))
            index += size
        except Exception as error:
            if device != 'cuda':
                raise
            fallbacks.append(str(error)[:300])
            if batch > 1:
                batch //= 2
            else:
                device, batch = 'cpu', 1
                SESSIONS.clear()
    return output, device, batch, fallbacks

def basic(request):
    audio = np.fromfile(request['input'], dtype='<f4')
    if not len(audio) or len(audio) > 22050 * 21 or not np.isfinite(audio).all():
        raise ValueError('需要 0–21 秒有限 Float32 单声道音频')
    blocks = list(windows(audio))
    device = request.get('device', 'cpu')
    if device == 'auto':
        device = 'cuda' if probe()['torchCUDA'] else 'cpu'
    started = time.perf_counter()
    initial_fallbacks = []
    try:
        model = session(device)
    except Exception as error:
        if device != 'cuda':
            raise
        initial_fallbacks.append(str(error)[:300])
        device = 'cpu'
        SESSIONS.clear()
        model = session(device)
    load_ms = (time.perf_counter() - started) * 1000
    mapping = {}
    for output in model.get_outputs():
        name = output.name.lower()
        if 'onset' in name or name.split(':')[0].endswith('identity_2') or name == 'statefulpartitionedcall:2':
            mapping['onsets'] = output.name
        elif 'note' in name or 'frame' in name or name.split(':')[0].endswith('identity_1') or name == 'statefulpartitionedcall:1':
            mapping['frames'] = output.name
    if len(mapping) != 2:
        raise ValueError('模型输出无法对应当前帧概率与起音概率')
    def infer(batch, target):
        current = session(target)
        return current.run([mapping['frames'], mapping['onsets']], {current.get_inputs()[0].name: batch.astype(np.float32, copy=False)})
    inference_started = time.perf_counter()
    output, actual, batch, fallbacks = infer_blocks(blocks, device, 4 if device == 'cuda' else 1, infer)
    count = int(len(audio) * FPS // 22050)
    frames = np.concatenate([pair[0][15:-15] for pair in output])[:count].astype('<f4')
    onsets = np.concatenate([pair[1][15:-15] for pair in output])[:count].astype('<f4')
    if frames.shape != (count, 88) or onsets.shape != frames.shape:
        raise ValueError('模型输出形状与当前 Basic Pitch 不一致')
    with open(request['output'], 'wb') as destination:
        frames.tofile(destination)
        onsets.tofile(destination)
    return {'rows': count, 'columns': 88, 'device': actual, 'batch': batch, 'fallbacks': initial_fallbacks + fallbacks, 'loadMs': load_ms, 'inferenceMs': (time.perf_counter()-inference_started)*1000, 'elapsedMs': (time.perf_counter()-started)*1000, 'threads': THREADS or 'auto', 'peakMemoryBytes': peak_memory(), 'gpuMemoryAfter':gpu_memory(actual), 'runtimeVersion': __import__('onnxruntime').__version__}

def dispatch(request):
    if request['kind'] == 'probe':
        return probe()
    if request['kind'] == 'basic':
        return basic(request)
    if request['kind'] == 'release':
        SESSIONS.clear()
        return {'released': True}
    if request['kind'] == 'pitch':
        from pitch_analysis import analyse
        return analyse(request['input'], request['engine'], request['minMidi'], request['maxMidi'], device=request.get('device', 'cpu'), threads=THREADS)
    raise ValueError('未知原生分析请求')

def main():
    global THREADS
    THREADS = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    for line in sys.stdin:
        request = json.loads(line)
        try:
            result = dispatch(request)
            print(json.dumps({'id': request['id'], 'result': result}, ensure_ascii=False, allow_nan=False), flush=True)
        except Exception as error:
            print(json.dumps({'id': request['id'], 'error': str(error)}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
