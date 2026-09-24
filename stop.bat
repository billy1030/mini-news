@echo off
chcp 65001 >nul

echo ========================================================
echo           Stopping Mini-News Services
echo ========================================================

cd /d "%~dp0"

REM 1. Terminate Mini-News Service window/processes
echo [1/2] Terminating Mini-News Node.js processes...
taskkill /FI "WINDOWTITLE eq Mini-News Service*" /T /F >nul 2>&1

REM Also kill any remaining processes listening on port 5200 (Mini-News Web)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5200" ^| findstr "LISTENING"') do (
    echo Stopping process on port 5200 (PID: %%a)...
    taskkill /PID %%a /F /T >nul 2>&1
)

REM 2. Stop Docker Compose (PostgreSQL)
where docker >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [2/2] Stopping Docker containers...
    docker compose stop
) else (
    echo [2/2] Docker not detected. Skipping docker compose stop.
)

echo.
echo ========================================================
echo Mini-News services have been stopped.
echo ========================================================
