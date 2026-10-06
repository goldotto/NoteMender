"""Keep nagisa's DyNet model load working under Unicode Windows paths."""
import functools
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import sys
import threading


_PACKAGE_MARKER = "_notemender_nagisa_unicode_path_compat"
_INIT_MARKER = "_notemender_nagisa_unicode_path_compat_init"
_MODEL_LOAD_LOCK = threading.RLock()


def install_nagisa_model_path_compatibility(model_module, *, windows=None):
    """Wrap Model.__init__ so DyNet only receives an ASCII model filename.

    nagisa's own readers handle Unicode paths, but DyNet's C++ file reader may
    not. nagisa's packaged parameter filename is ASCII, so resolving it from
    its parent directory avoids passing the Unicode prefix into DyNet.
    """
    if windows is None:
        windows = os.name == "nt"
    if not windows:
        return False

    model_class = getattr(model_module, "Model", None)
    original_init = getattr(model_class, "__init__", None)
    if not callable(original_init):
        raise RuntimeError("nagisa.model.Model.__init__ is unavailable")
    if getattr(original_init, _INIT_MARKER, False):
        return True

    @functools.wraps(original_init)
    def unicode_safe_init(self, hp, params=None, embs=None):
        if params is None:
            return original_init(self, hp, params=params, embs=embs)

        raw_path = os.fsdecode(os.fspath(params))
        path = Path(raw_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        filename = path.name
        if str(path).isascii() or not filename.isascii():
            return original_init(self, hp, params=params, embs=embs)

        # This runs during nagisa's synchronous import/model initialization.
        # Serialize other patched initializers while the process cwd is changed.
        with _MODEL_LOAD_LOCK:
            previous_cwd = os.getcwd()
            try:
                os.chdir(path.parent)
                return original_init(self, hp, params=filename, embs=embs)
            finally:
                os.chdir(previous_cwd)

    setattr(unicode_safe_init, _INIT_MARKER, True)
    model_class.__init__ = unicode_safe_init
    return True


def prepare_nagisa_for_windows():
    """Import nagisa with its DyNet path workaround installed first.

    Importing ``nagisa.model`` normally first executes ``nagisa.__init__``,
    which constructs the default Tagger immediately. A temporary package
    module lets us load and patch the model submodule before executing the
    original package initializer.
    """
    if os.name != "nt":
        return False

    existing_package = sys.modules.get("nagisa")
    existing_model = sys.modules.get("nagisa.model")
    if existing_model is not None:
        install_nagisa_model_path_compatibility(existing_model)
        if existing_package is not None:
            setattr(existing_package, _PACKAGE_MARKER, True)
        return True
    if existing_package is not None:
        raise RuntimeError("nagisa was imported before its Windows path workaround")

    package_spec = importlib.machinery.PathFinder.find_spec("nagisa", sys.path)
    if package_spec is None or not package_spec.submodule_search_locations:
        raise ModuleNotFoundError("No module named 'nagisa'")

    package = importlib.util.module_from_spec(package_spec)
    sys.modules["nagisa"] = package
    try:
        package_dir = Path(next(iter(package_spec.submodule_search_locations)))
        model_spec = importlib.util.spec_from_file_location(
            "nagisa.model", package_dir / "model.py"
        )
        if model_spec is None or model_spec.loader is None:
            raise ImportError("Could not load nagisa.model")
        model_module = importlib.util.module_from_spec(model_spec)
        sys.modules["nagisa.model"] = model_module
        setattr(package, "model", model_module)
        model_spec.loader.exec_module(model_module)
        install_nagisa_model_path_compatibility(model_module)

        # Execute nagisa's actual __init__.py unchanged. Its Tagger and Japanese
        # segmentation APIs remain fully available to qwen_asr.
        package_spec.loader.exec_module(package)
        setattr(package, _PACKAGE_MARKER, True)
        return True
    except Exception:
        if sys.modules.get("nagisa") is package:
            sys.modules.pop("nagisa", None)
        if sys.modules.get("nagisa.model") is locals().get("model_module"):
            sys.modules.pop("nagisa.model", None)
        raise
