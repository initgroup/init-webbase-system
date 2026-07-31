param(
    [string]$PythonCommand = "py",

    [string]$PythonVersion = "3.12",

    [switch]$Recreate,

    [switch]$SkipPipUpgrade
)

$ErrorActionPreference = "Stop"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
chcp.com 65001 | Out-Null

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$venvDir = Join-Path $repoRoot "venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsFile = Join-Path $repoRoot "requirements.txt"

if (-not (Test-Path -LiteralPath $requirementsFile)) {
    throw "requirements.txt was not found: $requirementsFile"
}

$needsCreation = $Recreate -or -not (Test-Path -LiteralPath $venvPython)
$pythonCommandInfo = $null
$pythonPrefixArgs = @()
if ($needsCreation) {
    $pythonCommandInfo = Get-Command $PythonCommand -ErrorAction SilentlyContinue
    if (-not $pythonCommandInfo) {
        throw "Python command was not found: $PythonCommand"
    }

    if ([System.IO.Path]::GetFileNameWithoutExtension($pythonCommandInfo.Name) -eq "py") {
        if ([string]::IsNullOrWhiteSpace($PythonVersion)) {
            throw "PythonVersion is required when PythonCommand is py."
        }
        $pythonPrefixArgs += "-$PythonVersion"
    }

    & $pythonCommandInfo.Source @pythonPrefixArgs -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)"
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 or newer is required."
    }
}

if ($Recreate -and (Test-Path -LiteralPath $venvDir)) {
    $resolvedRepo = (Resolve-Path -LiteralPath $repoRoot).Path.TrimEnd('\')
    $resolvedVenv = (Resolve-Path -LiteralPath $venvDir).Path.TrimEnd('\')
    $comparison = [System.StringComparison]::OrdinalIgnoreCase
    if (-not $resolvedVenv.Equals((Join-Path $resolvedRepo "venv"), $comparison)) {
        throw "Refusing to remove an unexpected virtual environment path: $resolvedVenv"
    }

    Write-Host "Removing existing virtual environment: $resolvedVenv" -ForegroundColor Yellow
    Remove-Item -LiteralPath $resolvedVenv -Recurse -Force
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "Creating virtual environment: $venvDir" -ForegroundColor Cyan
    & $pythonCommandInfo.Source @pythonPrefixArgs -m venv $venvDir
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython)) {
        throw "Virtual environment creation failed."
    }
}
else {
    Write-Host "Using existing virtual environment: $venvDir" -ForegroundColor Cyan
}

& $venvPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)"
if ($LASTEXITCODE -ne 0) {
    throw "The virtual environment must use Python 3.12 or newer. Run again with -Recreate."
}

if (-not $SkipPipUpgrade) {
    Write-Host "Upgrading pip..." -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) {
        throw "pip upgrade failed."
    }
}

Write-Host "Installing requirements..." -ForegroundColor Cyan
& $venvPython -m pip install -r $requirementsFile
if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed."
}

Write-Host ""
Write-Host "Virtual environment is ready." -ForegroundColor Green
Write-Host "Python: $venvPython"
