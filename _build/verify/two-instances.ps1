$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
$exe = @(Get-ChildItem -Path $root -Filter '*.exe' -File | Where-Object { $_.Length -gt 10000000 })[0].FullName
Write-Output ("EXE " + [System.IO.Path]::GetFileName($exe))
$log = Join-Path $root 'Log\zian.log'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
function Probe {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root) })
}
$before = Probe
Write-Output ("PRE_RUNNING " + $before.Count)
if ($before.Count -gt 0) { $before | Stop-Process -Force; Start-Sleep -Seconds 2 }
$logLinesBefore = 0
if (Test-Path $log) { $logLinesBefore = (Get-Content $log).Count }
$p1 = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 5
$p2 = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 10
$all = Probe
$wins = @($all | Where-Object { $_.MainWindowHandle -ne 0 })
Write-Output ("PROC_TOTAL " + $all.Count)
foreach ($w in $wins) { Write-Output ("WIN id=" + $w.Id + " title=" + $w.MainWindowTitle) }
Write-Output ("WIN_COUNT " + $wins.Count)
Write-Output ("ALIVE_P1 " + (-not $p1.HasExited) + " ALIVE_P2 " + (-not $p2.HasExited))
if (Test-Path $log) {
  $lines = @(Get-Content $log)
  $from = [Math]::Min($logLinesBefore, [Math]::Max(0, $lines.Count - 1))
  $newLines = @($lines[$from..($lines.Count - 1)])
  $starts = @($newLines | Where-Object { $_ -like '*===*' -and $_ -like '*win32*' -or $_ -like '*=====*' })
  Write-Output ("LOG_STARTUP_LINES " + $starts.Count)
  foreach ($l in @($newLines | Select-Object -Last 8)) { Write-Output ("LOG " + $l) }
}
$all | Stop-Process -Force
Start-Sleep -Seconds 2
Write-Output ("AFTER_KILL " + (Probe).Count)
