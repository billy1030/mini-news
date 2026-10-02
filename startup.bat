@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

echo Starting Mini-News Services...

cd /d "%~dp0"

where docker >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Checking Docker daemon status...
    docker info >nul 2>&1
    if errorlevel 1 (
        echo Docker daemon is not running. Checking Docker Desktop...
        tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>nul | find /I /N "Docker Desktop.exe" >nul
        if errorlevel 1 (
            echo Launching Docker Desktop...
            set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
            if not exist "!DOCKER_EXE!" set "DOCKER_EXE=%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe"
            if exist "!DOCKER_EXE!" (
                start "" "!DOCKER_EXE!"
            ) else (
                echo [WARNING] Could not find Docker Desktop.exe. Please start Docker manually.
            )
        ) else (
            echo Docker Desktop is launching, waiting for daemon to be ready...
        )

        echo Waiting for Docker daemon to initialize...
        set /a retries=60
        :wait_docker
        docker info >nul 2>&1
        if errorlevel 1 (
            set /a retries-=1
            if !retries! leq 0 (
                echo.
                echo [ERROR] Timed out waiting for Docker daemon.
                pause
                exit /b 1
            )
            <nul set /p=.
            timeout /t 2 /nobreak >nul
            goto :wait_docker
        )
        echo.
        echo Docker daemon is ready!
    )
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
