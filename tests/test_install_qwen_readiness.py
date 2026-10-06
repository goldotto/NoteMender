import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import ModuleType
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('install_qwen_lyrics', ROOT / 'scripts' / 'install_qwen_lyrics.py')
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class LocalQwenReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.specs = {
            'asr': {'repo': 'Qwen/Qwen3-ASR-0.6B', 'revision': 'asr-revision', 'folder': 'Qwen3-ASR-0.6B'},
            'aligner': {'repo': 'Qwen/Qwen3-ForcedAligner-0.6B', 'revision': 'align-revision', 'folder': 'Qwen3-ForcedAligner-0.6B'},
        }
        self.installed = {'qwen-asr': '0.0.6', 'transformers': '4.57.6'}
        self.models = {}
        for role, spec in self.specs.items():
            entries = []
            folder = self.directory / 'models' / spec['folder']
            folder.mkdir(parents=True)
            for name in sorted(INSTALLER.REQUIRED_MODEL_FILES):
                content = (role + ':' + name).encode()
                target = folder / name
                target.write_bytes(content)
                entries.append({'path': name, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
            self.models[role] = {**spec, 'files': entries}
        fingerprint = hashlib.sha256(json.dumps({'models': self.models, 'dependencies': self.installed}, sort_keys=True).encode()).hexdigest()
        (self.directory / 'ready.json').write_text(json.dumps({
            'version': 1, 'engine': 'qwen3-asr', 'model': self.specs['asr']['folder'],
            'aligner': self.specs['aligner']['folder'], 'precision': 'fp32',
            'fingerprint': fingerprint, 'models': self.models,
        }), encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def test_reuses_only_when_every_pinned_file_and_dependency_fingerprint_match(self):
        self.assertTrue(INSTALLER.models_ready(self.directory, self.specs, self.installed))

        model = self.directory / 'models' / self.specs['asr']['folder'] / 'model.safetensors'
        model.write_bytes(model.read_bytes() + b'changed')
        self.assertFalse(INSTALLER.models_ready(self.directory, self.specs, self.installed))

        model.write_bytes((self.directory / 'models' / self.specs['asr']['folder'] / 'config.json').read_bytes())
        self.assertFalse(INSTALLER.models_ready(self.directory, self.specs, self.installed))

    def test_rejects_dependency_version_changes_and_incomplete_file_lists(self):
        self.assertFalse(INSTALLER.models_ready(self.directory, self.specs, {**self.installed, 'transformers': '4.57.5'}))
        marker_path = self.directory / 'ready.json'
        marker = json.loads(marker_path.read_text(encoding='utf-8'))
        marker['models']['aligner']['files'] = [entry for entry in marker['models']['aligner']['files'] if entry['path'] != 'vocab.json']
        marker_path.write_text(json.dumps(marker), encoding='utf-8')
        self.assertFalse(INSTALLER.models_ready(self.directory, self.specs, self.installed))

    def test_dependency_repair_list_contains_only_missing_or_wrong_versions(self):
        lock = {'qwen-asr': '0.0.6', 'transformers': '4.57.6', 'numpy': '1.26.4'}
        installed = {'Qwen-ASR': '0.0.6', 'transformers': '4.57.5', 'numpy': '1.26.4'}
        self.assertEqual(INSTALLER.missing_lock_packages(installed, lock), ['transformers'])

    def test_audio_readiness_does_not_require_optional_omni_vision_facade(self):
        qwen_asr = ModuleType('qwen_asr')
        qwen_asr.Qwen3ASRModel = object
        qwen_asr.Qwen3ForcedAligner = object
        def import_module(name):
            if name == 'qwen_omni_utils':
                raise ModuleNotFoundError("No module named 'torchvision'")
            return qwen_asr if name == 'qwen_asr' else ModuleType(name)
        with (
            patch.object(INSTALLER, 'prepare_nagisa_for_windows'),
            patch.object(INSTALLER.importlib, 'import_module', side_effect=import_module),
            patch.dict(sys.modules, {'qwen_asr': qwen_asr}),
        ):
            self.assertEqual(INSTALLER.failed_imports(), [])

    def test_import_readiness_installs_path_compat_before_qwen_import(self):
        events = []
        qwen_asr = ModuleType('qwen_asr')
        qwen_asr.Qwen3ASRModel = object
        qwen_asr.Qwen3ForcedAligner = object
        imports = {'qwen_asr': qwen_asr, 'nagisa': ModuleType('nagisa')}

        def import_module(name):
            events.append(name)
            return imports[name]

        with (
            patch.object(INSTALLER, 'IMPORTS', ['qwen_asr', 'nagisa']),
            patch.object(INSTALLER, 'prepare_nagisa_for_windows', side_effect=lambda: events.append('compat')),
            patch.object(INSTALLER.importlib, 'import_module', side_effect=import_module),
            patch.dict(sys.modules, {'qwen_asr': qwen_asr}),
        ):
            self.assertEqual(INSTALLER.failed_imports(), [])

        self.assertEqual(events, ['compat', 'qwen_asr', 'nagisa'])


if __name__ == '__main__':
    unittest.main()
