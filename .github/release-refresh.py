"""Rebuild a reviewed release asset by reusing its runtime byte for byte."""
from pathlib import Path
import copy, hashlib, json, os, struct, zipfile, urllib.request, http.client

BASE = 'NoteMender-2.5.0-demo.7-windows-base-gui.zip'
SOURCE = 'NoteMender-2.5.0-demo.7-source-components.zip'
EXPECTED = '6901067dde20675939af321aca017340dc2d49105a15980081b35e86781617b3'
RELEASE = 'https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/'
TOKEN = os.environ.get('GITHUB_TOKEN')

def verify(path, digest):
    with open(path, 'rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    assert actual == digest, 'Archive checksum mismatch'

def strip_central_extra(extra):
    result = b''
    while extra:
        kind, size = struct.unpack('<HH', extra[:4])
        field = extra[:4 + size]
        assert len(field) == size + 4
        if kind not in (1, 0x7075):
            result += field
        extra = extra[size + 4:]
    return result

def transfer(src, reader, dst, names):
    ordered = sorted(src.infolist(), key=lambda item: item.header_offset)
    for index, info in enumerate(ordered):
        if info.filename not in names:
            continue
        assert info.filename.startswith('NoteMender/') and '..' not in Path(info.filename).parts
        assert info.filename not in dst.NameToInfo
        end = ordered[index + 1].header_offset if index + 1 < len(ordered) else src.start_dir
        reader.seek(info.header_offset)
        cloned = copy.copy(info)
        cloned.header_offset = dst.fp.tell()
        cloned.extra = strip_central_extra(cloned.extra)
        remaining = end - info.header_offset
        while remaining:
            block = reader.read(min(4 * 1024 * 1024, remaining))
            assert block
            dst.fp.write(block)
            remaining -= len(block)
        dst.filelist.append(cloned)
        dst.NameToInfo[info.filename] = cloned
        dst.start_dir = dst.fp.tell()
        dst._didModify = True

def rebuild(old, source, output):
    with open(old,'rb') as br, zipfile.ZipFile(br) as bz, open(source,'rb') as sr, zipfile.ZipFile(sr) as sz, zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as target:
        runtime = {i.filename for i in bz.infolist() if i.filename.startswith('NoteMender/runtime/')}
        core = set(sz.namelist())
        allow = {'NoteMender/' + f for f in json.loads(sz.read('NoteMender/scripts/public-files.json'))}
        assert len(core) == len(sz.namelist()) == 356 and core == allow
        assert not any(n.startswith('NoteMender/runtime/') for n in core)
        transfer(bz, br, target, runtime)
        transfer(sz, sr, target, core)

def api(method, path, body=None):
    headers = {'Authorization': 'Bearer '+TOKEN, 'User-Agent': 'NoteMender-release-refresh', 'Accept': 'application/vnd.github+json'}
    payload = json.dumps(body).encode() if body is not None else None
    if payload: headers['Content-Type'] = 'application/json'
    request = urllib.request.Request('https://api.github.com/repos/goldotto/NoteMender'+path, data=payload, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        content = response.read()
        return json.loads(content) if content else None

if __name__ == '__main__':
    urllib.request.urlretrieve(RELEASE+BASE, 'base-old.zip')
    urllib.request.urlretrieve(RELEASE+SOURCE, 'source-current.zip')
    verify('base-old.zip', '5637fb57a2fa4469b62b627f261da5110d5b5cd09dccbd08c6303f732ab666e8')
    verify('source-current.zip', '05aa09b07a1aa599ae2be99dac0ed8fb3ab2c94b2b0d24fd63951190d07f6481')
    rebuild('base-old.zip', 'source-current.zip', 'base-new.zip')
    verify('base-new.zip', EXPECTED)
    with zipfile.ZipFile('base-new.zip') as archive:
        assert archive.testzip() is None
    print('Rebuilt archive exactly matches reviewed local SHA-256.', flush=True)
    assets = api('GET','/releases/404696348/assets?per_page=100')
    staging = 'update-'+BASE
    for asset in assets:
        if asset['name'] == staging:
            assert asset['state'] == 'starter' and asset.get('digest') is None
            api('DELETE','/releases/assets/'+str(asset['id']))
    size = os.path.getsize('base-new.zip')
    connection = http.client.HTTPSConnection('uploads.github.com', timeout=300)
    connection.putrequest('POST','/repos/goldotto/NoteMender/releases/404696348/assets?name='+staging)
    for key, value in {'Authorization':'Bearer '+TOKEN,'User-Agent':'NoteMender-release-refresh','Content-Type':'application/octet-stream','Content-Length':str(size)}.items():
        connection.putheader(key,value)
    connection.endheaders()
    with open('base-new.zip','rb') as stream:
        while chunk := stream.read(1024*1024): connection.send(chunk)
    response = connection.getresponse()
    assert response.status == 201, 'Asset upload failed'
    result = json.loads(response.read())
    assert result['state'] == 'uploaded' and result['size'] == 808946713 and result['digest'] == 'sha256:'+EXPECTED
    connection.close()
    print('Verified staged release asset uploaded; original asset remains available.', flush=True)
