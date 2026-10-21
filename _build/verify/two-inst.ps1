$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$exe = Get-ChildItem -Path $root -Filter '*.exe' -File | Where-Object { $_.Extension -eq '.exe' } | Select-Object -First 1
if ($null -eq $exe) { Write-Output 'ABORT: exe not found'; exit 1 }
$full = $exe.FullName
Write-Output ('exe=' + $exe.Name + '  size=' + $exe.Length)
Get-Process | Where-Object { $_.Path -eq $full } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$a = Start-Process -FilePath $full -WorkingDirectory $root -PassThru
Start-Sleep -Seconds 9
$b = Start-Process -FilePath $full -WorkingDirectory $root -PassThru
Start-Sleep -Seconds 10
Write-Output ('A exited=' + $a.HasExited + '  B exited=' + $b.HasExited)
$alive = Get-Process | Where-Object { $_.Path -eq $full }
Write-Output ('live processes=' + ($alive | Measure-Object).Count)
$wins = $alive | Where-Object { $_.MainWindowTitle -ne '' }
Write-Output ('windows with title=' + ($wins | Measure-Object).Count)
$wins | ForEach-Object { Write-Output ('  pid=' + $_.Id + ' title=' + $_.MainWindowTitle) }
Get-Process | Where-Object { $_.Path -eq $full } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output 'cleaned'