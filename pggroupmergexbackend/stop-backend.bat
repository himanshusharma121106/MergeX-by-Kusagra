@echo off  
title Stop MergeX Backend  
echo Stopping backend...  
for /f \" "tokens=5\ %%%%a in ('netstat -aon | findstr :3000 | findstr LISTENING') do taskkill /F /PID %%%%a  
taskkill /F /IM node.exe  
if exist \C:\Users\Himanshu\AppData\Roaming\Microsoft\Windows\Start" "Menu\Programs\Startup\MergeX-Backend.lnk\ del /f /q \C:\Users\Himanshu\AppData\Roaming\Microsoft\Windows\Start" "Menu\Programs\Startup\MergeX-Backend.lnk\  
echo Backend stopped successfully!  
pause 
