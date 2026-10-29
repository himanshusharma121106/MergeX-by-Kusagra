@echo off
title MergeX Backend Printer Service
color 0a

:: Always switch to the directory where this .bat file is placed
cd /d "%~dp0"

echo ========================================================
echo       MERGEX - LOCAL BACKEND AND BARTENDER PRINTER PROXY
echo ========================================================
echo Working Directory: %CD%

:: 1. Free Port 3000 if already in use by another instance
echo Checking port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo [INFO] Port 3000 was busy. Releasing port 3000 (Closing PID %%a)...
    taskkill /F /PID %%a >nul 2>nul
)

:: 2. Auto-detect BarTender Label Template (.btw)
if exist "%CD%\Templatee.btw" (
    set "BARTENDER_LABEL_PATH=%CD%\Templatee.btw"
) else if exist "%CD%\Template.btw" (
    set "BARTENDER_LABEL_PATH=%CD%\Template.btw"
) else if exist "C:\Labels\Templatee.btw" (
    set "BARTENDER_LABEL_PATH=C:\Labels\Templatee.btw"
) else if exist "C:\Labels\Template.btw" (
    set "BARTENDER_LABEL_PATH=C:\Labels\Template.btw"
) else if exist "C:\Users\idu line\Documents\Labels\Templatee.btw" (
    set "BARTENDER_LABEL_PATH=C:\Users\idu line\Documents\Labels\Templatee.btw"
) else if exist "C:\Users\%USERNAME%\Documents\Labels\Templatee.btw" (
    set "BARTENDER_LABEL_PATH=C:\Users\%USERNAME%\Documents\Labels\Templatee.btw"
) else (
    set "BARTENDER_LABEL_PATH=C:\Labels\Templatee.btw"
)

:: 3. Auto-detect BarTender Executable (bartend.exe)
if exist "C:\Program Files\Seagull\BarTender 2022\bartend.exe" (
    set "BARTENDER_EXE_PATH=C:\Program Files\Seagull\BarTender 2022\bartend.exe"
) else if exist "C:\Program Files\Seagull\BarTender Suite\bartend.exe" (
    set "BARTENDER_EXE_PATH=C:\Program Files\Seagull\BarTender Suite\bartend.exe"
) else if exist "C:\Program Files\Seagull\BarTender 2021\bartend.exe" (
    set "BARTENDER_EXE_PATH=C:\Program Files\Seagull\BarTender 2021\bartend.exe"
) else (
    set "BARTENDER_EXE_PATH=bartend.exe"
)

echo Label Template   : %BARTENDER_LABEL_PATH%
echo BarTender Exe    : %BARTENDER_EXE_PATH%
echo.

:: 4. Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0c
    echo [ERROR] Node.js is not installed on this computer!
    echo Please download and install Node.js from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 5. Verify Label Template Exists
if not exist "%BARTENDER_LABEL_PATH%" (
    echo [WARNING] Label template file not found at:
    echo "%BARTENDER_LABEL_PATH%"
    echo Please ensure your .btw file is placed in this location or in the current folder.
    echo.
)

:: 6. Auto install node_modules if missing
if not exist "node_modules\" (
    echo [INFO] First time setup: Installing dependencies...
    cmd /c npm install --omit=dev
    if %ERRORLEVEL% NEQ 0 (
        color 0c
        echo [ERROR] Failed to install npm dependencies.
        pause
        exit /b 1
    )
)

echo [OK] Starting Server on http://localhost:3000...
echo Keep this window OPEN while printing BarTender labels.
echo ========================================================
echo.
node server.js

if %ERRORLEVEL% NEQ 0 (
    color 0c
    echo.
    echo [ERROR] Backend server stopped unexpectedly.
    pause
)
