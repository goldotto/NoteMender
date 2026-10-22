param(
 [Parameter(Mandatory=$true)][string]$SourceRoot,
 [Parameter(Mandatory=$true)][string]$NodeExe,
 [Parameter(Mandatory=$true)][string]$PythonExe,
 [Parameter(Mandatory=$true)][string]$Compiler,
 [Parameter(Mandatory=$true)][string]$RuntimeZip,
 [Parameter(Mandatory=$true)][string]$PrivateKey,
 [Parameter(Mandatory=$true)][long]$Build,
 [Parameter(Mandatory=$true)][string]$Output,
 [string]$PreviousManifest = '-',
 [string]$Mirrors
)
$ErrorActionPreference='Stop'
$outputPath=[IO.Path]::GetFullPath($Output)
if (-not $outputPath.StartsWith('D:\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay on D:' }
if (Test-Path -LiteralPath $outputPath) { throw 'Use a new output directory; existing work is never overwritten' }
New-Item -ItemType Directory -Path $outputPath | Out-Null
$buildTemp=Join-Path $outputPath '.build-temp'
New-Item -ItemType Directory -Path $buildTemp | Out-Null
$env:TEMP=$buildTemp;$env:TMP=$buildTemp
$env:PIP_CACHE_DIR=Join-Path $buildTemp 'pip-cache'
$env:npm_config_cache=Join-Path $buildTemp 'npm-cache'
Push-Location -LiteralPath $SourceRoot
try {
 $program=Join-Path $outputPath 'program'
 $packageArgs=@('scripts/package-update.mjs',$program,$PrivateKey,[string]$Build,$PreviousManifest)
 if ($Mirrors) { $packageArgs += $Mirrors }
 & $NodeExe @packageArgs
 if ($LASTEXITCODE -ne 0) { throw 'Signed program package failed' }
 $zip=Get-ChildItem -LiteralPath $program -Filter '*-windows-update.zip'
 if (@($zip).Count -ne 1) { throw 'Ambiguous app package' }
 $stage=Join-Path $outputPath 'payloads'
 & $PythonExe 'scripts/prepare-installer-payload.py' '--runtime-zip' $RuntimeZip '--out' $stage '--update' $zip.FullName '--receipt' (Join-Path $program 'installation-receipt.json')
 if ($LASTEXITCODE -ne 0) { throw 'Payload staging failed' }
 foreach ($edition in @('lite','base')) {
  & $Compiler ('/DPayload='+(Join-Path $stage $edition)) ('/DEdition='+$edition) ('/DBuildNumber='+$Build) ('/DOutput='+(Join-Path $outputPath 'installers')) 'scripts/installer.iss' *> (Join-Path $outputPath ($edition+'-compile.log'))
  if ($LASTEXITCODE -ne 0) { throw ('Installer compilation failed: '+$edition+'; see local compile log') }
 }
 # Explicit attachment set; do not glob-upload this build directory.
 $files=@($zip.FullName,(Join-Path $program 'NoteMender-update.json'))
 foreach ($edition in @('lite','base')) { $files+=Join-Path $outputPath ('installers\NoteMender-2.5.0-demo.7-build-'+$Build+'-'+$edition+'-x64-Setup.exe') }
 $lines=foreach($file in $files){$hash=Get-FileHash -LiteralPath $file -Algorithm SHA256; $hash.Hash.ToLowerInvariant()+'  '+[IO.Path]::GetFileName($file)}
 $lines | Set-Content -LiteralPath (Join-Path $outputPath 'SHA256SUMS.txt') -Encoding ASCII
 Write-Output ('Local artifacts ready; not published: '+$outputPath)
} finally { Pop-Location }
