export function redact(value){
  return String(value??'').slice(0,12000)
    .replace(/\x1b\[[0-9;]*m/g,'')
    .replace(/\bBearer\s+[A-Za-z0-9+/_.=\-]+|\bBasic\s+[A-Za-z0-9+/]{12,}={0,2}/gi,'[凭据已隐藏]')
    .replace(/((?:["']?)(?:[\w-]*(?:token|password|secret|cookie|api[_-]?key)[\w-]*)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,'$1[已隐藏]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[凭据已隐藏]')
    .replace(/(?:file:\/\/\/)?(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n"'<>|]*/g,'[本机路径已隐藏]')
    .replace(/\\\\[^\r\n"'<>|]+/g,'[网络路径已隐藏]')
    .replace(/https?:\/\/[^\s"'<>]+/gi,raw=>{try{const u=new URL(raw);return ['127.0.0.1','localhost'].includes(u.hostname)?'[本机服务]':'[下载源 '+u.hostname+']';}catch{return '[地址已隐藏]';}})
    .replace(/(?:\/Users\/|\/home\/|\/tmp\/)[^\r\n"'<>]*/g,'[本机路径已隐藏]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[邮箱已隐藏]')
    .replace(/[^\s"'<>|]*\.(?:mp3|wav|flac|m4a|ogg|mid|json)(?=[\s"'<>|,;）)]|$)/gi,'[资源文件名已隐藏]');
}
