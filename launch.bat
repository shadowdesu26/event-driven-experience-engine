@echo off
setlocal
title Experience Engine - Launcher

set "ROOT=%~dp0"

echo ============================================
echo  Casino Experience Engine PoC - Launcher
echo ============================================
echo.

if not exist "%ROOT%middleware\main.py" (
    echo [ERROR] middleware\main.py not found under "%ROOT%".
    pause
    exit /b 1
)
if not exist "%ROOT%frontend\package.json" (
    echo [ERROR] frontend\package.json not found under "%ROOT%".
    pause
    exit /b 1
)

echo [1/3] Starting Experience Engine Middleware on http://127.0.0.1:8000 ...
start "Experience Engine - Middleware" /D "%ROOT%middleware" cmd /k python -m uvicorn main:app --reload --port 8000

echo [2/3] Starting Next.js Presentation Frontend on http://localhost:3000 ...
start "Experience Engine - Frontend" /D "%ROOT%frontend" cmd /k npm run dev

echo [3/3] Waiting for services to boot before opening the dashboard ...
timeout /t 6 /nobreak >nul
start "" http://localhost:3000

echo.
echo Experience Engine launched.
echo  - Middleware window: "Experience Engine - Middleware"
echo  - Frontend window  : "Experience Engine - Frontend"
echo Run close.bat to stop everything.
echo.
echo This window can be closed safely.
timeout /t 8 >nul
endlocal
