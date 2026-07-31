param(
    [switch]$SkipJavaScript
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

Push-Location $repoRoot
try {
    $compileCode = @"
from pathlib import Path

files = [Path('main.py'), *sorted(Path('backend').rglob('*.py'))]
for file_path in files:
    source = file_path.read_text(encoding='utf-8')
    compile(source, str(file_path), 'exec')
print(f'Python syntax OK: {len(files)} files')
"@
    & $venvPython -c $compileCode
    if ($LASTEXITCODE -ne 0) {
        throw "Python syntax validation failed."
    }

    $definedSqlIds = @{}
    Get-ChildItem -LiteralPath (Join-Path $repoRoot "database") -Filter "*.sql" -File |
        ForEach-Object {
            $sqlText = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
            if ($null -eq $sqlText) {
                $sqlText = ""
            }
            [regex]::Matches($sqlText, '(?m)^-- \[([A-Za-z0-9_]+)\]\s*$') |
                ForEach-Object {
                    $sqlId = $_.Groups[1].Value
                    if ($definedSqlIds.ContainsKey($sqlId)) {
                        throw "Duplicate SQL ID: $sqlId"
                    }
                    $definedSqlIds[$sqlId] = $true
                }
        }

    $referencedSqlIds = @{}
    Get-ChildItem -LiteralPath (Join-Path $repoRoot "backend") -Filter "*.py" -File -Recurse |
        ForEach-Object {
            $pythonText = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
            if ($null -eq $pythonText) {
                $pythonText = ""
            }
            [regex]::Matches(
                $pythonText,
                'SqlLoader\.get_sql\("([A-Za-z0-9_]+)"\)'
            ) | ForEach-Object {
                $referencedSqlIds[$_.Groups[1].Value] = $true
            }
        }

    $missingSqlIds = @(
        $referencedSqlIds.Keys |
            Where-Object { -not $definedSqlIds.ContainsKey($_) } |
            Sort-Object
    )
    $unusedSqlIds = @(
        $definedSqlIds.Keys |
            Where-Object { -not $referencedSqlIds.ContainsKey($_) } |
            Sort-Object
    )
    if ($missingSqlIds.Count -gt 0 -or $unusedSqlIds.Count -gt 0) {
        throw "SQL ID contract failed. Missing=[$($missingSqlIds -join ', ')] Unused=[$($unusedSqlIds -join ', ')]"
    }
    Write-Host "SQL ID contract OK: $($definedSqlIds.Count) IDs" -ForegroundColor Green

    $migrationContractCode = @"
import re
from pathlib import Path

ddl_path = Path('database/INIT_SYSTEM_DDL.sql')
alt_path = Path('database/INIT_SYSTEM_ALT.sql')
if alt_path.exists():
    ddl_text = ddl_path.read_text(encoding='utf-8')
    alt_text = alt_path.read_text(encoding='utf-8')
    if re.search(r'(?im)^\s*(DROP|TRUNCATE)\s+', alt_text):
        raise RuntimeError('INIT_SYSTEM_ALT.sql must not contain DROP or TRUNCATE statements.')

    table_pattern = re.compile(r'CREATE TABLE \x22([^\x22]+)\x22 \((.*?)\n\)', re.S)
    column_pattern = re.compile(r'^\s*(?:,\s*)?\x22([A-Z0-9_$#]+)\x22\s+', re.M)

    def table_columns(source):
        return {
            table_name: column_pattern.findall(table_body)
            for table_name, table_body in table_pattern.findall(source)
        }

    ddl_tables = table_columns(ddl_text)
    alt_tables = table_columns(alt_text)
    alt_add_columns = {}
    for table_name, column_name in re.findall(
        r'ADD_COLUMN_IF_MISSING\(\s*\x27([^\x27]+)\x27\s*,\s*\x27([^\x27]+)\x27',
        alt_text,
        re.S
    ):
        alt_add_columns.setdefault(table_name, []).append(column_name)
    common_tables = sorted(set(ddl_tables) & set(alt_tables))
    if not common_tables:
        raise RuntimeError('INIT_SYSTEM_DDL.sql and INIT_SYSTEM_ALT.sql have no common table definitions.')
    for table_name in common_tables:
        if ddl_tables[table_name] != alt_tables[table_name]:
            raise RuntimeError(
                f'DDL/ALT column order mismatch for {table_name}: '
                f'{ddl_tables[table_name]} != {alt_tables[table_name]}'
            )
        if table_name in alt_add_columns and ddl_tables[table_name] != alt_add_columns[table_name]:
            raise RuntimeError(
                f'DDL/ALT ADD column order mismatch for {table_name}: '
                f'{ddl_tables[table_name]} != {alt_add_columns[table_name]}'
            )
    print(f'DDL/ALT migration contract OK: {len(common_tables)} tables')
"@
    & $venvPython -c $migrationContractCode
    if ($LASTEXITCODE -ne 0) {
        throw "DDL/ALT migration contract validation failed."
    }

    if (-not $SkipJavaScript) {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
        if (-not $nodeCommand) {
            Write-Warning "Node.js was not found. JavaScript syntax validation was skipped."
        }
        else {
            $javascriptFiles = @(
                Get-ChildItem -LiteralPath (Join-Path $repoRoot "frontend") -Filter "*.js" -File -Recurse
            )
            foreach ($javascriptFile in $javascriptFiles) {
                & $nodeCommand.Source --check $javascriptFile.FullName
                if ($LASTEXITCODE -ne 0) {
                    throw "JavaScript syntax validation failed: $($javascriptFile.FullName)"
                }
            }
            Write-Host "JavaScript syntax OK: $($javascriptFiles.Count) files" -ForegroundColor Green
        }
    }

    $cssFiles = @(
        Get-ChildItem -LiteralPath (Join-Path $repoRoot "frontend") -Filter "*.css" -File -Recurse
    )
    foreach ($cssFile in $cssFiles) {
        $cssSource = Get-Content -LiteralPath $cssFile.FullName -Raw -Encoding UTF8
        $openBraces = ([regex]::Matches($cssSource, "\{")).Count
        $closeBraces = ([regex]::Matches($cssSource, "\}")).Count
        if ($openBraces -ne $closeBraces) {
            throw "CSS brace validation failed: $($cssFile.FullName) ($openBraces/$closeBraces)"
        }
    }
    Write-Host "CSS braces OK: $($cssFiles.Count) files" -ForegroundColor Green

    Get-ChildItem -LiteralPath (Join-Path $repoRoot ".vscode") -Filter "*.json" -File |
        ForEach-Object {
            Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 |
                ConvertFrom-Json |
                Out-Null
        }
    Write-Host "VS Code JSON OK" -ForegroundColor Green

    $scriptParseErrors = @()
    Get-ChildItem -LiteralPath (Join-Path $repoRoot "scripts") -Filter "*.ps1" -File |
        ForEach-Object {
            $tokens = $null
            $parseErrors = $null
            [System.Management.Automation.Language.Parser]::ParseFile(
                $_.FullName,
                [ref]$tokens,
                [ref]$parseErrors
            ) | Out-Null
            $scriptParseErrors += $parseErrors
        }
    if ($scriptParseErrors.Count -gt 0) {
        $messages = $scriptParseErrors |
            ForEach-Object {
                "$($_.Extent.File):$($_.Extent.StartLineNumber): $($_.Message)"
            }
        throw "PowerShell syntax validation failed.`n$($messages -join [Environment]::NewLine)"
    }
    Write-Host "PowerShell syntax OK" -ForegroundColor Green

    Write-Host ""
    Write-Host "Source validation completed." -ForegroundColor Green
}
finally {
    Pop-Location
}
