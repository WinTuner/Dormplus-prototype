@echo off
rem PAKDEE prototype - start the local server and open the browser
cd /d "%~dp0"

echo Starting PAKDEE demo server...
start "PAKDEE server" cmd /k "python server.py"
timeout /t 2 >nul
start "" "http://127.0.0.1:8777"
exit
