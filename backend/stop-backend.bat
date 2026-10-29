@echo off
title Stop MergeX Backend Service
color 0e

echo ========================================================
echo       MERGEX - STOP BACKEND SERVICE
echo ========================================================
echo.
echo Stopping any running backend processes on port 3000...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo Freeing port 3000 (Killing PID %%a)...
    taskkill /F /PID %%a >nul 2>nul
)

taskkill /F /IM node.exe >nul 2>nul

echo.
echo [OK] Backend service has been completely stopped.
echo ========================================================
echo.
pause
