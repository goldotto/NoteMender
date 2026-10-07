const KEY='jianpu-studio-backups';
export function listBackups(storage){return JSON.parse(storage.getItem(KEY)||'[]');}
export async function saveBackup(storage,project,write){
  const items=[...listBackups(storage),{at:new Date().toISOString(),project}].slice(-10);
  try{storage.setItem(KEY,JSON.stringify(items));return;}
  catch{}
  // Persist every retained inline snapshot before replacing the browser index.
  // A failed write leaves its old index intact and prevents the edit.
  const compact=[];
  for(const item of items){
    if(!item.project){compact.push(item);continue;}
    const url=await write(item.project,item.at);
    compact.push({at:item.at,title:item.project.title,notes:item.project.notes.length,url});
  }
  storage.setItem(KEY,JSON.stringify(compact));
}
export async function readBackup(item,read){
  if(!item)throw Error('备份已不可用');
  return item.project||await read(item.url);
}
