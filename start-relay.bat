@echo off
title GasGuard Relay Server
cd /d "%~dp0relay-server"

echo Starting GasGuard relay server...
start "GasGuard-Node" /min "C:\Program Files\nodejs\node.exe" server.js

timeout /t 3 /nobreak >nul

echo Starting Cloudflare tunnel...
start "GasGuard-Tunnel" /min "%TEMP%\cloudflared.exe" tunnel --url http://localhost:3000 --no-autoupdate

echo.
echo GasGuard relay is running.
echo Check the "GasGuard-Tunnel" window for the public HTTPS URL.
echo Update RELAY_SERVER_URL in the .ino if the URL changed.
timeout /t 5
