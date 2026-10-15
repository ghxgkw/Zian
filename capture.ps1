$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
# Find app process by path marker (avoids Chinese chars in source)
$p = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.Path -and $_.Path -match 'win32-x64' -and $_.Path -like '*.exe'
} | Select-Object -First 1
if (-not $p) { Write-Host 'APP_NOT_RUNNING'; exit 1 }
$hwnd = $p.MainWindowHandle
Write-Host ('hwnd=' + $hwnd)

Add-Type @"
using System; using System.Runtime.InteropServices; using System.Drawing;
public class Win {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@

$cr = New-Object Win+RECT
[void][Win]::GetClientRect($hwnd, [ref]$cr)
$w = $cr.R - $cr.L; $hgt = $cr.B - $cr.T
Write-Host ('client ' + $w + 'x' + $hgt)

$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[void][Win]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$out = Join-Path $root 'cap.png'
$bmp.Save($out)
Write-Host ('saved ' + $out)
