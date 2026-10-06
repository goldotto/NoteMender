param(
    [switch]$BasicOnly,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot

# 固定版本与 SHA-256：镜像文件若损坏或被替换就拒绝安装。
$nodeVersion = '22.22.0'
$nodeHash = 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a'
$modelHash = '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4'
$nodeArchive = "node-v$nodeVersion-win-x64.zip"
$pythonInstaller = 'python-3.11.9-amd64.exe'
$modelName = '955717e8-8726e21a.th'
$runtime = Join-Path $PSScriptRoot 'runtime'
$downloads = Join-Path $runtime 'downloads'
$nodeDir = Join-Path $runtime 'node'
$pythonDir = Join-Path $runtime 'python'
$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$pythonPathFile = Join-Path $runtime 'python-path.txt'
$modelDir = Join-Path $runtime 'models\hub\checkpoints'

if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw '此脚本目前只支持 Windows x64。ARM64 和 32 位 Windows 请手动安装对应环境。'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Test-Hash([string]$Path, [string]$Expected) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $actual = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
        finally { $sha.Dispose() }
    } finally { $stream.Dispose() }
    return $actual -ieq $Expected
}

function Find-CachedModel {
    $candidates = @((Join-Path $modelDir $modelName))
    if ($env:TORCH_HOME) { $candidates += Join-Path $env:TORCH_HOME "hub\checkpoints\$modelName" }
    $candidates += Join-Path ([Environment]::GetFolderPath('UserProfile')) ".cache\torch\hub\checkpoints\$modelName"
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Hash $candidate $modelHash) { return $candidate }
    }
    return $null
}

function Get-VerifiedFile([string[]]$Urls, [string]$Path, [string]$Hash) {
    if (Test-Hash $Path $Hash) { return }
    foreach ($url in $Urls) {
        $temporary = "$Path.part"
        try {
            Write-Host "下载：$url"
            Invoke-WebRequest -Uri $url -OutFile $temporary -TimeoutSec 900 -MaximumRedirection 8 -UseBasicParsing
            if (-not (Test-Hash $temporary $Hash)) { throw 'SHA-256 校验不通过' }
            Move-Item -LiteralPath $temporary -Destination $Path -Force
            return
        } catch {
            Write-Warning "$url 下载失败：$($_.Exception.Message)"
            Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        }
    }
    throw "全部下载地址都失败：$Path。请检查网络后重试。"
}

function Assert-Command([string]$File, [string[]]$Arguments, [string]$ErrorText) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw $ErrorText }
}

function Test-Node22([string]$File) {
    if (-not $File) { return $false }
    try {
        $major = & $File -p 'parseInt(process.versions.node,10)' 2>$null
        return $LASTEXITCODE -eq 0 -and [int]$major -ge 22
    } catch { return $false }
}

