param([string]$Target)
$ErrorActionPreference='Stop'
if(!$Target){$Target=Read-Host 'Enter the NoteMender program folder (the folder containing Start-NoteMender.cmd)'}
$targetRoot=[IO.Path]::GetFullPath($Target.Trim('"'))
$package=Get-Content -LiteralPath (Join-Path $targetRoot 'package.json') -Raw | ConvertFrom-Json
if($package.name -ne 'notemender' -or $package.version -ne '2.5.0-demo.7' -or !(Test-Path -LiteralPath (Join-Path $targetRoot 'runtime\portable-ready.json'))){throw 'This extension requires the NoteMender 2.5.0-demo.7 standard offline edition.'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'gpu-files.json') -Raw | ConvertFrom-Json
if($manifest.version -ne $package.version -or !$manifest.files){throw 'Invalid GPU extension manifest.'}
$runtime=Join-Path $targetRoot 'runtime';$acceleration=Join-Path $runtime 'acceleration';$gpu=Join-Path $acceleration 'gpu'
foreach($file in $manifest.files){
 if($file.path -notmatch '^runtime/acceleration/gpu/' -or $file.path.Split('/') -contains '..' -or $file.path.Contains(':')){throw 'Unsafe GPU file path.'}
 $source=Join-Path $PSScriptRoot $file.path
 if(!(Test-Path -LiteralPath $source) -or (Get-Item -LiteralPath $source).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw ('Missing or damaged GPU file: '+$file.path)}
}
$pending=Join-Path $acceleration ('gpu-install-'+[Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $pending -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'runtime\acceleration\gpu\*') -Destination $pending -Recurse -Force
$python=Join-Path $runtime 'python\python.exe';$oldPythonPath=$env:PYTHONPATH
try{
 $env:PYTHONPATH=$pending
 $checkCode="import onnxruntime,torch,torchaudio; assert onnxruntime.__version__ == '1.22.0'; assert torch.__version__ == '2.7.1+cu128'; print('GPU component imports OK; CUDA available:',torch.cuda.is_available())"
 & $python -c $checkCode
 if($LASTEXITCODE -ne 0){throw 'GPU runtime check failed. The current CPU installation is unchanged.'}
}finally{$env:PYTHONPATH=$oldPythonPath}
foreach($path in @($pending,$gpu)){if(![IO.Path]::GetFullPath($path).StartsWith([IO.Path]::GetFullPath($acceleration).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid installation target.'}}
if(Test-Path -LiteralPath $gpu){$backup=Join-Path $acceleration ('gpu-backup-'+[Guid]::NewGuid().ToString());Move-Item -LiteralPath $gpu -Destination $backup}
Move-Item -LiteralPath $pending -Destination $gpu
$qualificationFile=Join-Path $acceleration 'qualification.json';$qualification=@{}
if(Test-Path -LiteralPath $qualificationFile){$record=Get-Content -LiteralPath $qualificationFile -Raw | ConvertFrom-Json;foreach($item in $record.PSObject.Properties){$qualification[$item.Name]=$item.Value}}
$addon=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'gpu-qualification.json') -Raw | ConvertFrom-Json
foreach($key in @('cuda','cudaCPU','demucs','crepe')){if($addon.PSObject.Properties.Name -contains $key){$qualification[$key]=$addon.$key}}
[IO.File]::WriteAllText($qualificationFile,($qualification | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
Write-Host 'GPU extension installed. Close and restart NoteMender to refresh component detection. CPU environment is preserved.'
