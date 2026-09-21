@echo off
setlocal
title Experience Engine - Closer

echo ============================================
echo  Casino Experience Engine PoC - Closer
echo ============================================
echo.

echo Stopping services on ports 8000 and 3000...

REM Pass 1: close the launcher-spawned cmd /k shells by command line (works
REM whether the window host is conhost or Windows Terminal, where cmd.exe has
REM no window title) - tree-kill takes the whole server stack with each shell.
REM Pass 2+: free any port still listening (stray servers), also killing a
REM non-shell spawner (e.g. uvicorn reloader) so it cannot respawn.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $ports=@(8000,3000); $sigs=@('*python -m uvicorn main:app*','*npm run dev*'); for($pass=1;$pass -le 3;$pass++){ Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $cl=$_.CommandLine; $cl -and ($sigs | Where-Object { $cl -like $_ }) } | ForEach-Object { Write-Host ('[OK] Closing terminal shell PID ' + $_.ProcessId); taskkill /F /T /PID $_.ProcessId 2>&1 | Out-Null }; $busy=$false; foreach($port in $ports){ $conns=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if($conns){ $busy=$true; foreach($opid in ($conns.OwningProcess | Select-Object -Unique)){ Write-Host ('[OK] Terminating PID ' + $opid + ' on port ' + $port); taskkill /F /T /PID $opid 2>&1 | Out-Null; $ppid=(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $opid)).ParentProcessId; if($ppid){ $pp=Get-Process -Id $ppid -ErrorAction SilentlyContinue; if($pp -and ($pp.ProcessName -notin @('cmd','conhost','powershell','pwsh','WindowsTerminal','explorer'))){ Write-Host ('[OK] Terminating spawner PID ' + $ppid + ' (' + $pp.ProcessName + ')'); taskkill /F /PID $ppid 2>&1 | Out-Null } } } } else { Write-Host ('[INFO] Port ' + $port + ' is free.') } }; if(-not $busy){ break }; Start-Sleep -Seconds 1 }"

REM Supplementary fallback via netstat (for systems without Get-NetTCPConnection)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R ":8000\>" ^| findstr "LISTENING"') do (
    taskkill /F /T /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R ":3000\>" ^| findstr "LISTENING"') do (
    taskkill /F /T /PID %%a >nul 2>&1
)

echo.
echo All services stopped.

REM Automatically close this terminal window
exit
