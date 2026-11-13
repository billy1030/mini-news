# PowerShell Script to Synchronize Mini-News Ports across Loop-Engg and Mini-News
param (
    [string]$LoopEnggDir = "C:\ai\loop-engg",
    [int]$DbPort = 5232,
    [int]$WebPort = 5200
)

Write-Host "=== Syncing Mini-News Configurations to Port Web: $WebPort, DB: $DbPort ===" -ForegroundColor Cyan

if (-not (Test-Path $LoopEnggDir)) {
    Write-Warning "Directory $LoopEnggDir not found!"
    exit 1
}

# Target files in loop-engg
$targetFiles = @(
    "$LoopEnggDir\minibot.config.json",
    "$LoopEnggDir\loop.config.json",
    "$LoopEnggDir\config\dynamic-mcp.json",
    "$LoopEnggDir\config\users\00000\mcp.json"
)

# Also include workspace mcp files
$workspaceMcpFiles = Get-ChildItem -Path "$LoopEnggDir\logs" -Filter "mcp.json" -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$targetFiles += $workspaceMcpFiles

foreach ($file in ($targetFiles | Select-Object -Unique)) {
    if (Test-Path $file) {
        $content = Get-Content -Raw -Encoding UTF8 $file
        $changed = $false

        # Replace any 15232 or other ports in mini-news database connection string
        if ($content -match 'localhost:(\d+)/mini_news') {
            $currentPort = $matches[1]
            if ($currentPort -ne [string]$DbPort) {
                $content = $content -replace "localhost:$currentPort/mini_news", "localhost:$DbPort/mini_news"
                $changed = $true
            }
        }

        # Replace web port if present
        if ($content -match 'localhost:15200') {
            $content = $content -replace 'localhost:15200', "localhost:$WebPort"
            $changed = $true
        }

        if ($changed) {
            # Backup original file
            $backupPath = "$file.bak_" + (Get-Date -Format "yyyyMMdd_HHmmss")
            Copy-Item $file $backupPath -Force
            [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
            Write-Host "Updated: $file (Backup: $backupPath)" -ForegroundColor Green
        } else {
            Write-Host "Unchanged: $file" -ForegroundColor DarkGray
        }
    }
}

Write-Host "Sync completed successfully!" -ForegroundColor Green
