param([switch]$GPU)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $projectRoot 'runtime\node\node.exe'
if (Test-Path -LiteralPath $bundledNode) { $nodeExecutable = $bundledNode } else { $nodeExecutable = (Get-Command node -ErrorAction Stop).Source }
$scriptPath = Join-Path $PSScriptRoot 'install-acceleration.mjs'
if ($GPU) { & $nodeExecutable $scriptPath --gpu } else { & $nodeExecutable $scriptPath }
if ($LASTEXITCODE -ne 0) { throw '加速组件安装未完成，请查看上方错误。' }
