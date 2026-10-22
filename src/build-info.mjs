import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export async function readBuild(root){
  const value=JSON.parse(await readFile(new URL('../public/build-info.json',import.meta.url),'utf8'));
  if(root){try{return {...value,...JSON.parse(await readFile(root+'/public/build-info.json','utf8'))};}catch{}}
  return value;
}
export const BUILD=Object.freeze(await readBuild());
