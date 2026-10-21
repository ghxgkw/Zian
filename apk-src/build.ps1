# 梓安互联桥 APK 编译脚本（项目内构建，无 Gradle）
# 依赖：JDK 17（C:\Java\jdk17）+ Android build-tools 34.0.0 + platform 34
# 说明：aapt2 在含中文路径下会崩溃，因此用 subst 把项目目录映射成 ASCII 盘符再编译；
#       物理产物仍全部位于项目内（_build/apk 与 apk-src/app.apk），不写项目外目录。
$ErrorActionPreference = 'Stop'

$SRC = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJ = Split-Path -Parent $SRC

$JAVA_HOME = 'C:\Java\jdk17'
$env:JAVA_HOME = $JAVA_HOME
$env:PATH = "$JAVA_HOME\bin;$env:PATH"
$BT = 'C:\Android\sdk\build-tools\34.0.0'
$PL = 'C:\Android\sdk\platforms\android-34\android.jar'
$JAVAC = "$JAVA_HOME\bin\javac.exe"
$KEYTOOL = "$JAVA_HOME\bin\keytool.exe"

# ---- 选择空闲盘符并映射项目根（ASCII 路径，规避 aapt2 中文路径崩溃）----
$DRIVE = $null
foreach ($d in 'V', 'W', 'X', 'Y', 'Z') {
    if (-not (Test-Path "${d}:\")) { $DRIVE = $d; break }
}
if (-not $DRIVE) { throw '没有可用盘符用于临时映射（V/W/X/Y/Z 均被占用）' }
& subst "${DRIVE}:" $PROJ
if ($LASTEXITCODE -ne 0) { throw 'subst 映射失败' }
$ROOT = "${DRIVE}:\_build\apk"
$SRCA = "${DRIVE}:\apk-src"
$NANO = "$ROOT\libs\nanohttpd-2.3.1.jar"

Write-Host "==> 源码: $SRC"
Write-Host "==> 编译: $ROOT（映射 ${DRIVE}: -> $PROJ）"

try {
    # 0. 同步源码到编译目录：src/res 先清空再复制（只增不删会残留已删除的源文件/资源，编出过期内容）
    Remove-Item -Recurse -Force "$ROOT\src", "$ROOT\res" -ErrorAction SilentlyContinue
    New-Item -Path "$ROOT\src\com\zian\bridge", "$ROOT\res", "$ROOT\libs" -ItemType Directory -Force | Out-Null
    Copy-Item "$SRCA\AndroidManifest.xml" "$ROOT\AndroidManifest.xml" -Force
    Copy-Item "$SRCA\src\com\zian\bridge\*.java" "$ROOT\src\com\zian\bridge\" -Force
    Copy-Item "$SRCA\res\*" "$ROOT\res\" -Recurse -Force
    # jar 每次覆盖：只在缺失时复制会一直沿用旧 jar
    Copy-Item "$SRCA\libs\nanohttpd-2.3.1.jar" $NANO -Force

    # 0.1 准备 debug keystore（项目内）
    if (-not (Test-Path "$ROOT\debug.keystore")) {
        Write-Host '==> 生成 debug.keystore'
        & $KEYTOOL -genkeypair -keystore "$ROOT\debug.keystore" -keyalg RSA -keysize 2048 -validity 10000 -alias androiddebugkey -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" | Out-Null
    }

    # 1. 清理上次产物
    Remove-Item -Recurse -Force "$ROOT\classes", "$ROOT\dex", "$ROOT\gen" -ErrorAction SilentlyContinue
    Remove-Item -Force "$ROOT\compiled.zip", "$ROOT\app-unsigned.apk", "$ROOT\app-tmp.apk", "$ROOT\app-aligned.apk", "$ROOT\app.apk" -ErrorAction SilentlyContinue
    New-Item -Path "$ROOT\classes", "$ROOT\dex" -ItemType Directory -Force | Out-Null

    # 2. aapt2 compile 编译资源
    Write-Host '==> aapt2 compile'
    & "$BT\aapt2.exe" compile --dir "$ROOT\res" -o "$ROOT\compiled.zip"
    if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

    # 3. aapt2 link 生成 APK 骨架 + R.java
    Write-Host '==> aapt2 link'
    & "$BT\aapt2.exe" link -o "$ROOT\app-unsigned.apk" `
        -I $PL `
        --manifest "$ROOT\AndroidManifest.xml" `
        -R "$ROOT\compiled.zip" `
        --auto-add-overlay `
        --java "$ROOT\gen" `
        --min-sdk-version 26 `
        --target-sdk-version 34
    if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

    # 4. javac 编译 Java（含 R.java）
    Write-Host '==> javac'
    $cp = "$PL;$NANO"
    Get-ChildItem -Path "$ROOT\src\com\zian\bridge" -Filter *.java | ForEach-Object { $_.FullName } | Out-File -FilePath "$ROOT\src-files.txt" -Encoding ascii
    Add-Content -Path "$ROOT\src-files.txt" -Value "$ROOT\gen\com\zian\bridge\R.java"
    & $JAVAC -encoding UTF-8 -classpath $cp -d "$ROOT\classes" "@$ROOT\src-files.txt"
    if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

    # 5. d8 转 dex（NanoHTTPD jar 必须一并打包）
    Write-Host '==> d8'
    $classFiles = Get-ChildItem -Path "$ROOT\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
    & "$BT\d8.bat" --release --output "$ROOT\dex" $classFiles $NANO
    if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

    # 6. 把 dex 加入 APK
    Write-Host '==> 把 dex 加入 APK'
    Copy-Item "$ROOT\app-unsigned.apk" "$ROOT\app-tmp.apk" -Force
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open("$ROOT\app-tmp.apk", 'Update')
    $existing = $zip.GetEntry('classes.dex')
    if ($existing) { $existing.Delete() }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$ROOT\dex\classes.dex", 'classes.dex') | Out-Null
    $zip.Dispose()

    # 7. zipalign 对齐
    Write-Host '==> zipalign'
    & "$BT\zipalign.exe" -f -p 4 "$ROOT\app-tmp.apk" "$ROOT\app-aligned.apk"
    if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

    # 8. apksigner 签名
    Write-Host '==> apksigner'
    & "$BT\apksigner.bat" sign --ks "$ROOT\debug.keystore" --ks-pass pass:android --key-pass pass:android --out "$ROOT\app.apk" "$ROOT\app-aligned.apk"
    if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

    # 9. 签名校验通过后才部署：避免半成品 APK 覆盖源码目录/分发目录里的可用产物
    Write-Host '==> apksigner verify'
    & "$BT\apksigner.bat" verify "$ROOT\app.apk"
    if ($LASTEXITCODE -ne 0) { throw 'apksigner verify failed' }
    Remove-Item -Force "$ROOT\app-unsigned.apk", "$ROOT\app-tmp.apk", "$ROOT\app-aligned.apk", "$ROOT\compiled.zip", "$ROOT\src-files.txt" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$ROOT\classes", "$ROOT\dex", "$ROOT\gen" -ErrorAction SilentlyContinue

    $built = Get-Item "$ROOT\app.apk"
    $hash = (Get-FileHash -LiteralPath $built.FullName -Algorithm SHA256).Hash
    $DIST = Join-Path $PROJ '手机端app'
    if (-not (Test-Path -LiteralPath $DIST)) { New-Item -Path $DIST -ItemType Directory -Force | Out-Null }
    # 部署目标：源码目录产物 + 手机端app 分发产物；内容一致则跳过，覆盖时打印旧/新哈希
    $targets = @("$SRC\app.apk", (Join-Path $DIST '梓安互联桥-v1.0.apk'))
    foreach ($t in $targets) {
        if (Test-Path -LiteralPath $t) {
            $old = (Get-FileHash -LiteralPath $t -Algorithm SHA256).Hash
            if ($old -eq $hash) { Write-Host "==> 未变化，跳过: $t"; continue }
            Write-Host ("==> 覆盖: {0}（{1} -> {2}）" -f $t, $old.Substring(0, 12), $hash.Substring(0, 12))
        }
        Copy-Item $built.FullName $t -Force
    }

    Write-Host ''
    Write-Host ("app.apk 已生成: {0} bytes" -f $built.Length)
    foreach ($t in (@($built.FullName) + $targets)) {
        if (Test-Path -LiteralPath $t) {
            $it = Get-Item -LiteralPath $t
            Write-Host ("{0}  {1} bytes  SHA256={2}" -f $t, $it.Length, (Get-FileHash -LiteralPath $t -Algorithm SHA256).Hash)
        }
    }
}
finally {
    & subst "${DRIVE}:" /D 2>$null
}
