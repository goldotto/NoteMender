"""Extract optional official archives, checking every destination before writing."""
from pathlib import Path, PurePosixPath
import sys
import zipfile
archive, destination = sys.argv[1:3]
strip = '--strip-root' in sys.argv[3:]
root = Path(destination).resolve()
with zipfile.ZipFile(archive) as z:
    for entry in z.infolist():
        if entry.is_dir():
            continue
        parts = PurePosixPath(entry.filename.replace('\\', '/')).parts
        if strip:
            parts = parts[1:]
        if not parts or any(p in ('.', '..') or ':' in p for p in parts):
            raise ValueError('Invalid archive path')
        target = root.joinpath(*parts).resolve()
        target.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(z.read(entry))
