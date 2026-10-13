@echo off
title MyBestDB - Servidor (cierra esta ventana para apagarlo)
cd /d "%~dp0"

REM Si el servidor ya esta corriendo, solo abre el navegador
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
    start "" http://localhost:3000
    exit /b
)

REM Abre el navegador cuando el servidor responda (en segundo plano)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 30;$i++){try{Invoke-WebRequest http://localhost:3000 -UseBasicParsing -TimeoutSec 1 | Out-Null; break}catch{Start-Sleep 1}}; Start-Process 'http://localhost:3000'"

echo Iniciando MyBestDB en http://localhost:3000 ...
echo Para apagar el servidor, cierra esta ventana.
echo.
npm start
pause
