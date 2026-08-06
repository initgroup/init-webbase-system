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
$venvActivate = Join-Path $repoRoot "venv\Scripts\Activate.ps1"

if (-not (Test-Path -LiteralPath $venvPython) -or -not (Test-Path -LiteralPath $venvActivate)) {
    throw "venv Python was not found. Run scripts\setup-venv.ps1 first."
}

# Activate before starting Uvicorn so Ctrl+C returns to the same (venv) prompt
# even when PowerShell interrupts the remainder of this script immediately.
Set-Location -LiteralPath $repoRoot
. $venvActivate

# Keep the project port for manual restarts from the retained task terminal.
# Uvicorn reads this value when no explicit --port option is given.
$env:UVICORN_PORT = [string]$Port

$bindAddress = $null
if (-not [System.Net.IPAddress]::TryParse($HostAddress, [ref]$bindAddress)) {
    $bindAddress = [System.Net.Dns]::GetHostAddresses($HostAddress) |
        Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
        Select-Object -First 1
}
if (-not $bindAddress) {
    throw "Host address could not be resolved: $HostAddress"
}

$portProbe = [System.Net.Sockets.TcpListener]::new($bindAddress, $Port)
try {
    $portProbe.Start()
}
catch {
    throw "Server port is already in use or unavailable: $HostAddress`:$Port"
}
finally {
    $portProbe.Stop()
}

Push-Location $repoRoot
try {
    & $venvPython -c "import main"
    if ($LASTEXITCODE -ne 0) {
        throw "Server application import validation failed with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
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
$serverExitCode = $null
$pipelineInterrupted = $false
try {
    Write-Host "Starting server: http://$HostAddress`:$Port" -ForegroundColor Green
    try {
        & $venvPython @serverArgs
        $serverExitCode = $LASTEXITCODE
    }
    catch [System.Management.Automation.PipelineStoppedException] {
        $pipelineInterrupted = $true
    }
}
finally {
    Pop-Location
}

$gracefulExitCodes = @(0, 130, -1073741510)
$reloadControlCExit = -not $NoReload -and $serverExitCode -eq 1
if ($pipelineInterrupted -or $serverExitCode -in $gracefulExitCodes -or $reloadControlCExit) {
    Write-Host "Server stopped normally." -ForegroundColor Green
    Set-Location -LiteralPath $repoRoot
    Write-Host "Returned to the active (venv) prompt." -ForegroundColor Green
    return
}

throw "Server process exited with code $serverExitCode."
