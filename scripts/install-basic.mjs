import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensurePinnedFile} from './download-model.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const spec=JSON.parse(await readFile(path.join(root,'scripts/browser-model-manifest.json'),'utf8'));
for(const file of spec.files)await ensurePinnedFile({target:path.join(root,'runtime/models/browser-basic-pitch',file.file),spec:file,urls:file.urls,cwd:root});
console.log('基础扒谱模型已通过完整性检查');
