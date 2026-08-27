@echo off
echo ============================================
echo  PC Builder - Starting Server
echo ============================================
echo.
echo Server will start at: http://localhost:3001
echo Press Ctrl+C to stop the server.
echo.
cd /d "%~dp0"
node backend/server.js
pause
