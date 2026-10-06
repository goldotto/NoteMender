import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    'nagisa_windows_compat', ROOT / 'scripts' / 'nagisa_windows_compat.py'
)
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class NagisaWindowsPathCompatibilityTests(unittest.TestCase):
    def test_unicode_parent_uses_ascii_filename_and_restores_cwd(self):
        with tempfile.TemporaryDirectory(prefix='nagisa-路径-') as temporary:
            root = Path(temporary)
            data = root / 'data'
            data.mkdir()
            model_file = data / 'nagisa_v001.model'
            model_file.write_bytes(b'parameters')

            class Model:
                def __init__(self, hp, params=None, embs=None):
                    self.cwd = os.getcwd()
                    self.params = params
                    with open(params, 'rb') as handle:
                        self.contents = handle.read()

            model_module = SimpleNamespace(Model=Model)
            COMPAT.install_nagisa_model_path_compatibility(model_module, windows=True)
            previous_cwd = os.getcwd()
            os.chdir(root)
            try:
                loaded = model_module.Model({}, 'data/nagisa_v001.model')
            finally:
                os.chdir(previous_cwd)

            self.assertEqual(loaded.params, 'nagisa_v001.model')
            self.assertEqual(Path(loaded.cwd), data)
            self.assertEqual(loaded.contents, b'parameters')
            self.assertEqual(os.getcwd(), previous_cwd)

    def test_ascii_absolute_path_keeps_original_loader_argument(self):
        with tempfile.TemporaryDirectory(prefix='nagisa-ascii-') as temporary:
            model_file = Path(temporary) / 'nagisa_v001.model'
            model_file.write_bytes(b'parameters')

            class Model:
                def __init__(self, hp, params=None, embs=None):
                    self.params = params
                    self.cwd = os.getcwd()

            model_module = SimpleNamespace(Model=Model)
            COMPAT.install_nagisa_model_path_compatibility(model_module, windows=True)
            previous_cwd = os.getcwd()
            loaded = model_module.Model({}, str(model_file))

            self.assertEqual(loaded.params, str(model_file))
            self.assertEqual(loaded.cwd, previous_cwd)

    def test_unicode_path_restores_cwd_when_model_loading_fails(self):
        with tempfile.TemporaryDirectory(prefix='nagisa-路径-') as temporary:
            model_file = Path(temporary) / 'nagisa_v001.model'

            class Model:
                def __init__(self, hp, params=None, embs=None):
                    raise OSError('load failed')

            model_module = SimpleNamespace(Model=Model)
            COMPAT.install_nagisa_model_path_compatibility(model_module, windows=True)
            previous_cwd = os.getcwd()
            with self.assertRaisesRegex(OSError, 'load failed'):
                model_module.Model({}, str(model_file))
            self.assertEqual(os.getcwd(), previous_cwd)


if __name__ == '__main__':
    unittest.main()
