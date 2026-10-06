param([switch]$Singing,[string]$CheckpointZip)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskNode=Join-Path $taskRoot 'runtime\node\node.exe'
if(!(Test-Path -LiteralPath $taskNode)){$taskNode=(Get-Command node -ErrorAction Stop).Source}
$taskArgs=@((Join-Path $PSScriptRoot 'install-candidates.mjs'),'--six')
if($Singing){$taskArgs+='--singing'}
if($CheckpointZip){$taskArgs+=('--checkpoints='+$CheckpointZip)}
& $taskNode @taskArgs
if($LASTEXITCODE -ne 0){throw '候选组件未完成安装。可重新运行，已有模型会复用。'}
