param([ValidateSet('offline','gpu')][string]$Edition='offline',[string]$Destination=$PSScriptRoot,[string]$Proxy='',[switch]$VerifyOnly)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$base='https://github.com/goldotto/NoteMender/releases/download/v2.5.0-demo.7/'
$manifestName=if($Edition -eq 'gpu'){'gpu-manifest.json'}else{'offline-manifest.json'}
$directory=[IO.Path]::GetFullPath($Destination)
function Get-SHA256([string]$File){
 $stream=[IO.File]::OpenRead($File);$hash=[Security.Cryptography.SHA256]::Create()
 try{return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
 finally{$hash.Dispose();$stream.Dispose()}
}
if(!(Test-Path -LiteralPath $directory)){
 if($VerifyOnly){throw 'Download folder does not exist.'}
 New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
function Download([string]$Name){
 $file=Join-Path $directory $Name
 if(Test-Path -LiteralPath $file){return $file}
 if($VerifyOnly){throw ('Missing file: '+$Name)}
 $partial=$file+'.part'
 $downloadArgs=@('--fail','--location','--continue-at','-','--retry','3','--retry-delay','2','--connect-timeout','30','--max-time','1800','--output',$partial,($base+[Uri]::EscapeDataString($Name)))
 if($Proxy){$downloadArgs+=@('--proxy',$Proxy)}
 Write-Host ('Downloading '+$Name)
 & curl.exe @downloadArgs
 if($LASTEXITCODE -ne 0){throw ('Download incomplete. Rerun to continue: '+$Name)}
 Move-Item -LiteralPath $partial -Destination $file
 return $file
}
$manifestFile=Download $manifestName
$manifest=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$expectedArchive='NoteMender-2.5.0-demo.7-windows-'+$(if($Edition -eq 'gpu'){'gpu-addon'}else{'offline'})+'.zip'
if($manifest.version -ne '2.5.0-demo.7' -or $manifest.archive -cne $expectedArchive -or !$manifest.parts){throw 'Invalid release manifest.'}
$seen=@{};$total=0L
foreach($part in $manifest.parts){
 if($part.name -notmatch '^NoteMender-2\.5\.0-demo\.7-windows-(offline|gpu-addon)\.zip\.\d{3}$' -or !$part.name.StartsWith($expectedArchive+'.') -or $part.sha256 -notmatch '^[a-f0-9]{64}$' -or $part.bytes -le 0 -or $seen.ContainsKey($part.name)){throw 'Invalid part entry.'}
 $seen[$part.name]=$true;$total+=$part.bytes
}
if($total -ne $manifest.bytes){throw 'Manifest size mismatch.'}
foreach($part in $manifest.parts){
 $file=Download $part.name
 if((Get-Item -LiteralPath $file).Length -ne $part.bytes -or (Get-SHA256 $file) -ne $part.sha256){throw ('Damaged file: '+$part.name+'. Remove that file and rerun.')}
 Write-Host ('Verified '+$part.name)
}
foreach($name in @('Extract-NoteMender.ps1',$(if($Edition -eq 'gpu'){'Extract-GPU-Addon.cmd'}else{'Extract-NoteMender.cmd'}))){Download $name | Out-Null}
Write-Host ('All parts verified. Run the extraction CMD in '+$directory)
