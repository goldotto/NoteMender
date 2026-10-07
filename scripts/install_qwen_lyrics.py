"""Project-local Qwen ASR overlay, reusing installed runtimes and model files."""
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode
from urllib.request import urlopen
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
SCRIPT_DIRECTORY = str(Path(__file__).resolve().parent)
if SCRIPT_DIRECTORY not in sys.path:
    sys.path.insert(0, SCRIPT_DIRECTORY)
from nagisa_windows_compat import prepare_nagisa_for_windows


REQUIRED_MODEL_FILES = {
    'chat_template.json', 'config.json', 'configuration.json',
    'generation_config.json', 'merges.txt', 'model.safetensors',
    'preprocessor_config.json', 'tokenizer_config.json', 'vocab.json',
}
# Validate the audio entry points used by this application. Importing the
# unrelated Omni vision facade requires torchvision, which ASR does not use.
IMPORTS = [
    'numpy', 'PIL', 'psutil', 'qwen_asr',
    'transformers', 'accelerate', 'huggingface_hub', 'tokenizers',
    'safetensors', 'regex', 'nagisa', 'soynlp', 'six',
]


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as handle:
        for data in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def canonical(name):
    return re.sub(r'[-_.]+', '-', name).lower()


def installed_distributions(dependencies):
    return {
        distribution.metadata['Name']: distribution.version
        for distribution in importlib.metadata.distributions(path=[str(dependencies)])
        if distribution.metadata.get('Name')
    }


def missing_lock_packages(installed, lock):
    by_name = {canonical(name): version for name, version in installed.items()}
    return [name for name, version in lock.items() if by_name.get(canonical(name)) != version]


def failed_imports():
    failed = []
    try:
        # qwen_asr imports nagisa itself; install the Windows DyNet path
        # workaround before any dependency import can trigger nagisa.__init__.
        prepare_nagisa_for_windows()
    except Exception:
        return ['nagisa']
    try:
        importlib.invalidate_caches()
        for module in IMPORTS:
            try:
                importlib.import_module(module)
            except Exception:
                failed.append(module)
        from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner  # noqa: F401
    except Exception:
        if 'qwen_asr' not in failed:
            failed.append('qwen_asr')
    return failed


