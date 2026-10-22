import {validateProject} from './music.mjs';
// One limit for files saved by this app and files opened again later.
export const PROJECT_FILE_LIMIT=32*1024*1024;
export function assertProjectSize(size){if(!Number.isFinite(size)||size<0||size>PROJECT_FILE_LIMIT)throw Error('工程不能超过 32 MB；导入与保存使用同一上限。');}
export function parseProjectText(text){
  assertProjectSize(new TextEncoder().encode(text).byteLength);
  let value;try{value=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('工程 JSON 格式无效，请打开保存的工程 JSON 文件。');}
  if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.notes))throw Error('文件不是听谱工程：缺少音符列表。');
  return validateProject(value);
}
export async function readProjectFile(file){assertProjectSize(file.size);return parseProjectText(await file.text());}
export function projectText(project){const text=JSON.stringify(project,null,2);assertProjectSize(new TextEncoder().encode(text).byteLength);return text;}
