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

rem Pick a middleware port in the upper unassigned range (39107) that ordinary
rem dev tools do not grab "normally". If it happens to be busy, walk up one port
rem at a time until a free one is found, write the winner to
rem %TEMP%\ee_middleware_port.txt, and remember it for close.bat.
set "MW_PORT=39107"
:find_free_port
if %MW_PORT% GEQ 39200 (
    echo [ERROR] No free port found in 39107-39199.
    pause
    exit /b 1
)
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %MW_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
    set /a MW_PORT+=1
    goto find_free_port
)
rem NOTE: group the echo so cmd cannot misread the trailing port digit as a
rem redirect descriptor ("echo 39107>" corrupts the file!).
(echo %MW_PORT%)> "%TEMP%\ee_middleware_port.txt"

rem Same treatment for the frontend: 39731 is right beside the middleware base,
rem so both ports live in the dynamic range no ordinary terminal tool claims.
set "FE_PORT=39731"
:find_free_fe_port
if %FE_PORT% GEQ 39800 (
    echo [ERROR] No free port found in 39731-39799.
    pause
    exit /b 1
)
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %FE_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
    set /a FE_PORT+=1
    goto find_free_fe_port
)
(echo %FE_PORT%)> "%TEMP%\ee_frontend_port.txt"

echo [1/3] Starting Experience Engine Middleware on http://127.0.0.1:%MW_PORT% ...
start "Experience Engine - Middleware" /D "%ROOT%middleware" cmd /k python -m uvicorn main:app --port %MW_PORT%

echo [2/3] Starting Next.js Presentation Frontend on http://localhost:%FE_PORT% ...
rem ENGINE_URL points the frontend's /api rewrites at the local Python engine.
rem Without it, the built-in TypeScript engine under app/api/ serves instead.
set "ENGINE_URL=http://127.0.0.1:%MW_PORT%"
start "Experience Engine - Frontend" /D "%ROOT%frontend" cmd /k npm run dev -- -p %FE_PORT%

echo [3/3] Waiting for services to boot before opening the dashboard ...
timeout /t 6 /nobreak >nul
start "" http://localhost:%FE_PORT%

echo.
echo Experience Engine launched.
echo  - Middleware window: "Experience Engine - Middleware"  (port %MW_PORT%)
echo  - Frontend window  : "Experience Engine - Frontend"    (port %FE_PORT%)
echo Run close.bat to stop everything.
echo.
echo This window can be closed safely.
timeout /t 8 >nul
endlocal
