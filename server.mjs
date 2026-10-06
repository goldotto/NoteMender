import {exportName,isExportFilename,collisionName} from './public/export-name.mjs';
import {PROJECT_FILE_LIMIT} from './public/project-file.mjs';
import {lyricsService} from './src/lyrics-service.mjs';
import http from 'node:http';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {listPlugins,invokePlugin} from './src/plugin-host.mjs';
import {separationService} from './src/separation.mjs';
import {decodeLocal} from './src/decode.mjs';
import {analysisService} from './src/analysis-service.mjs';
import {audioResourceService} from './src/audio-resources.mjs';
import {singingService} from './src/singing-service.mjs';
import {computeService} from './src/compute-service.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const INSTANCE=createHash('sha256').update(path.resolve(ROOT).toLowerCase()).digest('hex').slice(0,16);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.bin':'application/octet-stream','.wasm':'application/wasm','.wav':'audio/wav','.svg':'image/svg+xml'};
export function createApp({fetchImpl=fetch,pluginDirectory=path.join(ROOT,'plugins'),analysisRoot=ROOT,exportDirectory=path.join(ROOT,'exports')}={}) {
  let decoding=false;const token=randomBytes(24).toString('hex'),compute=computeService(analysisRoot,{canStart:()=>!separation.busy()&&!singing.busy()&&!lyrics.busy()&&!analysis.busy()}),separation=separationService(ROOT,{beforeStart:async()=>{if(compute.busy()||compute.runner.pending||singing.busy()||lyrics.busy()||analysis.busy())throw Error('请等待当前片段分析完成');await compute.close();}}),analysis=analysisService(analysisRoot,{nativeRunner:compute.runner,canStart:()=>!compute.busy()&&!separation.busy()&&!singing.busy()&&!lyrics.busy()}),resources=audioResourceService(analysisRoot),singing=singingService(analysisRoot,{beforeStart:async()=>{if(compute.busy()||compute.runner.pending||separation.busy()||lyrics.busy()||analysis.busy())throw Error('已有分析任务运行中');await compute.close();}});
  const lyrics=lyricsService(analysisRoot,{canStart:()=>!compute.busy()&&!compute.runner.pending&&!separation.busy()&&!singing.busy()&&!analysis.busy(),beforeStart:()=>compute.close()});
  const app=http.createServer(async(req,res)=>{
    const send=(status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
    try {
      const host=req.headers.host||'';
      if(!/^127\.0\.0\.1:\d+$/.test(host)&&!/^localhost:\d+$/.test(host))return send(403,{error:'仅允许本机访问'});
      const url=new URL(req.url,`http://${host}`),origin=req.headers.origin;
      if(origin&&origin!==`http://${host}`)return send(403,{error:'不允许跨站请求'});
      if(await lyrics(req,res,url,send,token))return;
      if(await resources(req,res,url,send,token))return;
      if(await singing(req,res,url,send,token))return;
      if(await separation(req,res,url,send,token))return;
      if(await compute(req,res,url,send,token))return;
      if(await analysis(req,res,url,send,token))return;
      if(['/api/decode','/api/tempo'].includes(url.pathname)&&req.method==='POST'){
        if(req.headers['x-studio-token']!==token)return send(403,{error:'会话已过期，请刷新'});
        if(decoding)return send(429,{error:'正在解码另一份音频，请稍候'});
        decoding=true;const controller=new AbortController();const onClose=()=>{if(!res.writableEnded)controller.abort();};res.on('close',onClose);
        try{let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>120*1024*1024)return send(413,{error:'音频不能超过 120 MB'});chunks.push(c);}if(!size)return send(400,{error:'音频为空'});const mode=url.pathname==='/api/tempo'?'tempo':'decode';return send(200,await decodeLocal(ROOT,Buffer.concat(chunks),controller.signal,mode),mode==='tempo'?'application/json; charset=utf-8':'audio/wav');}
        catch(e){return send(400,{error:e.message});}finally{decoding=false;res.off('close',onClose);}
      }
      if(url.pathname==='/api/status'&&req.method==='GET')return send(200,{token,version:'2.5.0-demo.6',instance:INSTANCE});
      if(url.pathname==='/api/plugins'&&req.method==='GET')return send(200,{plugins:await listPlugins(pluginDirectory)});
      if(url.pathname==='/api/export-file'&&req.method==='POST'){
        if(req.headers['x-studio-token']!==token)return send(403,{error:'会话已过期，请刷新'});
        const originalName=url.searchParams.get('name')||'export.json',extension=path.extname(originalName).toLowerCase();
        if(!['.json','.mid','.svg','.wav'].includes(extension))return send(400,{error:'不支持的导出格式'});
        let size=0,chunks=[];const limit=extension==='.wav'?64*1024*1024:extension==='.json'?PROJECT_FILE_LIMIT:8*1024*1024;
        for await(const chunk of req){size+=chunk.length;if(size>limit)return send(413,{error:extension==='.json'?'工程不能超过 32 MB；导入与保存使用同一上限。':'导出文件过大，请缩短乐谱'});chunks.push(chunk);}
        if(!size)return send(400,{error:'导出内容为空'});
        const baseName=exportName(originalName,extension.slice(1)),data=Buffer.concat(chunks);
        await mkdir(exportDirectory,{recursive:true});
        let name;
        // Exclusive creation also protects simultaneous saves from overwriting a version.
        for(let index=1;index<=9999;index++){
          const candidate=collisionName(baseName,index);
          try{await writeFile(path.join(exportDirectory,candidate),data,{flag:'wx'});name=candidate;break;}
          catch(error){if(error.code!=='EEXIST')throw error;}
        }
        if(!name)return send(409,{error:'同名版本过多，请换一个保存名称'});
        return send(200,{url:'/exports/'+encodeURIComponent(name),filename:name});
      }
      if(url.pathname.startsWith('/exports/')&&req.method==='GET'){
        const name=decodeURIComponent(url.pathname.slice('/exports/'.length));
        if(!isExportFilename(name))return send(404,{error:'导出文件不存在'});
        const data=await readFile(path.join(exportDirectory,name));res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));return send(200,data,'application/octet-stream');
      }
      if(url.pathname.startsWith('/api/')) {
        if(req.method!=='POST')return send(405,{error:'方法不支持'});
        if(req.headers['x-studio-token']!==token)return send(403,{error:'会话已过期，请刷新页面'});
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'需要 JSON 请求'});
        let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>6*1024*1024)return send(413,{error:'片段过大，请缩短到 30 秒以内'});chunks.push(c);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return send(400,{error:'无效 JSON'});}
        const pluginMatch=/^\/api\/plugins\/([a-z][a-z0-9-]{0,47})\/invoke$/.exec(url.pathname);
        if(pluginMatch){
          const controller=new AbortController(),onClose=()=>{if(!res.writableEnded)controller.abort();};res.on('close',onClose);
          try{return send(200,await invokePlugin(pluginDirectory,pluginMatch[1],body,{fetchImpl,signal:controller.signal}));}
          catch(e){return send(e.code==='ENOENT'?404:502,{error:e.code==='ENOENT'?'插件未安装':e.message});}
          finally{res.off('close',onClose);}
        }
        return send(404,{error:'接口不存在'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'方法不支持'});
      const pathname=decodeURIComponent(url.pathname),base=path.join(ROOT,'public'),filename=path.resolve(base,'.'+(pathname==='/'?'/index.html':pathname));
      if(!filename.startsWith(base+path.sep))return send(403,{error:'路径不允许'});
      if(!(await stat(filename)).isFile())return send(404,{error:'文件不存在'});
      const content=await readFile(filename);send(200,req.method==='HEAD'?'':content,MIME[path.extname(filename)]||'application/octet-stream');
    }catch(e){if(!res.headersSent)send(e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'文件不存在':'请求无法处理'});else res.end();}
  });
  app.stopAnalysis=()=>{compute.close();separation.close();singing.close();lyrics.close();};app.once('close',()=>app.stopAnalysis());return app;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4317),app=createApp();
  const openBrowser=()=>{if(process.argv.includes('--open')&&process.platform==='win32')spawn('powershell.exe',['-NoProfile','-Command',`Start-Process 'http://127.0.0.1:${port}'`],{windowsHide:true,stdio:'ignore'});};
  const shutdown=()=>{app.stopAnalysis();app.closeAllConnections();app.close(()=>process.exit(0));};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);process.once('exit',()=>app.stopAnalysis());
  app.listen(port,'127.0.0.1',()=>{console.log(`听谱 NoteMender → http://127.0.0.1:${port}\n关闭此窗口可停止服务。`);openBrowser();});
  app.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已占用。若已启动，直接打开 http://127.0.0.1:${port}；否则设置 PORT 换端口。`:e.message);if(e.code==='EADDRINUSE')openBrowser();process.exitCode=1;});
}

