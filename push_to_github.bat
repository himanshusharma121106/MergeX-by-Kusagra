@echo off
title Push MergeX to GitHub
color 0b
cd /d "%~dp0"

echo ========================================================
echo       MERGEX - PUSH TO GITHUB REPOSITORY
echo ========================================================
echo.

echo [1/3] Checking current branch status...
git status --short
echo.

echo [2/3] Staging all files and committing...
git add .
git commit -m "update: automated commit from push_to_github.bat" 2>nul
echo.

echo [3/3] Pushing to GitHub (origin main)...
echo (Agar GitHub login popup aaye toh 'Sign in' / 'Authorize' kar dijiye)
echo.
git push origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   [SUCCESS] Code pushed to GitHub successfully!
    echo   Netlify ab automatic deployment start kar dega.
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo   [ERROR] Push nahi ho paya.
    echo   Kripya internet check karein ya GitHub login confirm karein.
    echo ========================================================
)

echo.
pause
