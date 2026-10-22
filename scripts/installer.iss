#ifndef Payload
  #error Payload must name the reviewed staging directory
#endif
#ifndef Edition
  #define Edition "lite"
#endif
#ifndef BuildNumber
  #error BuildNumber required
#endif
#ifndef Output
  #error Output required
#endif
#if Edition == "lite"
 #define EditionName "精简版"
#else
 #define EditionName "基础版"
#endif
[Setup]
AppId={{20E521C7-7601-42F3-BE43-B9DB56AF8DF2}
AppName=NoteMender
AppVersion=2.5.0-demo.7
AppVerName=NoteMender 2.5.0-demo.7 · {#EditionName} · 构建 {#BuildNumber}
AppPublisher=goldotto
AppPublisherURL=https://github.com/goldotto/NoteMender
DefaultDirName={localappdata}\Programs\NoteMender
DefaultGroupName=NoteMender
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
LicenseFile={#Payload}\LICENSE
OutputDir={#Output}
OutputBaseFilename=NoteMender-2.5.0-demo.7-build-{#BuildNumber}-{#Edition}-x64-Setup
Compression=lzma2/fast
SolidCompression=yes
LZMANumBlockThreads=2
DiskSpanning=no
CloseApplications=no
RestartApplications=no
UninstallDisplayName=NoteMender
UninstallFilesDir={app}\uninstall
SetupLogging=no
[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked
#if Edition == "lite"
Name: "basic"; Description: "基础扒谱模型（约 0.9 MB；无需 Python）"; GroupDescription: "安装后可选下载（默认不下载）："; Flags: unchecked
Name: "audio"; Description: "四／六轨分轨（约 0.75 GB；需要 Python 和 CPU 音频环境）"; Flags: unchecked
#endif
Name: "lyrics"; Description: "Qwen 歌词识别与对齐（约 3.9 GB；精简版另需 CPU 音频环境）"; GroupDescription: "安装后可选下载（默认不下载）："; Flags: unchecked
Name: "gpu"; Description: "NVIDIA 加速（下载约 3 GB，预留 12 GB；需兼容显卡和驱动）"; Flags: unchecked
Name: "singing"; Description: "ROSVOT（约 1 GB，另需 NVIDIA 组件；实验功能）"; Flags: unchecked
Name: "muscriptor"; Description: "MuScriptor large（约 5.47 GB；官方非商用授权或本机权重）"; Flags: unchecked
[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Excludes: "\runtime\*"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Payload}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs uninsneveruninstall; Excludes: "\updates\installed.json"
Source: "{#Payload}\runtime\updates\installed.json"; DestDir: "{app}\runtime\updates"; Flags: ignoreversion uninsneveruninstall
[Icons]
Name: "{group}\NoteMender"; Filename: "{app}\Start-NoteMender.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\NoteMender"; Filename: "{app}\Start-NoteMender.cmd"; WorkingDir: "{app}"; Tasks: desktopicon
[Run]
Filename: "{app}\runtime\node\node.exe"; Parameters: "scripts\installer-entry.mjs ""{code:SelectedComponents}"" {code:ScanArguments}"; WorkingDir: "{app}"; Description: "打开 NoteMender / 继续安装选装组件"; Flags: postinstall nowait skipifsilent runhidden
[Code]
var ScanPage: TInputOptionWizardPage; FolderPage: TInputDirWizardPage;
function SelectedComponents(Param: String): String;
begin
  Result := '';
#if Edition == "lite"
  if WizardIsTaskSelected('basic') then Result := Result + 'basic,';
  if WizardIsTaskSelected('audio') then Result := Result + 'audio,six,';
#endif
  if WizardIsTaskSelected('lyrics') then Result := Result + 'lyrics,';
  if WizardIsTaskSelected('gpu') then Result := Result + 'gpu,';
  if WizardIsTaskSelected('singing') then Result := Result + 'singing,';
  if WizardIsTaskSelected('muscriptor') then Result := Result + 'muscriptor,';
  if Length(Result)>0 then Delete(Result,Length(Result),1);
end;
function ScanArguments(Param: String): String;
begin
  Result := '';
  if ScanPage.Values[1] then Result := '--scan';
  if ScanPage.Values[2] then Result := '--folder="' + FolderPage.Values[0] + '"';
end;
procedure InitializeWizard;
begin
  ScanPage := CreateInputOptionPage(wpSelectTasks, '复用已有环境（可选）', '先征求你的同意，不自动扫描磁盘', '程序文件安装完成后，使用与组件管理相同的检查与下载界面。检测通过后仍由你确认复用；选装失败不影响已安装程序。', True, False);
  ScanPage.Add('不检查电脑，仅使用包内环境');
  ScanPage.Add('允许检查常用 Python 环境和模型缓存（不扫描所有磁盘）');
  ScanPage.Add('只检查我指定的已有程序或环境目录');
  ScanPage.SelectedValueIndex := 0;
  FolderPage := CreateInputDirPage(ScanPage.ID,'已有环境目录','只检查此目录','选择已有 NoteMender 或 Python 环境；不会修改其中的文件。',False,'');
  FolderPage.Add('目录：');
end;
function ShouldSkipPage(PageID: Integer): Boolean;
begin Result := (PageID=FolderPage.ID) and not ScanPage.Values[2]; end;
function OpenProcess(Access: LongWord; Inherit: Boolean; PID: LongWord): LongWord;
 external 'OpenProcess@kernel32.dll stdcall';
function GetExitCodeProcess(Handle: LongWord; var Code: LongWord): Boolean;
 external 'GetExitCodeProcess@kernel32.dll stdcall';
function CloseHandle(Handle: LongWord): Boolean;
 external 'CloseHandle@kernel32.dll stdcall';
function ServiceRunning(): Boolean;
var Text: AnsiString; Value: String; I, PID, Code, Handle: LongWord;
begin
 Result := False;
 if not LoadStringFromFile(ExpandConstant('{app}\runtime\updates\service.json'),Text) then exit;
 Value := String(Text); I := Pos('"pid":', Value);
 if I=0 then begin Result:=True; exit; end;
 Delete(Value,1,I+5); Value:=Trim(Value); I:=1;
 while (I<=Length(Value)) and (Value[I]>='0') and (Value[I]<='9') do I:=I+1;
 PID:=StrToIntDef(Copy(Value,1,I-1),0);
 if PID=0 then begin Result:=True; exit; end;
 Handle:=OpenProcess($1000,False,PID);
 if Handle<>0 then begin
  Result:=not GetExitCodeProcess(Handle,Code);
  if not Result then Result:=Code=259;
  CloseHandle(Handle);
 end;
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
 Result := '';
 if ServiceRunning() then Result := '请先保存工作并退出此目录的 NoteMender 服务。安装器不会强制结束任务。';
 if FileExists(ExpandConstant('{app}\server.mjs')) then Result := '目标目录已有 NoteMender。请使用程序内的签名更新，或选择新的空目录安装并迁移工程；安装器不会覆盖现有程序。';
end;
function InitializeUninstall(): Boolean;
begin
 Result := not ServiceRunning();
 if not Result then MsgBox('请先保存工作并关闭此目录的 NoteMender 服务，再卸载。',mbInformation,MB_OK);
end;
