import hashlib
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('component_installer', Path(__file__).resolve().parents[1] / 'scripts' / 'install_qwen_lyrics.py')
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class ComponentDownloadTests(unittest.TestCase):
    def test_hubs_use_their_own_pinned_revision(self):
        spec = {'repo': 'Qwen/test', 'revision': 'modelscope-fixed', 'hfRevision': 'hf-fixed'}
        urls = INSTALLER.model_urls(spec, 'model.safetensors')
        self.assertTrue(any('Revision=modelscope-fixed' in value for value in urls))
        self.assertTrue(any('/resolve/hf-fixed/' in value for value in urls))
        self.assertFalse(any('/resolve/modelscope-fixed/' in value for value in urls))

    def test_verified_existing_file_is_not_downloaded(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            content = b'existing-pinned-model'
            (base / 'model.safetensors').write_bytes(content)
            spec = {'repo': 'Qwen/test', 'folder': 'test', 'revision': 'fixed'}
            manifest = {**spec, 'files': [{'path': 'model.safetensors', 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}]}
            with patch.object(INSTALLER.subprocess, 'Popen') as process:
                INSTALLER.download_model(spec, base, manifest)
                process.assert_not_called()

    def test_corrupt_source_is_rejected_and_next_source_uses_the_same_expected_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            content = b'correct-model'
            spec = {'repo': 'Qwen/test', 'folder': 'test', 'revision': 'fixed'}
            manifest = {**spec, 'files': [{'path': 'model.safetensors', 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}]}
            calls = []
            def start(args):
                calls.append(args[-1])
                Path(args[args.index('--output') + 1]).write_bytes(b'corrupt-model' if len(calls) == 1 else content)
                return SimpleNamespace(returncode=0, args=args, poll=lambda: 0)
            with patch.object(INSTALLER, 'model_urls', return_value=['https://first', 'https://second']), patch.object(INSTALLER.subprocess, 'Popen', side_effect=start):
                INSTALLER.download_model(spec, base, manifest)
            self.assertEqual(calls, ['https://first', 'https://second'])
            self.assertEqual((base / 'model.safetensors').read_bytes(), content)

    def test_small_embedded_provider_metadata_is_hash_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            spec = {'repo': 'Qwen/test', 'folder': 'test', 'revision': 'fixed'}
            content = '{}'
            manifest = {**spec, 'files': [{'path': 'configuration.json', 'size': 2, 'sha256': hashlib.sha256(content.encode()).hexdigest(), 'inline': content}]}
            with patch.object(INSTALLER.subprocess, 'Popen') as process:
                INSTALLER.download_model(spec, Path(directory), manifest)
                process.assert_not_called()
            self.assertEqual((Path(directory) / 'configuration.json').read_text(), '{}')


if __name__ == '__main__':
    unittest.main()
