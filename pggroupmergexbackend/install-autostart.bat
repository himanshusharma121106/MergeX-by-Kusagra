@echo off
title Setup MergeX Silent Background & AutoStart Service
color 0a

cd /d "%~dp0"

echo ========================================================
echo       MERGEX - SILENT BACKGROUND & AUTOSTART SETUP
echo ========================================================
echo Backend Directory: %CD%
echo.

:: 1. Verify Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0c
    echo [ERROR] Node.js is not installed on this computer!
    echo Please download and install Node.js from https://nodejs.org first.
    echo.
    pause
    exit /b 1
)

:: 2. Auto-create run-silent.vbs in backend folder
echo [1/3] Generating silent runner script...
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo Set fso = CreateObject("Scripting.FileSystemObject"^)
echo strPath = "%CD%"
echo WshShell.CurrentDirectory = strPath
echo WshShell.Run "cmd /c """ ^& strPath ^& "\start-backend.bat""", 0, False
echo Set WshShell = Nothing
echo Set fso = Nothing
) > "%CD%\run-silent.vbs"

:: 3. Register to Windows Startup folder (Runs silently whenever PC boots)
echo [2/3] Adding to Windows Startup Apps...
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if exist "%STARTUP_FOLDER%" (
    (
    echo Set WshShell = CreateObject("WScript.Shell"^)
    echo strPath = "%CD%"
    echo WshShell.CurrentDirectory = strPath
    echo WshShell.Run "cmd /c """ ^& strPath ^& "\start-backend.bat""", 0, False
    echo Set WshShell = Nothing
    ) > "%STARTUP_FOLDER%\MergeX-Printer-Proxy.vbs"
    echo [OK] Successfully registered in Windows Startup Apps!
) else (
    echo [WARNING] Startup folder not found, skipping startup shortcut.
)

:: 4. Start the backend silently right now
echo [3/3] Starting backend silently in the background...
wscript.exe "%CD%\run-silent.vbs"

echo.
echo ========================================================
echo   [SUCCESS] SETUP COMPLETED!
echo.
echo   1. Backend is now running SILENTLY in the background
echo      (No black CMD window will appear).
echo.
echo   2. It has been added to Windows Startup Apps:
echo      Computer restart hone par yeh khud ba khud chalega.
echo.
echo   3. BarTender labels can now be printed from web app.
echo ========================================================
echo.
pause
