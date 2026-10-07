"""Read-only environment probe. Imports packages; never loads an inference model."""
import hashlib
import importlib
import importlib.util
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import struct
import sys


def sha(file):
    result = hashlib.sha256()
    with file.open('rb') as handle:
        for data in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def probe(request):
    result = {'python': sys.executable, 'compatible': sys.version_info[:2] == (3, 11) and struct.calcsize('P') == 8, 'ready': False}
    if not result['compatible']:
        result['reason'] = '需要 64 位 Python 3.11'
        return result
    component = request['component']
    try:
        if component == 'python':
            import venv
            import ensurepip
        elif component in ('audio', 'six'):
            for name in ['torch', 'torchaudio', 'numpy', 'demucs', 'librosa', 'av', 'soundfile']:
                importlib.import_module(name)
            import torch
            if metadata.version('demucs') != '4.0.1' or metadata.version('librosa') != '0.11.0' or metadata.version('numpy') != '1.26.4':
                raise ValueError('音频依赖版本与此版本不兼容')
            if torch.__version__ not in ('2.5.1+cpu', '2.7.1+cu128') or metadata.version('torchaudio') != torch.__version__:
                raise ValueError('Torch／torchaudio 版本不兼容')
            spec = request['model']
            file = Path(request['modelHome']) / 'hub' / 'checkpoints' / spec['file']
            if not file.is_file() or file.stat().st_size != spec['size']:
                raise ValueError('分轨模型缺失或大小不正确')
            if request.get('deep') and sha(file) != spec['sha256']:
                raise ValueError('分轨模型 SHA-256 不正确')
            result['torchVersion'] = torch.__version__
            result['crepe'] = importlib.util.find_spec('torchcrepe') is not None
        elif component in ('gpu', 'cpu'):
            import numpy
            import onnxruntime as ort
            if numpy.__version__ != '1.26.4' or ort.__version__ not in ('1.22.0', '1.22.1'):
                raise ValueError('ONNX Runtime 或 NumPy 版本不兼容')
            result.update(ortVersion=ort.__version__, directory=str(Path(ort.__file__).resolve().parent.parent), providers=ort.get_available_providers())
            if component == 'gpu':
                import torch
                import torchaudio
                if torch.__version__ != '2.7.1+cu128' or torchaudio.__version__ != torch.__version__ or ort.__version__ != '1.22.0':
                    raise ValueError('需要 Torch 2.7.1+cu128 与 ONNX Runtime GPU 1.22.0')
                if not torch.cuda.is_available() or 'CUDAExecutionProvider' not in ort.get_available_providers():
                    raise ValueError('显卡组件存在，但 NVIDIA 显卡／驱动不可用')
                result.update(torchVersion=torch.__version__, gpuName=torch.cuda.get_device_name(0))
                result['crepe'] = importlib.util.find_spec('torchcrepe') is not None
        elif component == 'lyrics':
            from nagisa_windows_compat import prepare_nagisa_for_windows
            prepare_nagisa_for_windows()
            from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner  # noqa: F401
            import torch
            lock = request['lock']
            # Validate only distributions used by the audio adapter, not the optional vision facade.
            for name, version in lock.items():
                if metadata.version(name) != version:
                    raise ValueError('歌词依赖版本不兼容：' + name)
            for key, spec in request['models'].items():
                base = Path(request['modelPaths'][key]).resolve()
                for item in spec['files']:
                    file = (base / item['path']).resolve()
                    if 'inline' in item and not file.exists():
                        # ModelScope's small catalog metadata is unnecessary to load a HF snapshot.
                        continue
                    if not file.is_relative_to(base) or not file.is_file() or file.stat().st_size != item['size']:
                        raise ValueError('歌词模型文件缺失或损坏：' + item['path'])
                    if request.get('deep') and sha(file) != item['sha256']:
                        raise ValueError('歌词模型 SHA-256 不正确：' + item['path'])
            result['torchVersion'] = torch.__version__
        elif component == 'singing':
            import torch
            if not torch.cuda.is_available():
                raise ValueError('演唱精细分音需要 NVIDIA 显卡')
            for name in ['pretty_midi', 'pyworld', 'einops', 'yaml']:
                importlib.import_module(name)
            directory = Path(request['directory'])
            marker = json.loads((directory / 'ready.json').read_text(encoding='utf-8'))
            required = {'rosvot/model.pt', 'rosvot/config.yaml', 'rwbd/model.pt', 'rwbd/config.yaml', 'rmvpe/model.pt'}
            if not required.issubset(marker.get('fingerprints', {})):
                raise ValueError('ROSVOT 检查点清单不完整')
            if not (directory / 'ROSVOT' / 'inference' / 'rosvot.py').is_file():
                raise ValueError('ROSVOT 源文件缺失')
            for relative, digest in marker['fingerprints'].items():
                if relative == 'source':
                    continue
                base = (directory / 'ROSVOT' / 'checkpoints').resolve()
                file = (base / relative).resolve()
                if not file.is_relative_to(base):
                    raise ValueError('ROSVOT 检查点路径无效')
                if not file.is_file() or (request.get('deep') and sha(file) != digest):
                    raise ValueError('ROSVOT 检查点不完整')
        else:
            raise ValueError('不支持的组件')
        result['ready'] = True
    except Exception as error:
        result['reason'] = str(error).splitlines()[0][:400]
    return result


if __name__ == '__main__':
    print(json.dumps(probe(json.loads(sys.argv[1])), ensure_ascii=False), flush=True)