def ensure_pip():
    """Use Python's bundled wheels only when this selected installer needs pip."""
    available = subprocess.run(
        [sys.executable, '-m', 'pip', '--version'],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if available.returncode == 0:
        return
    if os.environ.get('NOTEMENDER_READONLY_PYTHON') == '1':
        raise RuntimeError('复用环境及包内离线 pip 不可用；请重新解压基础版。不会修改外部 Python。')
    subprocess.run(
        [sys.executable, '-m', 'ensurepip', '--upgrade', '--default-pip'],
        check=True,
    )
    subprocess.run([sys.executable, '-m', 'pip', '--version'], check=True)


def models_ready(directory, specs, installed):
    """Verify every file listed in the local ready marker; never contact a hub."""
    try:
        marker = json.loads((directory / 'ready.json').read_text(encoding='utf-8'))
        if marker.get('version') != 1 or marker.get('engine') != 'qwen3-asr':
            return False
        if marker.get('model') != specs['asr']['folder'] or marker.get('aligner') != specs['aligner']['folder']:
            return False
        if marker.get('precision') != 'fp32' or not re.fullmatch(r'[a-f0-9]{64}', marker.get('fingerprint', '')):
            return False
        model_manifest = marker.get('models')
        if not isinstance(model_manifest, dict) or set(model_manifest) != set(specs):
            return False
        for key, spec in specs.items():
            entry = model_manifest.get(key)
            if not isinstance(entry, dict):
                return False
            for field in ('repo', 'revision', 'folder'):
                if entry.get(field) != spec.get(field):
                    return False
            files = entry.get('files')
            if not isinstance(files, list) or not files:
                return False
            listed = set()
            model_root = (directory / 'models' / spec['folder']).resolve()
            for item in files:
                relative = item.get('path')
                size = item.get('size')
                sha = item.get('sha256')
                if not isinstance(relative, str) or not isinstance(size, int) or size <= 0:
                    return False
                if not isinstance(sha, str) or not re.fullmatch(r'[a-f0-9]{64}', sha):
                    return False
                file = (model_root / relative).resolve()
                if not file.is_relative_to(model_root) or relative in listed or not file.is_file():
                    return False
                listed.add(relative)
                if file.stat().st_size != size or digest(file) != sha:
                    return False
            if not REQUIRED_MODEL_FILES.issubset(listed):
                return False
        expected_fingerprint = hashlib.sha256(
            json.dumps({'models': model_manifest, 'dependencies': installed}, sort_keys=True).encode()
        ).hexdigest()
        return expected_fingerprint == marker['fingerprint']
    except (OSError, ValueError, KeyError, TypeError):
        return False


def pypi_sources():
    values = ['https://pypi.tuna.tsinghua.edu.cn/simple', 'https://mirrors.aliyun.com/pypi/simple/', 'https://pypi.org/simple']
    return [values[-1], *values[:-1]] if os.environ.get('NOTEMENDER_DOWNLOAD_REGION') == 'global' else values


def model_urls(spec, name):
    from urllib.parse import quote
    ms = 'https://modelscope.cn/api/v1/models/' + spec['repo'] + '/repo?' + urlencode({'Revision': spec['revision'], 'FilePath': name})
    revision = spec.get('hfRevision', spec['revision'])
    urls = [ms, 'https://hf-mirror.com/' + spec['repo'] + '/resolve/' + revision + '/' + quote(name), 'https://huggingface.co/' + spec['repo'] + '/resolve/' + revision + '/' + quote(name)]
    return [urls[-1], *urls[:-1]] if os.environ.get('NOTEMENDER_DOWNLOAD_REGION') == 'global' else urls


def download_model(spec, destination, manifest=None):
    """Pinned file hashes are independent of whichever download source is selected."""
    if manifest is None:
        manifests = json.loads((Path(__file__).parent / 'qwen-download-manifest.json').read_text(encoding='utf-8'))
        manifest = next(value for value in manifests.values() if value['repo'] == spec['repo'])
    files = manifest['files']
    total = sum(item['size'] for item in files)
    finished = 0
    for entry in files:
        name, size, expected_sha = entry['path'], entry['size'], entry['sha256']
        file = destination / name
        if not file.resolve().is_relative_to(destination.resolve()):
            raise RuntimeError('模型文件路径无效')
        file.parent.mkdir(parents=True, exist_ok=True)
        if file.exists() and file.stat().st_size == size and digest(file) == expected_sha:
            finished += size
            continue
        if 'inline' in entry:
            data = entry['inline'].encode('utf-8')
            if len(data) != size or hashlib.sha256(data).hexdigest() != expected_sha:
                raise RuntimeError('内置模型配置校验失败')
            file.write_bytes(data)
            finished += size
            continue
        partial = file.with_name(file.name + '.part')
        complete = False
        for url in model_urls({**manifest, **spec}, name):
            print('尝试下载源：' + url.split('/')[2], flush=True)
            try:
                import time
                process = subprocess.Popen(['curl.exe', '--silent', '--show-error', '--fail', '--location', '--continue-at', '-', '--retry', '1', '--connect-timeout', '20', '--speed-time', '60', '--speed-limit', '1024', '--output', str(partial), url])
                while process.poll() is None:
                    amount = partial.stat().st_size if partial.exists() else 0
                    print(json.dumps({'stage': '下载 ' + spec['folder'] + ' · ' + name, 'progress': min(1, (finished + amount) / total)}, ensure_ascii=False), flush=True)
                    time.sleep(1)
                if process.returncode:
                    raise subprocess.CalledProcessError(process.returncode, process.args)
                if partial.stat().st_size != size or digest(partial) != expected_sha:
                    partial.unlink(missing_ok=True)
                    raise RuntimeError('下载文件 SHA-256 校验未通过')
                partial.replace(file)
                complete = True
                break
            except (subprocess.CalledProcessError, OSError, RuntimeError) as error:
                print(str(error), flush=True)
        if not complete:
            raise RuntimeError(name + ' 各下载源均未完成；保留有效部分供下次续传')
        finished += size
        print(json.dumps({'stage': '下载 ' + spec['folder'] + ' · ' + name, 'progress': finished / total}, ensure_ascii=False), flush=True)
    return {**spec, 'files': files}


def main():
    root = Path(sys.argv[1]).resolve()
    directory = root / 'runtime' / 'lyrics-qwen'
    dependencies = directory / 'dependencies'
    verify_only = '--verify-only' in sys.argv
    if not verify_only:
        dependencies.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(dependencies))
    lock_path = root / 'scripts' / 'qwen-lyrics-dependencies.lock.json'
    if lock_path.exists():
        lock = json.loads(lock_path.read_text(encoding='utf-8'))
    else:
        lock = {
            'transformers': '4.57.6', 'accelerate': '1.12.0',
            'nagisa': '0.2.11', 'soynlp': '0.0.493',
            'qwen-omni-utils': '0.0.9', 'huggingface-hub': '0.36.0',
            'numpy': '1.26.4', 'qwen-asr': '0.0.6',
        }
    if verify_only:
        installed = installed_distributions(dependencies)
        missing = missing_lock_packages(installed, lock)
        if missing:
            raise RuntimeError('本地 Qwen 依赖未就绪：' + ', '.join(missing))
        failures = failed_imports()
        if failures:
            raise RuntimeError('本地 Qwen 依赖导入失败：' + ', '.join(failures))
        specs = json.loads((root / 'scripts' / 'qwen-lyrics-models.json').read_text(encoding='utf-8'))
        if not models_ready(directory, specs, installed):
            raise RuntimeError('本地 Qwen 模型完整性检查失败')
        print('本地 Qwen 组件完整且可导入；仅验证，未下载或安装。', flush=True)
        return
    if '--models-only' not in sys.argv:
        installed = installed_distributions(dependencies)
        missing = missing_lock_packages(installed, lock)
        if missing:
            # The overlay intentionally never changes Torch or torchaudio.
            import torch  # noqa: F401
            ensure_pip()
            repairs = [f'{name}=={lock[name]}' for name in missing]
            for index in pypi_sources():
                try:
                    subprocess.run([sys.executable, '-m', 'pip', 'install', '--upgrade', '--no-deps', '--target', str(dependencies), '--index-url', index, '--timeout', '90', '--retries', '3', *sorted(set(repairs))], check=True)
                    break
                except subprocess.CalledProcessError:
                    if index == pypi_sources()[-1]:
                        raise
            installed = installed_distributions(dependencies)
            missing = missing_lock_packages(installed, lock)
            if missing:
                raise RuntimeError('Qwen 依赖安装后版本仍不匹配：' + ', '.join(missing))
        failures = failed_imports()
        if failures:
            raise RuntimeError('以下本地 Qwen 依赖版本已匹配但导入失败，文件可能损坏或与当前 Python 不兼容：' + ', '.join(failures))
    else:
        installed = installed_distributions(dependencies)
        missing = missing_lock_packages(installed, lock)
        if missing:
            raise RuntimeError('本机 Qwen 依赖未就绪；请先运行歌词组件安装器')
        failures = failed_imports()
        if failures:
            raise RuntimeError('以下本地 Qwen 依赖导入失败：' + ', '.join(failures))

    try:
        import torch  # noqa: F401
        from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner  # noqa: F401
    except Exception as error:
        raise RuntimeError('当前 Python/Torch 运行环境不兼容，请先安装项目运行环境') from error
    dependency_lock = directory / 'dependency-lock.json'
    dependency_lock.write_text(json.dumps(installed, indent=2), encoding='utf-8')
    print('Qwen 依赖导入正常；现有 Torch 与显卡组件保持独立。', flush=True)
    if '--dependencies-only' in sys.argv:
        return

    specs = json.loads((root / 'scripts' / 'qwen-lyrics-models.json').read_text(encoding='utf-8'))
    if models_ready(directory, specs, installed):
        print('Qwen 模型清单、文件大小、SHA-256 与依赖版本均匹配，直接复用本地文件。', flush=True)
        return

    models = {name: download_model(spec, directory / 'models' / spec['folder']) for name, spec in specs.items()}
    # Check processors and tokenizers locally without running a GPU workload.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    from qwen_asr.core.transformers_backend import Qwen3ASRProcessor
    from qwen_asr.inference.qwen3_forced_aligner import Qwen3ForceAlignProcessor
    for spec in specs.values():
        Qwen3ASRProcessor.from_pretrained(str(directory / 'models' / spec['folder']), local_files_only=True, fix_mistral_regex=True)
    Qwen3ForceAlignProcessor()
    fingerprint = hashlib.sha256(json.dumps({'models': models, 'dependencies': installed}, sort_keys=True).encode()).hexdigest()
    (directory / 'ready.json').write_text(json.dumps({'version': 1, 'engine': 'qwen3-asr', 'model': specs['asr']['folder'], 'aligner': specs['aligner']['folder'], 'precision': 'fp32', 'fingerprint': fingerprint, 'models': models}), encoding='utf-8')
    if not models_ready(directory, specs, installed):
        (directory / 'ready.json').unlink(missing_ok=True)
        raise RuntimeError('Qwen 本地模型文件未通过安装后完整性检查')
    print('Qwen3-ASR 与逐字对齐模型已就绪，可离线使用。', flush=True)


if __name__ == '__main__':
    main()
