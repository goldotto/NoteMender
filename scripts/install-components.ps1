param([ValidateSet('Menu','Base','Six','Lyrics','CPU','GPU','Singing')][string]$Component='Menu')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if($Component -eq 'Menu') {
 Write-Host 'NoteMender：下载功能组件'
 Write-Host '1 基础音频与四轨分离   2 六轨器乐候选   3 Qwen 歌词转写与对齐'
 Write-Host '4 CPU 原生加速   5 NVIDIA 显卡组件   6 ROSVOT 演唱候选   0 退出'
 $choice=Read-Host '输入编号'
 $choices=@{'1'='Base';'2'='Six';'3'='Lyrics';'4'='CPU';'5'='GPU';'6'='Singing'}
 if($choice -eq '0'){exit 0}
 if(!$choices.ContainsKey($choice)){throw '请选择 0–6。'}
 $Component=$choices[$choice]
}
if($Component -eq 'Base'){& (Join-Path $root 'setup-runtime.ps1');exit}
$portable=Join-Path $root 'runtime\portable-ready.json'
if(!(Test-Path -LiteralPath $portable)) { & (Join-Path $root 'setup-runtime.ps1') }
switch($Component){
 Six {& (Join-Path $PSScriptRoot '安装候选组件.ps1')}
 Lyrics {& (Join-Path $PSScriptRoot '安装歌词组件.ps1')}
 CPU {& (Join-Path $PSScriptRoot '安装加速组件.ps1')}
 GPU {& (Join-Path $PSScriptRoot '安装加速组件.ps1') -GPU}
 Singing {& (Join-Path $PSScriptRoot '安装候选组件.ps1') -Singing}
}
Write-Host '完成后双击 Start-NoteMender.cmd；已打开的页面请刷新。'
