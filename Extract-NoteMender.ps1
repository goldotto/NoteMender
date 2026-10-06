param([string]$Destination=(Join-Path $PSScriptRoot 'NoteMender-v2.5.0-demo.7'),[ValidateSet('offline-manifest.json','gpu-manifest.json')][string]$ManifestFile='offline-manifest.json')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot $ManifestFile) -Raw | ConvertFrom-Json
if($manifest.version -ne '2.5.0-demo.7' -or !$manifest.parts -or $manifest.archive -notmatch '^NoteMender-2\.5\.0-demo\.7-windows-(offline|gpu-addon)\.zip$'){throw 'Invalid release manifest.'}
$prefix=if($ManifestFile -eq 'gpu-manifest.json'){'NoteMender-GPU/'}else{'NoteMender/'}
$target=[IO.Path]::GetFullPath($Destination)
if(Test-Path -LiteralPath $target){throw 'Destination already exists. Choose a new empty folder with -Destination.'}
function Get-SHA256([string]$File){
 $stream=[IO.File]::OpenRead($File);$hash=[Security.Cryptography.SHA256]::Create()
 try{return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
 finally{$hash.Dispose();$stream.Dispose()}
}
$total=0L
foreach($part in $manifest.parts){
 if($part.name -notmatch '^NoteMender-2\.5\.0-demo\.7-windows-(offline|gpu-addon)\.zip\.\d{3}$' -or !$part.name.StartsWith($manifest.archive+'.') -or $part.sha256 -notmatch '^[0-9a-f]{64}$'){throw 'Invalid part name or hash.'}
 $file=Join-Path $PSScriptRoot $part.name
 Write-Host ('Checking '+$part.name)
 if(!(Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -ne $part.bytes -or (Get-SHA256 $file) -ne $part.sha256){throw ('Missing or damaged part: '+$part.name)}
 $total+=[long]$part.bytes
}
if($total -ne [long]$manifest.bytes -or $manifest.sha256 -notmatch '^[0-9a-f]{64}$'){throw 'Invalid archive size or hash.'}
$drive=Get-PSDrive -Name ([IO.Path]::GetPathRoot($PSScriptRoot).Substring(0,1)) -ErrorAction SilentlyContinue
$targetDrive=Get-PSDrive -Name ([IO.Path]::GetPathRoot($target).Substring(0,1)) -ErrorAction SilentlyContinue
$sameDrive=[IO.Path]::GetPathRoot($target) -eq [IO.Path]::GetPathRoot($PSScriptRoot)
$joiningSpace=$total+1GB
if($sameDrive){$joiningSpace+=[long]$manifest.expandedBytes}
if(($drive -and $drive.Free -lt $joiningSpace) -or (!$sameDrive -and $targetDrive -and $targetDrive.Free -lt [long]$manifest.expandedBytes+1GB)){throw 'Not enough disk space for joining and extracting the package.'}
$joined=Join-Path $PSScriptRoot ($manifest.archive+'.joining.zip')
if(Test-Path -LiteralPath $joined){throw 'An earlier temporary joining file exists. Rename it before retrying.'}
$created=$false
try{
 $output=[IO.File]::Open($joined,[IO.FileMode]::CreateNew);$created=$true;$done=0L
 try{
  foreach($part in $manifest.parts){$input=[IO.File]::OpenRead((Join-Path $PSScriptRoot $part.name));try{$input.CopyTo($output,1048576)}finally{$input.Dispose()};$done+=[long]$part.bytes;Write-Progress -Activity 'Joining offline archive' -PercentComplete ([int](100*$done/$total))}
 }finally{$output.Dispose()}
 if((Get-SHA256 $joined) -ne $manifest.sha256){throw 'Joined archive failed verification.'}
 $zip=[IO.Compression.ZipFile]::OpenRead($joined)
 try{
  $seen=@{}
  foreach($entry in $zip.Entries){
   $name=$entry.FullName.Replace('\','/')
   if(!$name.StartsWith($prefix) -or $name.Contains(':') -or $name.Split('/') -contains '..' -or $name.Split('/') -contains '.' -or $seen.ContainsKey($name)){throw 'Unsafe or duplicate archive entry.'}
   $dest=[IO.Path]::GetFullPath((Join-Path $target $name))
   if(!$dest.StartsWith($target.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Archive entry escapes destination.'}
   $seen[$name]=$true
  }
 }finally{$zip.Dispose()}
 Write-Host 'Extracting NoteMender...'
 [IO.Compression.ZipFile]::ExtractToDirectory($joined,$target)
 Write-Progress -Activity 'Joining offline archive' -Completed
 if($ManifestFile -eq 'gpu-manifest.json'){Write-Host ('Ready: '+(Join-Path $target 'NoteMender-GPU\Install-GPU-Addon.cmd'))}else{Write-Host ('Ready: '+(Join-Path $target 'NoteMender\Start-NoteMender.cmd'))}
}catch{
 if(Test-Path -LiteralPath $target){Write-Warning ('Extraction did not finish. This folder is incomplete; choose a new destination before retrying: '+$target)}
 throw
}finally{if($created -and (Test-Path -LiteralPath $joined)){Remove-Item -LiteralPath $joined -Force}}
