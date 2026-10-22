import {verify,sign,createHash} from 'node:crypto';
import path from 'node:path';
import {lstat,realpath,readFile} from 'node:fs/promises';
export const MAX_PACKAGE=256*1024*1024,MAX_EXPANDED=1024*1024*1024;
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export function signedEnvelope(value,privateKey,keyId){const payload=Buffer.from(JSON.stringify(value)).toString('base64');return {payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64'),keyId};}
export function verifyEnvelope(envelope,trust){
  if(!envelope||envelope.keyId!==trust.keyId||typeof envelope.payload!=='string'||envelope.payload.length>3*1024*1024||typeof envelope.signature!=='string'||!verify(null,Buffer.from(envelope.payload),trust.publicKey,Buffer.from(envelope.signature,'base64')))throw Error('更新清单签名无效，已停止更新');
  return validateManifest(JSON.parse(Buffer.from(envelope.payload,'base64').toString('utf8')));
}
export function programPath(name){
  if(typeof name!=='string'||name.length>240||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$|[\x00-\x1f<>"|?*]/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw Error('更新包含不安全路径');
  const top=name.split('/')[0];
  if(['runtime','exports','plugins','node_modules','.git'].includes(top.toLowerCase())||name.split('/').some(p=>p.startsWith('.env')))throw Error('更新不得修改个人数据或运行环境');
  if(name.includes('/')&&!['public','src','scripts','licenses','docs','examples','tests','third_party','.github'].includes(top))throw Error('更新目录不在程序白名单内');
  if(!name.includes('/')&&!/^(?:[\w.-]+\.(?:mjs|json|md|txt|cmd|ps1)|LICENSE|NOTICE|说明书\.txt|\.gitignore|\.gitattributes)$/.test(name))throw Error('更新文件不在程序白名单内');
  return name;
}
const DOMESTIC_HOSTS=new Set(['cnb.cool','asset.cnb.cool','gitee.com','foruda.gitee.com','raw.giteeusercontent.com']);
const GITHUB_HOSTS=new Set(['github.com','raw.githubusercontent.com','objects.githubusercontent.com','release-assets.githubusercontent.com','api.github.com']);
export function allowedDownload(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||u.hash||!DOMESTIC_HOSTS.has(u.hostname)&&!GITHUB_HOSTS.has(u.hostname))throw Error('更新下载地址不受信任');return u.href;}
export function downloadSource(raw){return DOMESTIC_HOSTS.has(new URL(allowedDownload(raw)).hostname)?'domestic':'github';}
export function validateManifest(m){
  if(m?.format!=='notemender-update-v1'||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version)||!Number.isSafeInteger(m.build)||m.build<1||m.platform!=='win32-x64'||!Number.isInteger(m.minNode)||m.minNode<22||!['stable','preview'].includes(m.channel)||!Number.isFinite(Date.parse(m.releasedAt))||!Array.isArray(m.files)||!m.files.length||m.files.length>12000||typeof m.notes!=='string'||m.notes.length>100000)throw Error('更新清单格式不正确');
  if(!m.package||!Number.isSafeInteger(m.package.size)||m.package.size<=0||m.package.size>MAX_PACKAGE||!/^[a-f0-9]{64}$/.test(m.package.sha256))throw Error('更新包信息不正确');allowedDownload(m.package.url);
  if(m.package.mirrors!==undefined){if(!Array.isArray(m.package.mirrors)||m.package.mirrors.length>4||!m.package.mirrors.length)throw Error('更新镜像清单无效');const ids=new Set();for(const mirror of m.package.mirrors){if(!['domestic','github'].includes(mirror.id)||ids.has(mirror.id))throw Error('更新镜像重复或无效');ids.add(mirror.id);allowedDownload(mirror.url);if(downloadSource(mirror.url)!==mirror.id)throw Error('更新来源名称与域名不符');}}
  let total=0;const names=new Set();for(const f of m.files){programPath(f.path);const key=f.path.toLowerCase();if(names.has(key)||!Number.isSafeInteger(f.size)||f.size<0||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('更新文件清单无效或重复');names.add(key);total+=f.size;}
  if(total>MAX_EXPANDED)throw Error('更新解压大小超出限制');
  if(!Array.isArray(m.remove)||m.remove.length>12000)throw Error('更新移除清单无效');for(const name of m.remove){programPath(name);if(names.has(name.toLowerCase()))throw Error('更新包含冲突文件');names.add(name.toLowerCase());}
  if(!m.files.some(f=>f.path==='server.mjs')||!m.files.some(f=>f.path==='public/build-info.json'))throw Error('更新缺少程序入口或构建信息');return m;
}
export function compareBuild(a,b){
  const parse=v=>{const [core,...suffix]=v.split('-');return {n:core.split('.').map(Number),s:suffix.join('-')};},x=parse(a.version),y=parse(b.version);
  for(let i=0;i<3;i++)if(x.n[i]!==y.n[i])return Math.sign(x.n[i]-y.n[i]);
  if(x.s!==y.s){if(!x.s)return 1;if(!y.s)return -1;const xs=x.s.split('.'),ys=y.s.split('.');for(let i=0;i<Math.max(xs.length,ys.length);i++){if(xs[i]===ys[i])continue;if(xs[i]===undefined)return -1;if(ys[i]===undefined)return 1;const xn=/^\d+$/.test(xs[i]),yn=/^\d+$/.test(ys[i]);if(xn!==yn)return xn?-1:1;return xn?Math.sign(Number(xs[i])-Number(ys[i])):(xs[i]<ys[i]?-1:1);}}
  return Math.sign((a.build||0)-(b.build||0));
}
export async function safeTarget(root,name){
  programPath(name);const base=await realpath(root),dest=path.resolve(base,...name.split('/'));let current=base;
  for(const part of name.split('/')){current=path.join(current,part);try{const s=await lstat(current);if(s.isSymbolicLink())throw Error('更新目标包含目录链接，不能覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(!dest.startsWith(base+path.sep))throw Error('更新路径越界');return dest;
}
export async function verifyInstalled(root,trust,current){
  if(current.distribution!=='portable')throw Error('源码开发目录不支持直接覆盖；请下载新版到独立目录');
  const envelope=JSON.parse(await readFile(path.join(root,'runtime/updates/installed.json'),'utf8')),m=verifyEnvelope(envelope,trust);
  if(m.build!==current.build||m.version!==current.version)throw Error('安装记录与当前构建不一致，请手动更新');
  for(const f of m.files){const file=await safeTarget(root,f.path);if(sha256(await readFile(file))!==f.sha256)throw Error('程序文件已修改或不完整，请另存新版或手动更新');}return m;
}
