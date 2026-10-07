import {DOWNLOAD_SOURCES} from '../public/component-catalog.mjs';
export function sources(kind,region=process.env.NOTEMENDER_DOWNLOAD_REGION||'auto'){
  const values=DOWNLOAD_SOURCES[kind];if(!values)throw Error('未知下载类型');
  return region==='global'?[values.at(-1),...values.slice(0,-1)]:[...values];
}
