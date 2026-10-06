"""Project-local Qwen ASR overlay, reusing the installed Torch/audio runtime."""
import hashlib
import importlib.metadata
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote, urlencode
from urllib.request import urlopen


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as handle:
        for data in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def download_model(spec, destination):
    """Pinned official ModelScope files, resume downloads and verify SHA256."""
    repo = spec['repo']
    base = f'https://modelscope.cn/api/v1/models/{repo}/repo'
    with urlopen(base + '/files?' + urlencode({'Revision': spec['revision'], 'Recursive': 'true'}), timeout=60) as response:
        listing = json.load(response)
    if not listing.get('Success'):
        raise RuntimeError('ModelScope 文件清单不可用')
    files = []
    for entry in listing['Data']['Files']:
        name = entry['Path']
        if entry['Type'] != 'blob' or not name.endswith(('.json', '.txt', '.safetensors')):
            continue
        file = destination / name
        if not file.resolve().is_relative_to(destination.resolve()):
            raise RuntimeError('模型文件路径无效')
        file.parent.mkdir(parents=True, exist_ok=True)
        size, sha = entry['Size'], entry['Sha256']
        if not (file.exists() and file.stat().st_size == size and digest(file) == sha):
            partial = file.with_name(file.name + '.part')
            url = base + '?' + urlencode({'Revision': spec['revision'], 'FilePath': name})
            print(f'下载 {repo}/{name} ({size / 1048576:.1f} MB)…', flush=True)
            for attempt in range(3):
                if partial.exists() and partial.stat().st_size == size:
                    break
                subprocess.run(['curl.exe', '--fail', '--location', '--continue-at', '-', '--retry', '2', '--connect-timeout', '30', '--speed-time', '90', '--speed-limit', '1024', '--output', str(partial), url], check=True)
                if partial.stat().st_size == size:
                    break
            if partial.stat().st_size != size or digest(partial) != sha:
                raise RuntimeError(f'{name} 下载校验未通过；保留下载供检查')
            partial.replace(file)
        files.append({'path': name, 'size': size, 'sha256': sha})
    if not any(f['path'].endswith('.safetensors') for f in files):
        raise RuntimeError('模型权重清单为空')
    return {**spec, 'files': files}


def main():
    root = Path(sys.argv[1]).resolve()
    directory = root / 'runtime' / 'lyrics-qwen'
    dependencies = directory / 'dependencies'
    dependencies.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(dependencies))
    lock = root / 'scripts' / 'qwen-lyrics-dependencies.lock.json'
    if '--models-only' not in sys.argv:
        # qwen-asr's GUI and vLLM extras are not needed by our local API.
        packages = ['transformers==4.57.6', 'accelerate==1.12.0', 'nagisa==0.2.11', 'soynlp==0.0.493', 'qwen-omni-utils==0.0.9', 'huggingface-hub==0.36.0', 'numpy==1.26.4']
        for index in ['https://pypi.tuna.tsinghua.edu.cn/simple', 'https://pypi.org/simple']:
            try:
                if lock.exists():
                    planned = [f'{name}=={version}' for name, version in json.loads(lock.read_text(encoding='utf-8')).items()]
                else:
                    report = directory / 'install-plan.json'
                    subprocess.run([sys.executable, '-m', 'pip', 'install', '--dry-run', '--report', str(report), '--index-url', index, *packages], check=True)
                    planned = [f"{p['metadata']['name']}=={p['metadata']['version']}" for p in json.loads(report.read_text(encoding='utf-8'))['install']]
                    planned += packages + ['qwen-asr==0.0.6']
                if any(p.split('==')[0].lower() in ['torch', 'torchaudio', 'torchvision', 'triton'] for p in planned):
                    raise RuntimeError('请先安装项目运行环境；歌词组件不会替换 Torch')
                subprocess.run([sys.executable, '-m', 'pip', 'install', '--upgrade', '--no-deps', '--target', str(dependencies), '--index-url', index, '--timeout', '90', '--retries', '3', *sorted(set(planned))], check=True)
                break
            except subprocess.CalledProcessError:
                if index.endswith('pypi.org/simple'):
                    raise
    importlib.invalidate_caches()
    import torch
    import qwen_asr
    from qwen_asr import Qwen3ForcedAligner, Qwen3ASRModel
    installed = {d.metadata['Name']: d.version for d in importlib.metadata.distributions(path=[str(dependencies)])}
    (directory / 'dependency-lock.json').write_text(json.dumps(installed, indent=2), encoding='utf-8')
    print('Qwen 依赖导入正常；现有 Torch 与显卡组件保持独立。', flush=True)
    if '--dependencies-only' in sys.argv:
        return
    specs = json.loads((root / 'scripts' / 'qwen-lyrics-models.json').read_text(encoding='utf-8'))
    models = {name: download_model(spec, directory / 'models' / spec['folder']) for name, spec in specs.items()}
    # Check processor and tokenizer locally without running a GPU workload.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    from qwen_asr.core.transformers_backend import Qwen3ASRProcessor
    from qwen_asr.inference.qwen3_forced_aligner import Qwen3ForceAlignProcessor
    for spec in specs.values():
        Qwen3ASRProcessor.from_pretrained(str(directory / 'models' / spec['folder']), local_files_only=True, fix_mistral_regex=True)
    Qwen3ForceAlignProcessor()
    fingerprint = hashlib.sha256(json.dumps({'models': models, 'dependencies': installed}, sort_keys=True).encode()).hexdigest()
    (directory / 'ready.json').write_text(json.dumps({'version': 1, 'engine': 'qwen3-asr', 'model': specs['asr']['folder'], 'aligner': specs['aligner']['folder'], 'precision': 'fp32', 'fingerprint': fingerprint, 'models': models}), encoding='utf-8')
    print('Qwen3-ASR 与逐字对齐模型已就绪，可离线使用。', flush=True)


if __name__ == '__main__':
    main()
