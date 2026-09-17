@echo off
title FiscalGuard PT - Contabilista & Sentinela Pessoal
color 0B

echo =======================================================
echo    FISCALGUARD PT - O Teu Contabilista Pessoal
echo    Financas, Seguranca Social, e-fatura & Multi-Device
echo =======================================================
echo.
echo [1/2] A iniciar o servidor e motor de sincronizacao...
start http://localhost:4848

node server.js
pause
