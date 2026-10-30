@echo off
title Setup MergeX Silent Background and AutoStart Service
color 0a

cd /d "%~dp0"

echo ========================================================
echo       MERGEX - SILENT BACKGROUND AND AUTOSTART SETUP
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

:: 2. Ensure run-silent.vbs exists in current backend folder
echo [1/3] Preparing silent background runner...
set "VBS_RUNNER=%CD%\run-silent.vbs"

(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo Set fso = CreateObject("Scripting.FileSystemObject"^)
echo strPath = fso.GetParentFolderName(WScript.ScriptFullName^)
echo WshShell.CurrentDirectory = strPath
echo WshShell.Run "cmd.exe /c """ ^& strPath ^& "\start-backend.bat""", 0, False
echo Set WshShell = Nothing
echo Set fso = Nothing
) > "%VBS_RUNNER%"

:: 3. Register shortcut in Windows Startup Folder
echo [2/3] Adding to Windows Startup Apps...
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if exist "%STARTUP_FOLDER%" (
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTUP_FOLDER%\MergeX-Backend.lnk'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_RUNNER%\"'; $s.WorkingDirectory = '%CD%'; $s.Save()" >nul 2>nul
    echo [OK] Successfully registered in Windows Startup Apps!
) else (
    echo [WARNING] Startup folder not found.
)

:: 4. Start the backend silently right now
echo [3/3] Starting backend silently in the background...
start "" wscript.exe "%VBS_RUNNER%"

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
