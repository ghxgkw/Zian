param([Parameter(Mandatory=$true)][int]$ProcessId, [string]$Out = 'ui.png')
$ErrorActionPreference = 'Stop'
$p = Get-Process -Id $ProcessId
$hwnd = $p.MainWindowHandle
if ($hwnd -eq 0) { Write-Host 'NO_WINDOW'; exit 1 }
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Drawing;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
$cr = New-Object WinCap+RECT
[void][WinCap]::GetClientRect($hwnd, [ref]$cr)
$w = $cr.R - $cr.L; $hgt = $cr.B - $cr.T
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[void][WinCap]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$outPath = [System.IO.Path]::GetFullPath($Out)
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("saved {0} {1}x{2} {3} bytes" -f $outPath,$w,$hgt,(Get-Item -LiteralPath $outPath).Length)
