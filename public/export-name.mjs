const formats = /\.(json|mid|svg|wav)$/i;
const forbidden = /[<>:"/\\|?*\x00-\x1f\x7f]/;
const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
export function exportStem(value){
  let stem=String(value??'').trim().replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/^\.+/,'').replace(/[. ]+$/,'');
  stem=Array.from(stem).slice(0,100).join('').replace(/[. ]+$/,'')||'未命名工程';
  if(reserved.test(stem))stem='_'+stem;
  return stem;
}
export function exportName(value,extension='json'){
  extension=String(extension).toLowerCase();
  if(!['json','mid','svg','wav'].includes(extension))throw Error('不支持的导出格式');
  const stem=String(value??'').replace(new RegExp('\\.'+extension+'$','i'),'');
  return exportStem(stem)+'.'+extension;
}
export function isExportFilename(value){
  return typeof value==='string'&&value.length<=240&&formats.test(value)&&!forbidden.test(value)&&!reserved.test(value)&&!/[. ]$/.test(value)&&!value.startsWith('.');
}
export function isExportPath(value){
  if(typeof value!=='string'||!value.startsWith('/exports/'))return false;
  try{return isExportFilename(decodeURIComponent(value.slice('/exports/'.length)));}catch{return false;}
}
export function collisionName(name,index){
  if(index===1)return name;
  const suffix=formats.exec(name)?.[0];
  if(!suffix)throw Error('不支持的导出格式');
  return name.slice(0,-suffix.length)+` (${index})`+suffix;
}
export function importedProjectStem(name){
  return exportStem(String(name??'').replace(/^\d{13}-[a-f0-9]{8}-/i,'').replace(/\.json$/i,''));
}
