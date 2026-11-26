import {getLanguage,onLanguageChange} from './i18n.mjs';
import {JA_TEXT} from './locales/ja-text.mjs';

// Only pass application-authored labels here. Never pass user content or logs.
export const PANEL_EN={
  '组件管理与安装':'Components and installation','进入工作台 →':'Open workspace →','关闭组件管理':'Close components',
  '基础版即可扒谱和改谱。四种乐器采样音色已内置；歌词、显卡等大型组件可按需添加。':'The Basic edition supports transcription and editing. Four sampled instruments are included; add large components such as lyrics recognition and GPU support as needed.',
  '先检查电脑上是否已有环境？':'Check for existing environments first?',
  '经你允许后，只检查常用 Python 环境和模型缓存。已有组件验证通过后可直接复用。':'With your permission, check common Python environments and model caches. Existing components can be reused after validation.',
  '允许扫描已有环境':'Allow environment scan','暂不扫描':'Skip scan','指定已有程序或环境目录':'Specify an existing application or environment folder',
  '已有 NoteMender、Python 或虚拟环境目录':'Existing NoteMender, Python or virtual environment folder','已有环境目录':'Existing environment folder','允许检查此目录':'Allow checking this folder','找到可复用组件':'Reusable components found','可安装组件':'Available components',
  'MuScriptor large · 权重授权':'MuScriptor large · Model license',
  '只下载 large（约 5.47 GB）；GPU 显存不足时回退 CPU，仍使用 large。':'Downloads large only (about 5.47 GB). Falls back to CPU if GPU memory is insufficient, using the same large model.',
  '先在 Hugging Face 接受 large 模型条款 ↗':'Accept the large model terms on Hugging Face first ↗',
  '。权重采用 CC BY-NC 4.0 和作者附加条款，仅限非商用；不属于本项目的 MIT 许可。':'. The weights use CC BY-NC 4.0 plus the author’s additional terms and are for non-commercial use only; they are not covered by this project’s MIT license.',
  '我已阅读并接受该权重的许可及附加使用条款':'I have read and accept the model license and additional terms',
  '已有权重文件（可选，优先复用）':'Existing weights file (optional; reused first)','model.safetensors 的完整本机路径':'Full local path to model.safetensors','Hugging Face 只读令牌（仅本次下载使用）':'Hugging Face read-only token (for this download only)','已有权重可留空；不要向开发者发送令牌':'Leave blank when importing weights; never send your token to the developer',
  '令牌仅交给本机下载进程，并发送给 Hugging Face 官方下载地址；不保存在配置、日志或工程中。下载完成后可在 Hugging Face 撤销令牌。无需令牌也可在网页手工下载权重，再填写上方文件路径。':'The token is used only by the local download process and official Hugging Face download endpoints. It is not stored in settings, logs or projects. You can revoke it on Hugging Face after downloading. Alternatively, download the weights in your browser and enter the local file path above.',
  '取消当前任务':'Cancel current task','查看安装详情':'Installation details','下载源':'Download source','下载源优先顺序':'Download source priority','自动（国内源优先，失败切换）':'Automatic (China sources first, with fallback)','中国大陆源优先':'Mainland China sources first','官方源优先':'Official sources first','重新检查组件':'Recheck components','安装所选组件':'Install selected components',
  '只安装到当前程序目录；不会替换系统 Python、Torch 或显卡驱动。复用的外部环境需继续保留。':'Installs only in the application folder. System Python, Torch and GPU drivers are not replaced. Keep any external environments being reused.',
  '请等待当前检查、安装或分析完成':'Wait for the current check, installation or analysis to finish','请勾选需要安装的组件':'Select components to install','安装所选组件；未主动允许扫描时只使用程序内环境，不扫描电脑':'Install selected components. Only the application environment is used unless you explicitly allow scanning.',
  '本机服务未连接':'Local service is unavailable','组件请求失败':'Component request failed','待检查':'Not checked','随显卡组件可用':'Included with GPU component','正在复用':'Reusing','已安装':'Installed','未安装':'Not installed','已包含在显卡组件中，无需单独下载。识别路径仍需通过一致性检查。':'Included in the GPU component; no separate download is needed. Recognition paths must still pass consistency checks.',
  '解除复用':'Stop reusing','检查组件中…':'Checking components…','组件任务进行中…':'Component task in progress…','等待当前任务…':'Waiting for current task…','校验并复用':'Validate and reuse','未能检查；可重试或指定已有环境目录':'Could not check. Retry or specify an existing environment folder.','已允许此次扫描':'This scan was allowed','请先填写已有环境的完整目录':'Enter the full path to the existing environment first','未扫描，使用程序内环境':'Scan skipped; using the application environment','请先接受 MuScriptor large 模型条款':'Accept the MuScriptor large model terms first',
  ' 需要安装：打开“组件管理”下载或复用。':' Installation required: open Components to download or reuse it.',' 需要安装显卡组件。':' GPU component required.','此识别方案所需的本机音高组件尚未就绪，请查看组件管理。':'The local pitch component required by this recognition method is not ready. Open Components.',
  '编辑核心（内置）':'Editor core (built in)','人工编辑、试听、MIDI 导入与谱子导出，不包含分析模型。':'Manual editing, playback, MIDI import and score export. Does not include analysis models.','随程序提供':'Included','基础扒谱模型':'Basic transcription model','Basic Pitch 浏览器推理模型；基础版内置，精简版可添加。':'Basic Pitch browser inference model. Included in Basic; optional in Lite.','Python 基础解释器':'Python interpreter','仅分析组件需要；隔离在程序目录，不修改系统 Python。':'Required only for analysis components. Isolated in the application folder; system Python is unchanged.',
  'CPU 音频环境':'CPU audio environment','Torch CPU、音频解码和音高分析依赖。仅复用实际检查通过的环境。':'CPU Torch, audio decoding and pitch analysis dependencies. Only validated environments are reused.','人声与器乐分轨':'Vocal and instrument separation','Demucs 四轨分离；支持人声、贝斯、鼓和其他器乐。基础离线版包含。':'Demucs four-stem separation: vocals, bass, drums and other instruments. Included in Basic offline.','吉他／钢琴分轨':'Guitar / piano separation','Demucs 六轨模型，增加吉他与钢琴的独立候选。基础离线版包含。':'Demucs six-stem model adds separate guitar and piano candidates. Included in Basic offline.',
  '歌词识别与时间对齐':'Lyrics recognition and alignment','Qwen3-ASR 0.6B 与 ForcedAligner。自动转写及对齐歌词；不安装也能手工输入歌词。':'Qwen3-ASR 0.6B and ForcedAligner transcribe and align lyrics automatically. Manual lyrics entry remains available without this component.',
  'NVIDIA 显卡加速':'NVIDIA GPU acceleration','CUDA 12.8 的 PyTorch 与 ONNX Runtime。用于合格的分轨与音高路径；安装不代表所有模型都已通过一致性验证。需要兼容的 NVIDIA 显卡和驱动。':'CUDA 12.8 PyTorch and ONNX Runtime for qualified separation and pitch paths. Installation does not mean all models have passed consistency checks. Requires a compatible NVIDIA GPU and driver.',
  '原生 CPU 推理组件':'Native CPU inference','ONNX Runtime 多线程后端；未通过一致性检查的 Basic Pitch 路径仍使用当前后端。':'Multithreaded ONNX Runtime backend. Basic Pitch paths that fail consistency checks keep using their current backend.','演唱精细分音（实验）':'Detailed vocal notes (experimental)','ROSVOT 额外人声候选，适合比较演唱分音；需要显卡组件与额外检查点。':'Additional ROSVOT vocal candidates for comparing note segmentation. Requires the GPU component and extra checkpoints.',
  'MuScriptor large 多乐器转谱（实验）':'MuScriptor large multi-instrument transcription (experimental)','large 约 13 亿参数；按乐器家族生成多音 MIDI 与单旋律候选。不做歌词识别或音轨分离。权重仅限非商用，须先接受 Hugging Face 条款。优先复用已有 PyTorch。':'The large model has about 1.3 billion parameters and produces polyphonic MIDI and melody candidates by instrument family. It does not recognize lyrics or separate stems. Weights are non-commercial and require acceptance of Hugging Face terms. Existing PyTorch is reused first.',
  '约 0.9 MB':'About 0.9 MB','约 16 MB':'About 16 MB','约 0.6 GB（缺失时）':'About 0.6 GB if missing','约 84 MB（环境另计）':'About 84 MB, excluding environment','约 55 MB（缺失时）':'About 55 MB if missing','约 3.9 GB':'About 3.9 GB','约 3 GB':'About 3 GB','约 20 MB':'About 20 MB','约 1 GB，依检查点而定':'About 1 GB; depends on checkpoint','large 权重约 5.47 GB，另有小型推理依赖':'Large weights: about 5.47 GB, plus small inference dependencies',
  '浏览器不支持安全的多标签页更新，请使用新版 Chrome 或 Edge':'Your browser does not support safe multi-tab updates. Use a recent Chrome or Edge.',
  '版本与更新':'Version and updates','关闭版本与更新':'Close updates','启动及每6小时检查更新':'Check at startup and every 6 hours','只检查版本；下载和安装均由你确认。更新保留模型、组件和个人资料。':'Checks only. Download and installation require your confirmation. Models, components and personal files are kept.',
  '更新源':'Update source','自动':'Automatic','国内源':'China source','GitHub':'GitHub','检查更新':'Check for updates','下载更新':'Download update','取消下载':'Cancel download','安装并重启':'Install and restart','手动下载 ↗':'Manual download ↗','更新来源':'Update sources',
  '当前发行渠道见上方索引。所有来源均校验签名和 SHA-256；缺少安装凭据的旧版需要先手动迁移。':'See the indexes above for this release. All sources are checked against the signature and SHA-256. Older packages without installation credentials require manual migration.',
  '版本说明':'Release notes','本机版本':'Installed version','可用版本 / 上次获取的说明':'Available version / last retrieved notes','本机更新记录':'Local update history','正在保存工作并准备更新':'Saving work and preparing update','此页面暂时停止编辑；完成后将恢复到原位置。':'Editing is paused temporarily. Your position will be restored afterward.','取消准备并返回编辑':'Cancel preparation and resume editing','更新请求失败':'Update request failed','查看更新说明':'View release notes','关闭':'Close','未核实':'Unverified','源码开发目录':'Source development folder','便携分发版':'Portable distribution','国内索引：':'China index: ','尚未配置，未上线':'Not configured or published','；GitHub 索引：':'; GitHub index: ','；最近成功来源：':'; Last successful source: ',
  '尚未检查更新':'Not checked yet','正在检查更新…':'Checking for updates…','检查成功，当前已是最新版本':'Check successful; you are up to date','发现可用更新':'Update available','检查更新失败':'Update check failed','自动更新尚未开放':'Automatic updates are not available yet',' · 最近成功检查 ':' · Last successful check ',
  '源码开发目录受到保护，请另存新版或手动更新':'Source folders are protected. Save a separate new version or update manually.','保存所有打开页面后安装并重启':'Save all open pages, then install and restart','（缓存信息）':' (cached)','尚未取得可信的更新信息':'No verified update information yet','暂无':'None','成功':'Success','已回退':'Rolled back','失败':'Failed','暂无更新记录':'No update history','版本与更新 · 有更新':'Version and updates · Available',
  '更新正在安装，页面会自动恢复；请勿关闭此标签页。':'Installing the update. This page will recover automatically; keep this tab open.','正在等待程序重新启动。若长时间未恢复，请重新运行启动程序；已保存的恢复副本仍保留。':'Waiting for the application to restart. If it does not recover, run the launcher again. Saved recovery copies are retained.',
  '保存所有打开页面的工作后安装更新并重启？未提交的连续写入等内容请先处理；程序目录会保留回退副本。':'Save all open pages, install the update and restart? Finish any uncommitted note sequences first. A rollback copy will be kept.',
  '更新准备已取消':'Update preparation was cancelled','其他页面保存失败：':'Another page could not save: ','有页面未完成保存；请关闭或处理其他标签页后重试':'Some pages have not finished saving. Close or resolve those tabs and retry.','工作恢复失败，程序将保留恢复副本并等待回退。请勿继续编辑。':'Work could not be restored. The recovery copy is retained while waiting for rollback. Do not continue editing.',
  '问题反馈与运行日志':'Feedback and diagnostic logs','关闭问题反馈':'Close feedback','自动记录操作阶段、耗时和错误，仅保存在本机。不会自动发送，也不会读取歌曲、工程正文或歌词内容。':'Records operation stages, timing and errors locally. Nothing is sent automatically; song audio, project contents and lyrics are not read.',
  '遇到了什么问题？':'What went wrong?','例如：安装原生 CPU 组件失败':'Example: native CPU component installation failed','怎样重现？':'How can it be reproduced?','按顺序描述点击了哪些功能':'Describe the actions in order','希望得到什么结果？':'What did you expect?',
  '报告包含经过处理的诊断日志（可取消）':'Include sanitized diagnostic logs (optional)','生成 / 更新报告预览':'Generate / update report preview','下载反馈报告 TXT':'Download report TXT','刷新日志':'Refresh logs','清空运行日志':'Clear diagnostic logs','打开邮件发送':'Open email application','复制完整报告':'Copy full report','复制邮箱':'Copy email address','收件人：goldotto@proton.me':'To: goldotto@proton.me',
  '由你在邮件软件中确认发送。完整报告请复制到正文或下载 TXT 后附加；没有邮件软件时可使用网页邮箱。':'You confirm sending in your email application. Paste the full report into the message or attach the downloaded TXT. Webmail also works.',
  '最近运行记录':'Recent diagnostic logs','即将导出的内容（可直接修改）':'Report preview (editable)','个人路径与常见凭据已过滤。请检查错误文字及自己填写的内容，删除不想分享的信息后再下载。':'Personal paths and common credentials are filtered. Review the error messages and your own text, and remove anything you do not wish to share.',
  '反馈报告预览':'Feedback report preview','日志请求失败':'Log request failed','未知错误':'Unknown error','正在读取…':'Loading…','本机服务未连接；仍可填写反馈并导出本页浏览器记录。':'Local service unavailable. You can still write feedback and export this page’s browser logs.','当前没有运行记录':'No diagnostic logs yet',
  '报告已生成。检查并修改下面的预览后，可打开邮件发送或复制、下载报告。':'Report generated. Review and edit the preview below, then open your email application, copy the report or download it.',
  '已请求打开邮件软件，尚未确认发送；如无反应，请复制报告并发送到 ':'Requested your email application to open; the message has not been confirmed as sent. If nothing happens, copy the report and send it to ',
  '完整报告已复制；请在自己的邮件中粘贴并发送。':'Full report copied. Paste it into your email and send it.','反馈邮箱已复制。':'Feedback email address copied.','日志选项已改变，请重新生成报告预览。':'Log inclusion changed. Generate a new report preview.',
  '清空本机运行日志？已下载的报告仍会保留，歌曲和工程不会受到影响。':'Clear local diagnostic logs? Downloaded reports are kept. Songs and projects are unaffected.',
  '服务未连接，版本未核实':'Service unavailable; version unverified','浏览器临时记录':'Temporary browser logs','无法读取服务器日志；此报告仅含当前页面记录。':'Server logs unavailable; this report contains only records from the current page.',
  'NoteMender 问题反馈报告':'NoteMender feedback report','报告编号：':'Report ID: ','生成时间：':'Created: ','程序版本：':'Version: ','构建编号：':'Build: ','本次服务编号：':'Service session: ','系统：':'System: ','浏览器：':'Browser: ','窗口：':'Window: ','未提供':'Not provided','未填写':'Not supplied',
  '注意：日志文件写入失败；以下保留本次内存记录。':'Note: log file writes failed; the following in-memory records are retained.','日志保存在本机，无自动上传。':'Logs are local and are not uploaded automatically.','【问题描述】':'[Problem]','【复现步骤】':'[Steps to reproduce]','【预期结果】':'[Expected result]','【最近更新记录】':'[Recent update history]','【最近运行记录】':'[Recent diagnostic logs]',
  '报告不含音频、工程文件及设置文件。发送前请检查预览；截图或复现工程由你自行决定是否另附。':'The report excludes audio, project files and settings files. Review it before sending. You decide whether to attach screenshots or a reproduction project.',
  ' 操作=':' operation=',' 组件=':' component=',' 状态=':' state=',' 后端=':' backend=',' 耗时=':' elapsed=',' 行=':' line=',' 列=':' column=',
};

