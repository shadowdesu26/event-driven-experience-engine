@echo off
setlocal
title Experience Engine - Closer

echo ============================================
echo  Casino Experience Engine PoC - Closer
echo ============================================
echo.

echo Stopping services on ports 39107+ / 39731+ and legacy 8000/3000...

REM The launcher picks both ports at runtime (written to %%TEMP%%\ee_middleware_port.txt
REM and ee_frontend_port.txt); the sweep reads both files plus the picked ranges
REM as a safety net, then the legacy 8000/3000.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_stack.ps1"

echo.
echo All services stopped.

REM Automatically close this terminal window
exit
