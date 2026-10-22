"""Reuses a reviewed local runtime ZIP. No network, global installs, personal state or models from disk scans."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--runtime-zip', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--bootstrap', action='store_true')
parser.add_argument('--update')
parser.add_argument('--receipt')
args = parser.parse_args()
out = Path(args.out).resolve()
if out.drive.upper() != 'D:':
    raise ValueError('Build staging and output must stay on D:')
out.mkdir(parents=True, exist_ok=False)

def copy_entry(archive, entry, base, prefix='NoteMender/'):
    relative = entry.filename.removeprefix(prefix)
    parts = PurePosixPath(relative).parts
    if not relative or '\\' in relative or ':' in relative or any(p in ('..', '.') for p in parts) or relative.startswith('/'):
        raise ValueError('Unsafe archive path')
    if entry.is_dir():
        return
    dest = base.joinpath(*parts)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(entry) as source, dest.open('xb') as target:
        shutil.copyfileobj(source, target, 1024*1024)

with zipfile.ZipFile(args.runtime_zip) as archive:
    names = archive.namelist()
    if len(set(names)) != len(names):
        raise ValueError('Duplicate payload entries')
    if args.bootstrap:
        for entry in archive.infolist():
            name = entry.filename
            if name.startswith('NoteMender/runtime/python/') and '/site-packages/' not in name and not name.endswith(('.pyc', '.pyo')):
                copy_entry(archive, entry, out, 'NoteMender/runtime/python/')
    else:
        if not args.update or not args.receipt:
            raise ValueError('Signed app ZIP and matching installation receipt required')
        lite, base = out/'lite', out/'base'
        lite.mkdir(); base.mkdir()
        with zipfile.ZipFile(args.update) as update:
            for entry in update.infolist():
                copy_entry(update, entry, lite, '')
        receipt = json.loads(Path(args.receipt).read_text('utf-8'))
        for entry in archive.infolist():
            if entry.filename.startswith('NoteMender/runtime/node/'):
                copy_entry(archive, entry, lite)
        (lite/'runtime/updates').mkdir(parents=True)
        (lite/'runtime/updates/installed.json').write_text(json.dumps(receipt), 'utf-8')
        (lite/'runtime/edition.json').write_text(json.dumps({'edition':'lite','offline':['edit','midi','export','timbres']}), 'utf-8')
        for file in lite.rglob('*'):
            if file.is_file():
                target=base/file.relative_to(lite);target.parent.mkdir(parents=True,exist_ok=True)
                if file.name == 'edition.json':
                    shutil.copyfile(file,target)
                else:
                    os.link(file,target)
        for entry in archive.infolist():
            name=entry.filename
            if name.startswith(('NoteMender/runtime/python/','NoteMender/runtime/models/','NoteMender/runtime/acceleration/cpu/')):
                if name.endswith(('.pyc','.pyo','.log')) or any(part in ('tests','test','test_data','__pycache__') for part in PurePosixPath(name).parts):
                    continue
                copy_entry(archive,entry,base)
            elif name in ('NoteMender/runtime/demucs-ready.json','NoteMender/runtime/demucs6-ready.json'):
                copy_entry(archive,entry,base)
        # Browser model is an optional runtime asset, never part of a program update.
        root=Path(__file__).resolve().parent.parent
        model=root/'public/models/basic-pitch'
        destination=base/'runtime/models/browser-basic-pitch';destination.mkdir(parents=True)
        for name in ('model.json','group1-shard1of1.bin'):
            shutil.copyfile(model/name,destination/name)
        (base/'runtime/edition.json').write_text(json.dumps({'edition':'base','offline':['basic','audio','six','edit','midi','export','timbres']}), 'utf-8')
        for edition in (lite,base):
            if any(edition.glob('**/component-settings.json')) or any(edition.glob('**/audio-resources/*')):
                raise ValueError('Private state found')
            report=[]
            for file in sorted(edition.rglob('*')):
                if not file.is_file():continue
                rel=file.relative_to(edition).as_posix()
                if edition==lite and rel.startswith(('runtime/python/','runtime/models/','public/models/','runtime/acceleration/')):
                    raise ValueError('Analysis component in lite edition')
                if rel.startswith(('runtime/lyrics-qwen/','runtime/singing/','runtime/muscriptor/','runtime/acceleration/gpu/')):
                    raise ValueError('Optional large component bundled')
                report.append({'path':rel,'size':file.stat().st_size})
            (out/(edition.name+'-inventory.json')).write_text(json.dumps(report,indent=2),'utf-8')
print(json.dumps({'output':str(out),'bootstrap':args.bootstrap}))