export function panelText(text){
  const current=getLanguage();
  if(current==='en')return PANEL_EN[text]??text;
  // Japanese is resolved from the shared Chinese-keyed table; English is the
  // fallback so a missing entry never drops the label back to Chinese.
  if(current==='ja')return JA_TEXT[text]??PANEL_EN[text]??text;
  return text;
}

// Bind only the original, trusted UI skeleton before inserting API/user values.
// Retaining nodes preserves event listeners, focus, passwords and unsaved form data.
export function bindPanelLanguage(root,dictionary=PANEL_EN){
  const bindings=[];
  // Register one translatable text node or attribute. English comes from the
  // caller's dictionary; Japanese comes from the shared Chinese-keyed table so
  // every panel (components, engraving, dialogs) uses one vocabulary.
  const add=(read,write)=>{
    const source=read(),core=source.trim(),translated=dictionary[core]??dictionary[source];
    if(translated===undefined)return;
    const english=dictionary[source]??source.replace(core,translated);
    const jaRaw=JA_TEXT[source]??JA_TEXT[core];
    const japanese=jaRaw===undefined?undefined:(JA_TEXT[source]??source.replace(core,jaRaw));
    let last=source;
    bindings.push(()=>{
      if(read()!==last)return;
      const current=getLanguage();
      const next=current==='en'?english:current==='ja'?(japanese??english):source;
      write(next);last=next;
    });
  };
  function visit(node){if(node.nodeType===3){add(()=>node.nodeValue,v=>{if(node.nodeValue!==v)node.nodeValue=v;});return;}if(node.nodeType!==1)return;for(const attr of ['title','placeholder','aria-label'])if(node.hasAttribute(attr))add(()=>node.getAttribute(attr),v=>node.setAttribute(attr,v));for(const child of node.childNodes)visit(child);}
  visit(root);const update=()=>bindings.forEach(fn=>fn());update();return onLanguageChange(update);
}
