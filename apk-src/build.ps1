# 梓安互联桥 APK 编译脚本
# 依赖：JDK 17 + Android build-tools 34 + platform 34
# 说明：aapt2 在含中文路径下会崩溃，因此把源码同步到 C:\Android\apk-build 编译，
#       编译产物 app.apk 自动复制回本目录。
$ErrorActionPreference = 'Stop'

$SRC = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT = 'C:\Android\apk-build'

$JAVA_HOME = 'C:\Java\jdk17'
$env:JAVA_HOME = $JAVA_HOME
$env:PATH = "$JAVA_HOME\bin;$env:PATH"
$BT = 'C:\Android\sdk\build-tools\34.0.0'
$PL = 'C:\Android\sdk\platforms\android-34\android.jar'
$JAVAC = "$JAVA_HOME\bin\javac.exe"
$KEYTOOL = "$JAVA_HOME\bin\keytool.exe"
$NANO = "$ROOT\libs\nanohttpd-2.3.1.jar"

Write-Host "==> 源码: $SRC"
Write-Host "==> 编译: $ROOT"

# 0. 同步源码到编译目录（排除编译产物）
New-Item -Path "$ROOT\src\com\zian\bridge","$ROOT\res","$ROOT\libs" -ItemType Directory -Force | Out-Null
Copy-Item "$SRC\AndroidManifest.xml" "$ROOT\AndroidManifest.xml" -Force
Copy-Item "$SRC\src\com\zian\bridge\*.java" "$ROOT\src\com\zian\bridge\" -Force
Copy-Item "$SRC\res\*" "$ROOT\res\" -Recurse -Force
if (-not (Test-Path $NANO)) { Copy-Item "$SRC\libs\nanohttpd-2.3.1.jar" $NANO -Force }

# 0.1 准备 debug keystore
if (-not (Test-Path "$ROOT\debug.keystore")) {
    Write-Host "==> 生成 debug.keystore"
    & $KEYTOOL -genkeypair -keystore "$ROOT\debug.keystore" -keyalg RSA -keysize 2048 -validity 10000 -alias androiddebugkey -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" | Out-Null
}

# 1. 清理上次产物
Remove-Item -Recurse -Force "$ROOT\classes" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$ROOT\dex" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$ROOT\gen" -ErrorAction SilentlyContinue
Remove-Item -Force "$ROOT\compiled.zip","$ROOT\app-unsigned.apk","$ROOT\app-tmp.apk","$ROOT\app-aligned.apk","$ROOT\app.apk" -ErrorAction SilentlyContinue
New-Item -Path "$ROOT\classes" -ItemType Directory -Force | Out-Null
New-Item -Path "$ROOT\dex" -ItemType Directory -Force | Out-Null

# 2. aapt2 compile 编译资源
Write-Host "==> aapt2 compile"
& "$BT\aapt2.exe" compile --dir "$ROOT\res" -o "$ROOT\compiled.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

# 3. aapt2 link 生成 APK 骨架 + R.java（--java 输出目录）
Write-Host "==> aapt2 link"
& "$BT\aapt2.exe" link -o "$ROOT\app-unsigned.apk" `
    -I $PL `
    --manifest "$ROOT\AndroidManifest.xml" `
    -R "$ROOT\compiled.zip" `
    --auto-add-overlay `
    --java "$ROOT\gen" `
    --min-sdk-version 26 `
    --target-sdk-version 34
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

# 4. javac 编译 Java（含 R.java）
Write-Host "==> javac"
$cp = "$PL;$NANO"
Get-ChildItem -Path "$ROOT\src\com\zian\bridge" -Filter *.java | ForEach-Object { $_.FullName } | Out-File -FilePath "$ROOT\src-files.txt" -Encoding ascii
Add-Content -Path "$ROOT\src-files.txt" -Value "$ROOT\gen\com\zian\bridge\R.java"
& $JAVAC -encoding UTF-8 -classpath $cp -d "$ROOT\classes" "@$ROOT\src-files.txt"
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

# 5. d8 转 dex（NanoHTTPD jar 必须一并打包，否则运行时 NoClassDefFoundError）
Write-Host "==> d8"
$classFiles = Get-ChildItem -Path "$ROOT\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& "$BT\d8.bat" --release --output "$ROOT\dex" $classFiles $NANO
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

# 6. 把 dex 加入 APK
Write-Host "==> 把 dex 加入 APK"
Copy-Item "$ROOT\app-unsigned.apk" "$ROOT\app-tmp.apk" -Force
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open("$ROOT\app-tmp.apk", 'Update')
$existing = $zip.GetEntry('classes.dex')
if ($existing) { $existing.Delete() }
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$ROOT\dex\classes.dex", 'classes.dex') | Out-Null
$zip.Dispose()

# 7. zipalign 对齐
Write-Host "==> zipalign"
& "$BT\zipalign.exe" -f -p 4 "$ROOT\app-tmp.apk" "$ROOT\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

# 8. apksigner 签名
Write-Host "==> apksigner"
& "$BT\apksigner.bat" sign --ks "$ROOT\debug.keystore" --ks-pass pass:android --key-pass pass:android --out "$ROOT\app.apk" "$ROOT\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

# 9. 清理临时产物 + 复制 APK 回源码目录
Remove-Item -Force "$ROOT\app-unsigned.apk","$ROOT\app-tmp.apk","$ROOT\app-aligned.apk","$ROOT\compiled.zip","$ROOT\src-files.txt" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$ROOT\classes","$ROOT\dex","$ROOT\gen" -ErrorAction SilentlyContinue
Copy-Item "$ROOT\app.apk" "$SRC\app.apk" -Force

$size = (Get-Item "$SRC\app.apk").Length
Write-Host ""
Write-Host "✅ app.apk 已生成 ($size bytes) → $SRC\app.apk" -ForegroundColor Green
