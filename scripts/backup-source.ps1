param(
    [ValidateSet("Git", "Working")]
    [string]$Mode = "Git",

    [string]$BackupRoot = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$projectName = Split-Path -Leaf $repoRoot
$safeProjectName = [regex]::Replace($projectName, '[^A-Za-z0-9._-]', '-').Trim('-')
if ([string]::IsNullOrWhiteSpace($safeProjectName)) {
    $safeProjectName = "web-project"
}

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path (Split-Path -Parent $repoRoot) "backup"
}

$repoRootFull = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\', '/')
$backupRootFull = [System.IO.Path]::GetFullPath($BackupRoot).TrimEnd('\', '/')
$pathComparison = [System.StringComparison]::OrdinalIgnoreCase
$repoPrefix = $repoRootFull + [System.IO.Path]::DirectorySeparatorChar
if ($backupRootFull.Equals($repoRootFull, $pathComparison) -or
    $backupRootFull.StartsWith($repoPrefix, $pathComparison)) {
    throw "BackupRoot must be outside the project directory: $backupRootFull"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $backupRootFull "$safeProjectName-$($Mode.ToLower())-$stamp"

if ($Mode -eq "Git") {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot ".git"))) {
        throw "Git metadata was not found. Use -Mode Working for an unpacked source directory."
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "git command was not found."
    }
}
elseif (-not (Get-Command robocopy -ErrorAction SilentlyContinue)) {
    throw "robocopy command was not found."
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

if ($Mode -eq "Git") {
    $zipPath = Join-Path $env:TEMP "$safeProjectName-$stamp.zip"
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    Push-Location $repoRoot
    try {
        git archive --format=zip --output="$zipPath" HEAD
        if ($LASTEXITCODE -ne 0) {
            throw "git archive failed with exit code $LASTEXITCODE"
        }
        Expand-Archive -LiteralPath $zipPath -DestinationPath $backupDir -Force
    }
    finally {
        Pop-Location
        if (Test-Path -LiteralPath $zipPath) {
            Remove-Item -LiteralPath $zipPath -Force
        }
    }
}
else {
    $excludeDirs = @(
        ".git",
        "venv",
        ".venv",
        "node_modules",
        ".node_modules",
        "secrets",
        ".secrets",
        "secreats",
        ".secreats",
        "etc\secrets",
        "instantclient",
        ".instantclient",
        "Wallet*",
        "wallet*",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "backup"
    )
    $excludeFiles = @(
        ".env",
        ".env.*",
        "*.env.local",
        ".envrc",
        "*.pyc",
        "*Wallet*.zip",
        "*wallet*.zip",
        "*.pem",
        "*.key",
        "*.p12",
        "*.pfx",
        "*.jks",
        "*.whl"
    )

    $robocopyArgs = @(
        $repoRoot,
        $backupDir,
        "/MIR",
        "/R:2",
        "/W:1",
        "/XD"
    ) + $excludeDirs + @("/XF") + $excludeFiles

    robocopy @robocopyArgs
    $exitCode = $LASTEXITCODE
    if ($exitCode -gt 7) {
        throw "robocopy failed with exit code $exitCode"
    }

    $envTemplate = Join-Path $repoRoot ".env.example"
    if (Test-Path -LiteralPath $envTemplate) {
        Copy-Item -LiteralPath $envTemplate -Destination (Join-Path $backupDir ".env.example") -Force
    }
}

Write-Host ""
Write-Host "Backup completed." -ForegroundColor Green
Write-Host "Project: $safeProjectName"
Write-Host "Mode: $Mode"
Write-Host "Path: $backupDir"
