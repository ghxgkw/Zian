$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$p = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.Path -and $_.Path -match 'win32-x64' -and $_.Path -like '*.exe'
} | Select-Object -First 1
if (-not $p) { Write-Host 'APP_NOT_RUNNING'; exit 1 }
$hwnd = $p.MainWindowHandle

Add-Type @"
using System; using System.Runtime.InteropServices;
public class Ck {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@

$x = [int]$args[0]
$y = [int]$args[1]
$l = [IntPtr](($y -band 0xFFFF) -shl 16 -bor ($x -band 0xFFFF))
# WM_MOUSEMOVE = 0x0200
[void][Ck]::SendMessage($hwnd, 0x0200, [IntPtr]0, $l)
Start-Sleep -Milliseconds 30
# WM_LBUTTONDOWN = 0x0201
[void][Ck]::SendMessage($hwnd, 0x0201, [IntPtr]0x0001, $l)
Start-Sleep -Milliseconds 60
# WM_LBUTTONUP = 0x0202
[void][Ck]::SendMessage($hwnd, 0x0202, [IntPtr]0, $l)
Write-Host ('clicked client ' + $x + ',' + $y)
