@echo off
title Install DSH Remote Unlock Service (v12 - real service)
echo ==============================================
echo   Install DSH Remote Unlock Service (SYSTEM)
echo ==============================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

whoami /groups | findstr /C:"S-1-16-12288" >nul
if errorlevel 1 ( echo WARN: not HIGH integrity ) else ( echo INFO: HIGH integrity confirmed )

echo [0/4] Cleaning old service/processes...
sc.exe stop DSHRemoteUnlock >nul 2>&1
sc.exe delete DSHRemoteUnlock >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'dsh-unlock' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 2 >nul

echo [1/4] Copying exe to C:\Windows\System32...
copy /Y "%~dp0dsh-unlock-svc.exe" "C:\Windows\System32\dsh-unlock-svc.exe" >nul
copy /Y "%~dp0dsh-unlock-helper.exe" "C:\Windows\System32\dsh-unlock-helper.exe" >nul
if not exist "C:\Windows\System32\dsh-unlock-helper.exe" (
  echo WARN: helper copy failed
)
if not exist "C:\Windows\System32\dsh-unlock-svc.exe" (
  echo ERROR: copy failed
  pause
  exit /b 1
)
echo       ok

echo [2/4] Creating service (LocalSystem, auto start)...
sc.exe create DSHRemoteUnlock binPath= "C:\Windows\System32\dsh-unlock-svc.exe" start= auto
if errorlevel 1 (
  echo ERROR: service create failed
  pause
  exit /b 1
)
sc.exe description DSHRemoteUnlock "DSH Remote: unlock the locked session for remote control"

echo [3/4] Starting service...
sc.exe start DSHRemoteUnlock
timeout /t 3 >nul

echo [4/4] Verifying...
sc.exe query DSHRemoteUnlock | findstr /I "STATE"
powershell -NoProfile -Command "Get-Process -Name dsh-unlock-svc -ErrorAction SilentlyContinue | Select-Object Id | Format-Table -AutoSize | Out-String"
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 5 -and -not $ok;$i++){ try { $c = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dsh-remote-unlock', [System.IO.Pipes.PipeDirection]::InOut); $c.Connect(2000); $w = New-Object System.IO.StreamWriter($c); $r = New-Object System.IO.StreamReader($c); $w.AutoFlush = $true; $w.WriteLine('state'); Write-Host ('pipe test: ' + $r.ReadLine()); $c.Close(); $ok=$true } catch { Start-Sleep 2 } }; if(-not $ok){ Write-Host 'pipe test: FAIL after retries' }"

echo.
echo ==============================================
echo   DONE! Unlock service installed and started.
echo ==============================================
echo.
pause
