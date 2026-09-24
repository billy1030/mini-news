@echo off
chcp 65001 >nul

echo Starting Mini-News Services...

cd /d "%~dp0"

where docker >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Ensuring PostgreSQL container is running on Port 5232...
    docker compose up -d
)

ping 127.0.0.1 -n 2 >nul

echo Starting Mini-News Node.js service on port 5200...
start "Mini-News Service" cmd /k "title Mini-News Service & npm run dev"

echo Mini-News started successfully!
echo Web Dashboard: http://localhost:5200
echo Database: localhost:5232
echo To stop, run stop.bat
