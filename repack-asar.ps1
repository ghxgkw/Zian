$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$origAsar = Join-Path $root 'resources\app.asar.bak'   # original (source of truth)
$outAsar  = Join-Path $root 'resources\app.asar'
# 备份不存在时回退到现有 app.asar（先整读入内存再写回，安全）
if (-not (Test-Path $origAsar)) {
  $origAsar = $outAsar
  Write-Host 'app.asar.bak not found, fallback to app.asar'
}
$newCssPath = Join-Path $root 'resources\app.asar.unpacked\style.css'

$bytes = [System.IO.File]::ReadAllBytes($origAsar)

# ---- parse header (byte-exact) ----
$H = [BitConverter]::ToUInt32($bytes, 4)
$strLen = [BitConverter]::ToUInt32($bytes, 12)
$raw = New-Object byte[] $strLen
[Array]::Copy($bytes, 16, $raw, 0, $strLen)
$jsonStr = [System.Text.Encoding]::UTF8.GetString($raw).TrimEnd([char]0)
$jsonByteCount = [System.Text.Encoding]::UTF8.GetByteCount($jsonStr)
$files = $jsonStr | ConvertFrom-Json
$dataStart = 8 + $H
Write-Host "H=$H strLen=$strLen jsonByteCount=$jsonByteCount dataStart=$dataStart"

# ---- collect packed files ----
$packed = @{}
function Walk($node, $path) {
  if ($node.files) {
    foreach ($prop in $node.files.PSObject.Properties) {
      Walk $node.files.($prop.Name) "$path/$($prop.Name)"
    }
  } else {
    if (-not $node.unpacked) {
      $off = [int]$node.offset
      $sz = [int]$node.size
      $data = New-Object byte[] $sz
      [Array]::Copy($bytes, $dataStart + $off, $data, 0, $sz)
      $packed[$path] = @{ offset=$off; size=$sz; data=$data }
    }
  }
}
Walk $files ''
Write-Host "packed files: $($packed.Count)"

# ---- replace all root-level files from unpacked (newer versions) ----
$unpackedRoot = Join-Path $root 'resources\app.asar.unpacked'
$replaceList = @('index.html','main.js','package.json','preload.js','renderer.js','splash.html','style.css')
foreach ($name in $replaceList) {
  $src = Join-Path $unpackedRoot $name
  $key = "/$name"
  if ((Test-Path $src) -and $packed.ContainsKey($key)) {
    $b = [System.IO.File]::ReadAllBytes($src)
    $packed[$key].data = $b
    $packed[$key].size = $b.Length
    Write-Host "replaced $name size=$($b.Length)"
  }
}

# ---- rebuild data blob in original offset order ----
$sorted = $packed.GetEnumerator() | Sort-Object { $_.Value.offset }
$ms = New-Object System.IO.MemoryStream
$newOffsets = @{}
foreach ($e in $sorted) {
  $newOffsets[$e.Key] = $ms.Position
  $ms.Write($e.Value.data, 0, $e.Value.data.Length)
}
$dataBytes = $ms.ToArray()

# ---- update header tree ----
function UpdateNode($node, $path) {
  if ($node.files) {
    foreach ($prop in $node.files.PSObject.Properties) {
      UpdateNode $node.files.($prop.Name) "$path/$($prop.Name)"
    }
  } else {
    if (-not $node.unpacked -and $packed.ContainsKey($path)) {
      $node.size = $packed[$path].data.Length
      $node.offset = [string]$newOffsets[$path]
    }
  }
}
UpdateNode $files ''

# ---- serialize header ----
$newJson = $files | ConvertTo-Json -Depth 100 -Compress
$jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($newJson)
$jsonStrLen = $jsonBytes.Length
$Hnew = 8 + $jsonStrLen
$pad = (4 - ($Hnew % 4)) % 4
$Hnew += $pad
Write-Host "jsonBytes=$($jsonBytes.Length) jsonStrLen=$jsonStrLen Hnew=$Hnew pad=$pad"

# ---- write new asar ----
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([uint32]4)
$bw.Write([uint32]$Hnew)
$bw.Write([uint32]($Hnew - 4))
$bw.Write([uint32]$jsonStrLen)
$bw.Write($jsonBytes)
for ($i=0; $i -lt $pad; $i++) { $bw.Write([byte]0) }
$bw.Write($dataBytes)
$bw.Flush()

[System.IO.File]::WriteAllBytes($outAsar, $out.ToArray())
Write-Host "OK new asar size: $($out.Length)"