function Test-Python311([string]$File) {
    if (-not $File -or -not (Test-Path -LiteralPath $File)) { return $false }
    try {
        & $File -c 'import sys, venv, ensurepip; assert sys.version_info[:2] == (3, 11) and sys.maxsize > 2**32' 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

function Test-AudioEnvironment([string]$File) {
    if (-not (Test-Python311 $File)) { return $false }
    try {
        & $File -c 'import av, librosa, numpy, soundfile, torch, torchaudio; from demucs.pretrained import get_model; from demucs.apply import apply_model' 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

function Find-InstalledPython311([switch]$RequireAudio) {
    $candidates = @()
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        try {
            $fromLauncher = & $launcher.Source -3.11 -c 'import sys; print(sys.base_prefix)' 2>$null | Select-Object -Last 1
            if ($LASTEXITCODE -eq 0 -and $fromLauncher) { $candidates += Join-Path $fromLauncher 'python.exe' }
        } catch { }
    }
    foreach ($commandName in @('python.exe', 'python3.11.exe')) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($command) { $candidates += $command.Source }
    }
    foreach ($key in @(
        'HKCU:\Software\Python\PythonCore\3.11\InstallPath',
        'HKLM:\Software\Python\PythonCore\3.11\InstallPath',
        'HKLM:\Software\WOW6432Node\Python\PythonCore\3.11\InstallPath'
    )) {
        if (Test-Path -LiteralPath $key) {
            $folder = (Get-Item -LiteralPath $key).GetValue('')
            if ($folder) { $candidates += Join-Path $folder 'python.exe' }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if ((Test-Python311 $candidate) -and (-not $RequireAudio -or (Test-AudioEnvironment $candidate))) { return $candidate }
    }
    return $null
}

function Copy-PythonBase([string]$Source) {
    $sourceDir = Split-Path -Parent $Source
    if ([IO.Path]::GetFullPath($sourceDir).TrimEnd('\') -ieq [IO.Path]::GetFullPath($pythonDir).TrimEnd('\')) { return }
    Write-Host '发现已有 Python 3.11，复制基础解释器到本程序 runtime 目录…'
    New-Item -ItemType Directory -Path $pythonDir -Force | Out-Null
    foreach ($name in @('python3.dll', 'python311.dll', 'pythonw.exe', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
        $sourceFile = Join-Path $sourceDir $name
        if (Test-Path -LiteralPath $sourceFile) { Copy-Item -LiteralPath $sourceFile -Destination $pythonDir -Force }
    }
    foreach ($name in @('DLLs', 'include', 'libs', 'tcl')) {
        $sourceFolder = Join-Path $sourceDir $name
        if (Test-Path -LiteralPath $sourceFolder) { Copy-Item -LiteralPath $sourceFolder -Destination $pythonDir -Recurse -Force }
    }
    $sourceLib = Join-Path $sourceDir 'Lib'
    $targetLib = Join-Path $pythonDir 'Lib'
    New-Item -ItemType Directory -Path $targetLib -Force | Out-Null
    Get-ChildItem -LiteralPath $sourceLib -Force | Where-Object Name -ne 'site-packages' |
        Copy-Item -Destination $targetLib -Recurse -Force
    # Copy the executable last, so an interrupted copy is retried on the next run.
    Copy-Item -LiteralPath $Source -Destination $pythonDir -Force
    if (-not (Test-Python311 (Join-Path $pythonDir 'python.exe'))) {
        throw '复制的 Python 3.11 无法启动。请检查已有安装，或删除 runtime\python 后重试。'
    }
}

if ($CheckOnly) {
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    Write-Host "Node.js 22+：$( (Test-Node22 (Join-Path $nodeDir 'node.exe')) -or (Test-Node22 $systemNode.Source) )"
    $savedPython = if (Test-Path -LiteralPath $pythonPathFile) { [IO.File]::ReadAllText($pythonPathFile).Trim() }
    $systemPython = Find-InstalledPython311 -RequireAudio
    Write-Host "Python 音频环境：$( (Test-AudioEnvironment $venvPython) -or (Test-AudioEnvironment $savedPython) -or [bool]$systemPython )"
    Write-Host "Demucs 模型可复用：$([bool](Find-CachedModel))"
    exit 0
}

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$nodeExe = Join-Path $nodeDir 'node.exe'
$systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
if (Test-Node22 $nodeExe) {
    Write-Host "复用本程序中的 Node.js：$nodeExe"
} elseif (Test-Node22 $systemNode.Source) {
    Write-Host "复用电脑上已有的 Node.js：$($systemNode.Source)"
} else {
    New-Item -ItemType Directory -Path $downloads -Force | Out-Null
    $nodeZip = Join-Path $downloads $nodeArchive
    Get-VerifiedFile @(
        "https://repo.huaweicloud.com/nodejs/v$nodeVersion/$nodeArchive",
        "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v$nodeVersion/$nodeArchive",
        "https://nodejs.org/dist/v$nodeVersion/$nodeArchive"
    ) $nodeZip $nodeHash
    $unpackDir = Join-Path $downloads "node-v$nodeVersion-win-x64"
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $downloads -Force
    if (-not (Test-Path -LiteralPath (Join-Path $unpackDir 'node.exe'))) { throw 'Node 压缩包内容不完整' }
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
    Copy-Item -Path (Join-Path $unpackDir '*') -Destination $nodeDir -Recurse -Force
    Assert-Command $nodeExe @('--version') 'Node 启动失败'
}
Write-Host '基础运行环境已经就绪。'
if ($BasicOnly) { exit 0 }

$pythonForAudio = $null
if (Test-AudioEnvironment $venvPython) {
    $pythonForAudio = $venvPython
    Write-Host '复用本程序已有的 Python 音频环境。'
} else {
    $savedPython = if (Test-Path -LiteralPath $pythonPathFile) { [IO.File]::ReadAllText($pythonPathFile).Trim() }
    if (Test-AudioEnvironment $savedPython) {
        $pythonForAudio = $savedPython
        Write-Host "复用此前检测到的 Python 音频环境：$savedPython"
    } else {
        $systemPython = Find-InstalledPython311 -RequireAudio
        if ($systemPython) {
            $pythonForAudio = $systemPython
            Write-Host "复用电脑上已有的 Python 音频环境：$systemPython"
        }
    }
}

$basePython = Join-Path $pythonDir 'python.exe'
if (-not $pythonForAudio) {
if (-not (Test-Path -LiteralPath $venvPython) -and -not (Test-Python311 $basePython)) {
    $installedPython = Find-InstalledPython311
    if ($installedPython) { Copy-PythonBase $installedPython }
}
if (-not (Test-Path -LiteralPath $venvPython) -and -not (Test-Python311 $basePython)) {
    New-Item -ItemType Directory -Path $downloads -Force | Out-Null
    $installerPath = Join-Path $downloads $pythonInstaller
    if (-not (Test-Path -LiteralPath $installerPath)) {
        Write-Host '下载 Python 3.11 安装程序…'
        Invoke-WebRequest -Uri "https://repo.huaweicloud.com/python/3.11.9/$pythonInstaller" -OutFile "$installerPath.part" -TimeoutSec 900 -UseBasicParsing
        Move-Item -LiteralPath "$installerPath.part" -Destination $installerPath -Force
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
        throw 'Python 安装程序数字签名无效；已拒绝运行。可删除 runtime\downloads 中该文件后重试。'
    }
    Write-Host '安装 Python 3.11 到本程序 runtime 目录…'
    $arguments = @('/quiet', 'InstallAllUsers=0', "TargetDir=`"$pythonDir`"", 'PrependPath=0', 'AppendPath=0', 'Include_launcher=0', 'AssociateFiles=0', 'Shortcuts=0', 'Include_test=0', 'Include_pip=1')
    $process = Start-Process -FilePath $installerPath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Python 安装程序失败，退出码 $($process.ExitCode)" }
    if (-not (Test-Python311 $basePython)) {
        # The official installer can repair an existing installation and ignore TargetDir.
        $installedPython = Find-InstalledPython311
        if ($installedPython) { Copy-PythonBase $installedPython }
    }
    if (-not (Test-Python311 $basePython)) {
        throw 'Python 安装程序已退出，但本程序目录中仍无可用的 Python 3.11。请检查 Python 安装日志后重试。'
    }
}
if (-not (Test-Path -LiteralPath $venvPython)) {
    Assert-Command $basePython @('-c', 'import sys; assert sys.version_info[:2] == (3, 11)') 'Python 版本或启动检查失败'
    Assert-Command $basePython @('-m', 'venv', (Join-Path $PSScriptRoot '.venv')) '创建虚拟环境失败'
}
Assert-Command $venvPython @('-c', 'import sys; assert sys.version_info[:2] == (3, 11)') '虚拟环境不是可用的 Python 3.11；请检查 .venv 后重试'
if (-not (Test-AudioEnvironment $venvPython)) {
$pypi = 'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple'
$torch = 'https://mirror.sjtu.edu.cn/pytorch-wheels/cpu/'
$env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
$env:PIP_DEFAULT_TIMEOUT = '120'
Write-Host '从国内镜像安装 PyTorch CPU、Demucs 与音频依赖；这一步下载量较大。'
& $venvPython -m pip install --retries 8 --index-url $torch --no-deps 'torch==2.5.1+cpu' 'torchaudio==2.5.1+cpu'
if ($LASTEXITCODE -ne 0) {
    Write-Warning '交大 PyTorch 镜像未成功，尝试 PyTorch 官方源。'
    Assert-Command $venvPython @('-m', 'pip', 'install', '--retries', '8', '--index-url', 'https://download.pytorch.org/whl/cpu', '--no-deps', 'torch==2.5.1+cpu', 'torchaudio==2.5.1+cpu') 'PyTorch CPU 下载失败；重跑脚本可继续'
}
& $venvPython -m pip install --retries 4 --index-url $pypi -r (Join-Path $PSScriptRoot 'requirements-demucs.txt')
if ($LASTEXITCODE -ne 0) {
 Write-Warning '国内 PyPI 镜像未成功，尝试官方源。'
 Assert-Command $venvPython @('-m', 'pip', 'install', '--retries', '4', '--index-url', 'https://pypi.org/simple', '-r', (Join-Path $PSScriptRoot 'requirements-demucs.txt')) 'Python 依赖安装失败；重跑脚本可继续'
}
Assert-Command $venvPython @('-c', 'import demucs, torch, torchaudio, librosa, av') 'Python 音频依赖检查失败'
}
$pythonForAudio = $venvPython
}
if ($pythonForAudio -ieq $venvPython) {
    Remove-Item -LiteralPath $pythonPathFile -Force -ErrorAction SilentlyContinue
} else {
    [IO.File]::WriteAllText($pythonPathFile, $pythonForAudio, [Text.UTF8Encoding]::new($false))
}
Write-Host 'Python 音频环境就绪。'

New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
$modelFile = Join-Path $modelDir $modelName
if (-not (Test-Hash $modelFile $modelHash)) {
    $cached = Find-CachedModel
    if ($cached) {
        Copy-Item -LiteralPath $cached -Destination $modelFile -Force
        Write-Host "复用电脑上已有的 Demucs 模型：$cached"
    }
}
Get-VerifiedFile @(
    "https://hf-mirror.com/lainlives/audio-separator-models/resolve/main/$modelName",
    "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/$modelName"
) $modelFile $modelHash
$env:TORCH_HOME = Join-Path $runtime 'models'
if (-not (Test-Path -LiteralPath (Join-Path $runtime 'demucs-ready.json'))) {
    Assert-Command $pythonForAudio @((Join-Path $PSScriptRoot 'scripts\separate.py'), '--prepare') 'Demucs 模型加载失败'
}
Write-Host '全部完成。双击 Start-NoteMender.cmd；已有页面请刷新。'
