param(
    [Parameter(Mandatory=$true)][string]$Md,
    [Parameter(Mandatory=$true)][string]$Template,
    [string]$OutPath = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$FONT = ([string]([char]0x5FAE)) + ([string]([char]0x8F6F)) + ([string]([char]0x96C5)) + ([string]([char]0x9ED1))

function Esc([string]$s) {
    if ($null -eq $s) { return '' }
    return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')
}
function DispLen([string]$s) {
    $n = 0
    foreach ($ch in $s.ToCharArray()) { if ([int]$ch -gt 0x2000) { $n += 2 } else { $n += 1 } }
    return $n
}
function SplitCells([string]$line) {
    $t = $line.Trim()
    if ($t.StartsWith('|')) { $t = $t.Substring(1) }
    if ($t.EndsWith('|')) { $t = $t.Substring(0, $t.Length - 1) }
    $cells = New-Object System.Collections.ArrayList
    $buf = ''
    $inCode = $false
    foreach ($ch in $t.ToCharArray()) {
        if ($ch -eq '`') { $inCode = -not $inCode; $buf += $ch; continue }
        if ($ch -eq '|' -and -not $inCode) { [void]$cells.Add($buf.Trim()); $buf = ''; continue }
        $buf += $ch
    }
    [void]$cells.Add($buf.Trim())
    return $cells
}
function StripMd([string]$s) { return $s.Replace('**', '').Replace('`', '') }

$RF = '<w:rFonts w:ascii="' + $FONT + '" w:eastAsia="' + $FONT + '" w:hAnsi="' + $FONT + '" w:hint="eastAsia"/>'
$RF_CODE = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="' + $FONT + '" w:hint="eastAsia"/>'
$RPR_BODY = '<w:rPr>' + $RF + '<w:color w:val="1A1A2E"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>'
$RPR_BOLD = '<w:rPr><w:rStyle w:val="a5"/>' + $RF + '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>'
$RPR_CODE = '<w:rPr><w:rStyle w:val="HTML"/>' + $RF_CODE + '<w:color w:val="1A1A2E"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
$RPR_BOLDCODE = '<w:rPr><w:rStyle w:val="a5"/>' + $RF_CODE + '<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
$RPR_CELL = '<w:rPr>' + $RF + '<w:color w:val="1A1A2E"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
$RPR_CELLH = '<w:rPr>' + $RF + '<w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
$RPR_CELLC = '<w:rPr><w:rStyle w:val="HTML"/>' + $RF_CODE + '<w:color w:val="1A1A2E"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
$RPR_META = '<w:rPr>' + $RF + '<w:color w:val="5B4A1F"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>'
$RPR_CODEOK = '<w:rPr><w:color w:val="1A1A2E"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
$SET_BODY = @{ n = $RPR_BODY; b = $RPR_BOLD; c = $RPR_CODE; bc = $RPR_BOLDCODE }
$SET_CELL = @{ n = $RPR_CELL; b = $RPR_CELLH; c = $RPR_CELLC; bc = $RPR_CELLH }

function MakeRun([string]$txt, [string]$rpr) {
    $body = Esc $txt
    if ($body -eq '') { $body = ' ' }
    return '<w:r>' + $rpr + '<w:t xml:space="preserve">' + $body + '</w:t></w:r>'
}
function EmitInlines([string]$text, $set) {
    $sb = New-Object System.Text.StringBuilder
    $buf = ''
    $i = 0
    $L = $text.Length
    while ($i -lt $L) {
        $c = $text[$i]
        if ($c -eq '*' -and ($i + 1) -lt $L -and $text[$i + 1] -eq '*') {
            $j = $text.IndexOf('**', $i + 2)
            if ($j -ge 0) {
                if ($buf -ne '') { [void]$sb.Append((MakeRun $buf $set.n)); $buf = '' }
                $inner = $text.Substring($i + 2, $j - $i - 2)
                $parts = $inner.Split([char]96)
                for ($k = 0; $k -lt $parts.Length; $k++) {
                    if ($parts[$k] -eq '') { continue }
                    if ($k % 2 -eq 1) { [void]$sb.Append((MakeRun $parts[$k] $set.bc)) } else { [void]$sb.Append((MakeRun $parts[$k] $set.b)) }
                }
                $i = $j + 2
                continue
            }
        }
        if ($c -eq [char]96) {
            $j = $text.IndexOf([char]96, $i + 1)
            if ($j -ge 0) {
                if ($buf -ne '') { [void]$sb.Append((MakeRun $buf $set.n)); $buf = '' }
                [void]$sb.Append((MakeRun ($text.Substring($i + 1, $j - $i - 1)) $set.c))
                $i = $j + 1
                continue
            }
        }
        $buf += $c
        $i++
    }
    if ($buf -ne '') { [void]$sb.Append((MakeRun $buf $set.n)) }
    return $sb.ToString()
}
function New-HRule([int]$idx) {
    $id = '_x0000_i' + (1024 + $idx)
    return '<w:p><w:pPr><w:spacing w:before="280" w:after="280"/><w:rPr>' + $RF + '</w:rPr></w:pPr><w:r><w:rPr>' + $RF + '</w:rPr><w:pict><v:rect id="' + $id + '" style="width:0;height:1.5pt" o:hralign="center" o:hrstd="t" o:hr="t" fillcolor="#a0a0a0" stroked="f"/></w:pict></w:r></w:p>'
}
function Emit-Heading([string]$level, [string]$text) {
    return '<w:p><w:pPr><w:pStyle w:val="' + $level + '"/><w:rPr>' + $RF + '</w:rPr></w:pPr>' + (EmitInlines $text $SET_BODY) + '</w:p>'
}
function Emit-Para([string]$text) {
    return '<w:p><w:pPr><w:spacing w:before="140" w:after="140"/>' + $RPR_BODY + '</w:pPr>' + (EmitInlines $text $SET_BODY) + '</w:p>'
}
function Emit-Meta([string]$text) {
    return '<w:p><w:pPr><w:pStyle w:val="a6"/>' + $RPR_META + '</w:pPr>' + (EmitInlines $text $SET_BODY) + '</w:p>'
}
function Emit-Quote([string]$text) {
    return '<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="1A3A8F"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F2F4FA"/><w:spacing w:before="140" w:after="140"/><w:ind w:left="240"/>' + $RPR_BODY + '</w:pPr>' + (EmitInlines $text $SET_BODY) + '</w:p>'
}
function Emit-Code([string[]]$codeLines) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($cl in $codeLines) {
        [void]$sb.Append('<w:p><w:pPr><w:pStyle w:val="HTML0"/>' + $RPR_CODEOK + '</w:pPr><w:r>' + $RPR_CODEOK + '<w:t xml:space="preserve">' + (Esc $cl) + '</w:t></w:r></w:p>')
    }
    return $sb.ToString()
}
function Emit-ListItem([string]$text, [int]$ilvl, [int]$numId) {
    $p = '<w:p><w:pPr><w:numPr><w:ilvl w:val="' + $ilvl + '"/><w:numId w:val="' + $numId + '"/></w:numPr><w:spacing w:before="100" w:after="100"/>' + $RPR_BODY + '</w:pPr>'
    return $p + (EmitInlines $text $SET_BODY) + '</w:p>'
}
function Emit-Table($rows) {
    $nCols = $rows[0].Count
    $wts = @()
    for ($c = 0; $c -lt $nCols; $c++) {
        $mx = 8
        foreach ($r in $rows) { if ($c -lt $r.Count) { $d = DispLen (StripMd $r[$c]); if ($d -gt $mx) { $mx = $d } } }
        $wts += $mx
    }
    $sum = 0.0
    foreach ($w in $wts) { $sum += $w }
    $total = 8306
    $widths = @()
    $acc = 0
    for ($c = 0; $c -lt $nCols; $c++) {
        if ($c -eq $nCols - 1) { $widths += ($total - $acc) }
        else {
            $w = [int][math]::Round($total * $wts[$c] / $sum)
            if ($w -lt 620) { $w = 620 }
            $widths += $w
            $acc += $w
        }
    }
    $bd = '<w:top w:val="single" w:sz="6" w:space="0" w:color="6B7BA4"/><w:left w:val="single" w:sz="6" w:space="0" w:color="6B7BA4"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="6B7BA4"/><w:right w:val="single" w:sz="6" w:space="0" w:color="6B7BA4"/>'
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblCellMar><w:top w:w="15" w:type="dxa"/><w:left w:w="15" w:type="dxa"/><w:bottom w:w="15" w:type="dxa"/><w:right w:w="15" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>')
    foreach ($w in $widths) { [void]$sb.Append('<w:gridCol w:w="' + $w + '"/>') }
    [void]$sb.Append('</w:tblGrid>')
    for ($ri = 0; $ri -lt $rows.Count; $ri++) {
        $isHead = ($ri -eq 0)
        $trPr = '<w:trPr><w:cantSplit/>'
        if ($isHead) { $trPr += '<w:tblHeader/>' }
        $trPr += '</w:trPr>'
        [void]$sb.Append('<w:tr>' + $trPr)
        for ($c = 0; $c -lt $nCols; $c++) {
            $txt = ''
            if ($c -lt $rows[$ri].Count) { $txt = $rows[$ri][$c] }
            $cellRpr = $RPR_CELL
            $shd = ''
            if ($isHead) { $cellRpr = $RPR_CELLH; $shd = '<w:shd w:val="clear" w:color="auto" w:fill="0F2461"/>' }
            [void]$sb.Append('<w:tc><w:tcPr><w:tcW w:w="' + $widths[$c] + '" w:type="dxa"/><w:tcBorders>' + $bd + '</w:tcBorders>' + $shd + '<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar></w:tcPr>')
            [void]$sb.Append('<w:p><w:pPr><w:spacing w:before="120" w:after="120"/>' + $cellRpr + '</w:pPr>' + (EmitInlines $txt $SET_CELL) + '</w:p>')
            [void]$sb.Append('</w:tc>')
        }
        [void]$sb.Append('</w:tr>')
    }
    [void]$sb.Append('</w:tbl>')
    return $sb.ToString()
}

$workRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '_build\tmp'
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
$work = Join-Path $workRoot ('md2docx_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
[System.IO.Compression.ZipFile]::ExtractToDirectory($Template, $work)
$docPath = Join-Path $work 'word\document.xml'
$numPath = Join-Path $work 'word\numbering.xml'
$tplDoc = [System.IO.File]::ReadAllText($docPath, [System.Text.Encoding]::UTF8)
$bodyIdx = $tplDoc.IndexOf('<w:body>')
$prefix = $tplDoc.Substring(0, $bodyIdx + 8)
$sectIdx = $tplDoc.LastIndexOf('<w:sectPr')
$suffix = $tplDoc.Substring($sectIdx)

$lines = [System.IO.File]::ReadAllLines($Md, [System.Text.Encoding]::UTF8)
$out = New-Object System.Text.StringBuilder
$orderedNumId = 550
$orderedState = $null
$olCount = 0
$stats = @{ h1 = 0; h2 = 0; h3 = 0; p = 0; ul = 0; ol = 0; tbl = 0; code = 0; quote = 0; hr = 0 }
$i = 0
$afterTitle = $false
while ($i -lt $lines.Count) {
    $ln = $lines[$i]
    $t = $ln.Trim()
    if ($t -eq '') { $i++; continue }
    if (-not $t.StartsWith('> ')) { $afterTitle = $false }
    if ($t.StartsWith('```')) {
        $i++
        $code = @()
        while ($i -lt $lines.Count -and -not $lines[$i].Trim().StartsWith('```')) { $code += $lines[$i]; $i++ }
        $i++
        [void]$out.Append((Emit-Code $code)); $stats.code++
        continue
    }
    if ($t -eq '---') { [void]$out.Append((New-HRule $stats.hr)); $orderedState = $null; $stats.hr++; $i++; continue }
    if ($t.StartsWith('#### ')) { [void]$out.Append((Emit-Heading '4' $t.Substring(5))); $orderedState = $null; $i++; continue }
    if ($t.StartsWith('### ')) { [void]$out.Append((Emit-Heading '3' $t.Substring(4))); $orderedState = $null; $stats.h3++; $i++; continue }
    if ($t.StartsWith('## ')) { [void]$out.Append((Emit-Heading '2' $t.Substring(3))); $orderedState = $null; $stats.h2++; $i++; continue }
    if ($t.StartsWith('# ')) { [void]$out.Append((Emit-Heading '1' $t.Substring(2))); $afterTitle = $true; $orderedState = $null; $stats.h1++; $i++; continue }
    if ($t.StartsWith('|')) {
        $rows = New-Object System.Collections.ArrayList
        while ($i -lt $lines.Count) {
            $lt = $lines[$i].Trim()
            if (-not $lt.StartsWith('|')) { break }
            if ($lt -match '^\|[\s\-:|]+\|$') { $i++; continue }
            [void]$rows.Add((SplitCells $lt)); $i++
        }
        if ($rows.Count -gt 0) { [void]$out.Append((Emit-Table $rows)); $stats.tbl++ }
        $orderedState = $null
        continue
    }
    if ($t.StartsWith('> ')) {
        if ($afterTitle) { [void]$out.Append((Emit-Meta $t.Substring(2))) } else { [void]$out.Append((Emit-Quote $t.Substring(2))) }
        $stats.quote++; $i++
        continue
    }
    if ($t.StartsWith('- ')) {
        while ($i -lt $lines.Count) {
            $raw = $lines[$i]
            $lt = $raw.TrimStart(' ')
            if (-not $lt.StartsWith('- ')) { break }
            $ilvl = 0
            if (($raw.Length - $lt.Length) -ge 2) { $ilvl = 1 }
            [void]$out.Append((Emit-ListItem $lt.Substring(2) $ilvl 500)); $stats.ul++; $i++
        }
        continue
    }
    if ($t -match '^(\d+)\.\s') {
        $first = [int]$Matches[1]
        if ($null -eq $orderedState -or $orderedState.Last -ne ($first - 1)) {
            $orderedNumId++; $olCount++; $orderedState = @{ Id = $orderedNumId; Last = $first }
        } else { $orderedState.Last = $first }
        [void]$out.Append((Emit-ListItem ($t -replace '^\d+\.\s', '') 0 $orderedState.Id)); $stats.ol++; $i++
        continue
    }
    [void]$out.Append((Emit-Para $t)); $stats.p++; $i++
}

$docText = $prefix + $out.ToString() + $suffix
$null = [xml]$docText
[System.IO.File]::WriteAllText($docPath, $docText, (New-Object System.Text.UTF8Encoding($false)))

$B0 = [char]0x2022; $B1 = [char]0x25E6; $B2 = [char]0x25AA
$brpr = '<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:eastAsia="' + $FONT + '"/></w:rPr>'
$abs500 = '<w:abstractNum w:abstractNumId="500" w15:restartNumberingAfterBreak="0"><w:nsid w:val="1F500001"/><w:multiLevelType w:val="hybridMultilevel"/>'
$abs500 += '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="' + $B0 + '"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr>' + $brpr + '</w:lvl>'
$abs500 += '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="' + $B1 + '"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="1440"/></w:tabs><w:ind w:left="1440" w:hanging="360"/></w:pPr>' + $brpr + '</w:lvl>'
$abs500 += '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="' + $B2 + '"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="2160"/></w:tabs><w:ind w:left="2160" w:hanging="360"/></w:pPr>' + $brpr + '</w:lvl>'
$abs500 += '</w:abstractNum>'
$abs501 = '<w:abstractNum w:abstractNumId="501" w15:restartNumberingAfterBreak="0"><w:nsid w:val="1F500002"/><w:multiLevelType w:val="hybridMultilevel"/>'
$abs501 += '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>'
$abs501 += '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="1440"/></w:tabs><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>'
$abs501 += '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="2160"/></w:tabs><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>'
$abs501 += '</w:abstractNum>'
$numsXml = '<w:num w:numId="500" w16cid:durableId="500000"><w:abstractNumId w:val="500"/></w:num>'
for ($k = 1; $k -le $olCount; $k++) { $numsXml += '<w:num w:numId="' + (550 + $k) + '" w16cid:durableId="' + (500000 + $k) + '"><w:abstractNumId w:val="501"/></w:num>' }
$numText = [System.IO.File]::ReadAllText($numPath, [System.Text.Encoding]::UTF8)
$numIdx = $numText.IndexOf('<w:num ')
$numText = $numText.Substring(0, $numIdx) + $abs500 + $abs501 + $numText.Substring($numIdx)
$numEnd = $numText.LastIndexOf('</w:numbering>')
$numText = $numText.Substring(0, $numEnd) + $numsXml + $numText.Substring($numEnd)
$null = [xml]$numText
[System.IO.File]::WriteAllText($numPath, $numText, (New-Object System.Text.UTF8Encoding($false)))

if ($OutPath -eq '') { $OutPath = [System.IO.Path]::ChangeExtension($Md, '.docx') }
$outDocx = Join-Path $workRoot ('out_' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.docx')
$fs = [System.IO.File]::Open($outDocx, [System.IO.FileMode]::Create)
$zip = New-Object -TypeName System.IO.Compression.ZipArchive -ArgumentList @($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$ct = Join-Path $work '[Content_Types].xml'
if (Test-Path -LiteralPath $ct) {
    $e = $zip.CreateEntry('[Content_Types].xml', [System.IO.Compression.CompressionLevel]::Optimal)
    $s = $e.Open(); $f = [System.IO.File]::OpenRead($ct); $f.CopyTo($s); $f.Close(); $s.Close()
}
Get-ChildItem -LiteralPath $work -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($work.Length + 1).Replace('\', '/')
    if ($rel -eq '[Content_Types].xml') { return }
    $e = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $s = $e.Open(); $f = [System.IO.File]::OpenRead($_.FullName); $f.CopyTo($s); $f.Close(); $s.Close()
}
$zip.Dispose(); $fs.Close()
Copy-Item -LiteralPath $outDocx -Destination $OutPath -Force
Remove-Item -LiteralPath $outDocx -Force
Remove-Item -LiteralPath $work -Recurse -Force
Write-Host ('OK -> ' + $OutPath + ' (' + (Get-Item -LiteralPath $OutPath).Length + ' bytes) ' + (($stats.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Key + '=' + $_.Value }) -join ' '))
