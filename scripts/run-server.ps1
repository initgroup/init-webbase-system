param(
    [string]$HostAddress = "127.0.0.1",

    [ValidateRange(1, 65535)]
    [int]$Port = 8100,

    [switch]$NoReload
)

$ErrorActionPreference = "Stop"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
chcp.com 65001 | Out-Null

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$venvPython = Join-Path $repoRoot "venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "venv Python was not found. Run scripts\setup-venv.ps1 first."
}

$serverArgs = @(
    "-m",
    "uvicorn",
    "main:app",
    "--host",
    $HostAddress,
    "--port",
    [string]$Port
)
if (-not $NoReload) {
    $serverArgs += "--reload"
}

Push-Location $repoRoot
try {
    Write-Host "Starting server: http://$HostAddress`:$Port" -ForegroundColor Green
    & $venvPython @serverArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Server process exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
