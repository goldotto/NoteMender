$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $studioRoot 'runtime\node\node.exe'
if (Test-Path -LiteralPath $bundledNode) { $studioNode = $bundledNode } else { $studioNode = (Get-Command node -ErrorAction Stop).Source }
& $studioNode (Join-Path $PSScriptRoot 'install-lyrics.mjs')
if ($LASTEXITCODE -ne 0) { throw '歌词组件安装未完成，请保留已有下载后重新运行。' }
