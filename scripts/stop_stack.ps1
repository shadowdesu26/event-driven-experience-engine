# Experience Engine shutdown — called by close.bat.
#
# Sweeps both launcher-picked ports (ee_middleware_port.txt / ee_frontend_port.txt
# under %TEMP%, written by launch.bat), the whole picked ranges as a safety net,
# and the legacy 8000/3000. Kills the launcher-spawned cmd shells by command-line
# signature first so one tree-kill takes each server stack with its shell.
$ErrorActionPreference = "SilentlyContinue"

function PickPort($file, $fallback) {
    $p = $fallback
    if (Test-Path $file) {
        $t = (Get-Content $file -Raw).Trim()
        $v = 0
        if ([int]::TryParse($t, [ref]$v) -and $v -gt 1024 -and $v -lt 65536) {
            $p = $v
        }
    }
    return $p
}

$mwPort = PickPort "$env:TEMP\ee_middleware_port.txt" 39107
$fePort = PickPort "$env:TEMP\ee_frontend_port.txt" 39731

$ports = @($mwPort, $fePort, 39107, 39108, 39109, 39110, 39731, 39732, 39733, 39734, 8000, 3000)
$sigs  = @("*python -m uvicorn main:app*", "*npm run dev*")

for ($pass = 1; $pass -le 3; $pass++) {
    # Pass A: close launcher-spawned cmd shells by command line (works whether
    # the host is conhost or Windows Terminal) - tree-kill takes the stack.
    Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
        Where-Object { $cl = $_.CommandLine; $cl -and ($sigs | Where-Object { $cl -like $_ }) } |
        ForEach-Object {
            Write-Host ("[OK] Closing terminal shell PID " + $_.ProcessId)
            taskkill /F /T /PID $_.ProcessId 2>&1 | Out-Null
        }

    # Pass B: free any port still listening (stray servers); also kill a
    # non-shell spawner (e.g. a uvicorn reloader) so it cannot respawn.
    $busy = $false
    foreach ($port in $ports) {
        if ($port -le 1024 -or $port -ge 65536) { continue }

        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            $busy = $true
            foreach ($opid in ($conns.OwningProcess | Select-Object -Unique)) {
                Write-Host ("[OK] Terminating PID " + $opid + " on port " + $port)
                taskkill /F /T /PID $opid 2>&1 | Out-Null
                $ppid = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $opid)).ParentProcessId
                if ($ppid) {
                    $pp = Get-Process -Id $ppid -ErrorAction SilentlyContinue
                    if ($pp -and ($pp.ProcessName -notin @("cmd", "conhost", "powershell", "pwsh", "WindowsTerminal", "explorer"))) {
                        if ($pp.CommandLine -and $sigs | Where-Object { $pp.CommandLine -like $_ }) {
                            Write-Host ("[OK] Terminating orphan manager PID " + $ppid + " (" + $pp.ProcessName + ")")
                            taskkill /F /PID $ppid 2>&1 | Out-Null
                        }
                    }
                }
            }
        } else {
            Write-Host ("[INFO] Port " + $port + " is free.")
        }
    }

    if (-not $busy) { break }
    Start-Sleep -Seconds 1
}
