import {allowedDownload,downloadSource} from './update-security.mjs';
export function updateIndexes(config,preference='auto'){
  if(!['auto','domestic','github'].includes(preference))throw Error('请选择有效的更新来源');
  const sources=[];
  if(preference!=='github'&&config.domesticIndex){const url=allowedDownload(config.domesticIndex);if(!['cnb.cool','gitee.com','raw.giteeusercontent.com'].includes(new URL(url).hostname))throw Error('国内索引必须使用已核验的 CNB 或 Gitee 域名');sources.push({id:'domestic',url});}
  if(preference!=='domestic')sources.push({id:'github',url:allowedDownload(config.githubIndex)});
  if(!sources.length)throw Error('国内下载入口尚未配置；请先选择 GitHub 备用源');return sources;
}
export function packageSources(manifest,preference='auto'){
  const all=manifest.package.mirrors?.length?manifest.package.mirrors:[{id:downloadSource(manifest.package.url),url:manifest.package.url}];
  const selected=preference==='auto'?[...all].sort((a,b)=>(a.id==='domestic'?0:1)-(b.id==='domestic'?0:1)):all.filter(s=>s.id===preference);
  if(!selected.length)throw Error('此更新尚未提供所选来源，请选择自动或其他来源');
  return selected.map(s=>({...s,url:allowedDownload(s.url)}));
}
