param(
    [ValidateSet("Git", "Working")]
    [string]$Mode = "Working",

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
$modeFolderName = if ($Mode -eq "Git") {
    "${safeProjectName}_GIT_BACKUP"
}
else {
    "${safeProjectName}_WORKING_BACKUP"
}
$modeRoot = Join-Path $backupRootFull $modeFolderName
$backupDir = Join-Path $modeRoot $stamp

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

        $bundlePath = Join-Path $backupDir "repository.bundle"
        git bundle create "$bundlePath" --branches --tags
        if ($LASTEXITCODE -ne 0) {
            throw "git bundle failed with exit code $LASTEXITCODE"
        }
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
        "artifacts",
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
        "/E",
        "/COPY:DAT",
        "/DCOPY:DAT",
        "/XJ",
        "/R:2",
        "/W:1",
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/NP",
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

$branch = "N/A"
$headCommit = "N/A"
if (Test-Path -LiteralPath (Join-Path $repoRoot ".git")) {
    $branch = (& git -C $repoRoot branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        $branch = "DETACHED"
    }
    $headCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) {
        $headCommit = "UNKNOWN"
    }
}

$manifest = @(
    "Project: $safeProjectName"
    "Mode: $Mode"
    "Created: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
    "Source: $repoRootFull"
    "Branch: $branch"
    "HEAD: $headCommit"
)

if ($Mode -eq "Git") {
    $manifest += "Git history: repository.bundle"
    $manifest += "Restore example: git clone repository.bundle restored-project"
}
else {
    $manifest += "Includes: committed, modified, and untracked working files"
    $manifest += "Excludes: Git metadata, environments, dependencies, secrets, wallets, and generated caches"
}

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllLines(
    (Join-Path $backupDir "BACKUP_INFO.txt"),
    $manifest,
    $utf8NoBom
)

Write-Host ""
Write-Host "Backup completed." -ForegroundColor Green
Write-Host "Project: $safeProjectName"
Write-Host "Mode: $Mode"
Write-Host "Backup group: $modeRoot"
Write-Host "Path: $backupDir"
