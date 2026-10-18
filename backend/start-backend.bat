@echo off
title MergeX Backend Service
cd /d "%~dp0"
echo Starting MergeX Backend Server on port 3000...
node server.js
pause
