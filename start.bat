@echo off
title FiscalGuard PT - Sentinel
cd /d "%~dp0"
echo A iniciar FiscalGuard PT...
start "" http://localhost:4848
node server.js
pause
