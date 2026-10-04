# dsh-remote helper window: topmost, positioned off-screen (invisible, blocks nothing)
# holds foreground so the taskbar button never keeps focus after minimizing the last window.
# Run with: powershell -STA -NoProfile -ExecutionPolicy Bypass -File helper.ps1
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $f = New-Object System.Windows.Forms.Form
  $f.Text = 'dsh-remote helper'
  $f.TopMost = $true
  $f.ShowInTaskbar = $false
  $f.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $f.MinimizeBox = $false
  $f.MaximizeBox = $false
  $f.StartPosition = 'Manual'
  $f.Location = New-Object System.Drawing.Point(-2000, -2000)
  $f.Size = New-Object System.Drawing.Size(200, 100)
  [System.Windows.Forms.Application]::Run($f)
} catch {
  try { Add-Content 'D:\dsh-helper-err.txt' ('helper err: ' + $_.Exception.Message) } catch {}
}
