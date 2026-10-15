$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$targets = Invoke-RestMethod -Uri 'http://localhost:9222/json' -TimeoutSec 5
$page = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
$wsUrl = $page.webSocketDebuggerUrl

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$cts = New-Object System.Threading.CancellationTokenSource(15000)
$ws.ConnectAsync([Uri]$wsUrl, $cts.Token).Wait()

$payload = @{
  id = 1
  method = 'Page.captureScreenshot'
  params = @{ format = 'png' }
} | ConvertTo-Json -Depth 5 -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$seg = New-Object System.ArraySegment[byte] $bytes, 0, $bytes.Length
$ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).Wait()

$buf = New-Object byte[] 16000000
$recvSeg = New-Object System.ArraySegment[byte] $buf, 0, $buf.Length
$ms = New-Object System.IO.MemoryStream
do {
  $res = $ws.ReceiveAsync($recvSeg, $cts.Token).Result
  $ms.Write($buf, 0, $res.Count)
} while (-not $res.EndOfMessage)
$respStr = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
$resp = $respStr | ConvertFrom-Json
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $cts.Token).Wait()

if ($resp.result.data) {
  $pngBytes = [Convert]::FromBase64String($resp.result.data)
  $out = Join-Path $root 'shot.png'
  [System.IO.File]::WriteAllBytes($out, $pngBytes)
  Write-Host ('saved ' + $out + ' ' + $pngBytes.Length + ' bytes')
} else {
  Write-Host 'ERR'
}
