$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Get the page target
$targets = Invoke-RestMethod -Uri 'http://localhost:9222/json' -TimeoutSec 5
$page = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
if (-not $page) { Write-Host 'NO_PAGE'; exit 1 }

$wsUrl = $page.webSocketDebuggerUrl
$js = $args -join ' '
if (-not $js) { Write-Host 'NO_JS'; exit 1 }

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(5)
$cts = New-Object System.Threading.CancellationTokenSource(15000)
$ws.ConnectAsync([Uri]$wsUrl, $cts.Token).Wait()

# Send Runtime.evaluate
$payload = @{
  id = 1
  method = 'Runtime.evaluate'
  params = @{
    expression = $js
    returnByValue = $true
    awaitPromise = $true
  }
} | ConvertTo-Json -Depth 10 -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$seg = New-Object System.ArraySegment[byte] $bytes, 0, $bytes.Length
$ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).Wait()

# Read response
$buf = New-Object byte[] 262144
$recvSeg = New-Object System.ArraySegment[byte] $buf, 0, $buf.Length
$res = $ws.ReceiveAsync($recvSeg, $cts.Token).Result
$respStr = [System.Text.Encoding]::UTF8.GetString($buf, 0, $res.Count)

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $cts.Token).Wait()

$resp = $respStr | ConvertFrom-Json
if ($resp.result.result.value) {
  Write-Host $resp.result.result.value
} elseif ($resp.result.result.type -eq 'undefined') {
  Write-Host 'undefined'
} else {
  Write-Host ($resp.result.result | ConvertTo-Json -Depth 5 -Compress)
}
