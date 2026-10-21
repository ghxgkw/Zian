# 梓安搞机工具箱（Zian Toolbox）

> 基于 Electron 的 Windows 桌面安卓设备管理工具，通过 **ADB（USB / 无线调试）** 与 **局域网直连** 双通道与手机通信，内置超级剪贴板双向同步、高速文件管理、手机投屏等互联能力。

- 桌面端：Electron 33（main / preload / renderer 三层 IPC 架构）
- 手机端：原生 Android APK「梓安互联桥」（包名 `com.zian.bridge`，无 Gradle 手写编译链）
- 实测机型：vivo X100 Pro（Android 16 / OriginOS 6）

---

## 目录

- [功能特性](#功能特性)
- [整体架构](#整体架构)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [桌面端运行与打包](#桌面端运行与打包)
- [互联桥 APK 编译](#互联桥-apk-编译)
- [互联协议与端口](#互联协议与端口)
- [核心技术亮点](#核心技术亮点)
- [平台限制与注意事项](#平台限制与注意事项)
- [第三方资源与许可证](#第三方资源与许可证)

---

## 功能特性

### 12 个功能选项卡

| 选项卡 | 核心功能 | 通道 |
|--------|----------|------|
| 主页 | 设备管理、设备信息（CPU 频率 / 闪存类型 / 电池）、快速开关机（Fastboot/Recovery/EDL） | ADB |
| **互联** | **剪贴板双向同步、文件管理、手机投屏** | **LAN 直连 + USB forward** |
| 软件管理 | 应用禁用/卸载/提取/安装、保留数据卸载、GMS 套件管理 | ADB |
| 显示控制 | 分辨率/DPI 修改与还原、虚拟按键 | ADB |
| 系统界面 | 状态栏图标、MIUI 设置、沉浸模式 | ADB |
| 电池管理 | 电池信息与优化 | ADB |
| 无级调节 | 动画速度 / 锁屏时间滑块（比系统设置更细） | ADB |
| 截图录屏 | screencap、screenrecord（多音频源，覆盖 Android 11/14+） | ADB |
| 控机脚本 | Shell 脚本编辑、常用片段插入、一键运行 | ADB |
| ADB 终端 | adb shell 命令行、logcat 实时过滤 | ADB |
| 软件设置 | 启动页、主题、推送路径、界面动画 | 本地 |
| 关于 | 版本信息、开发者社交账号 | 本地 |

### 互联（核心功能）

- **双通道自适应**：自动模式 USB 优先，失败转局域网；USB 走 `adb forward`，不受 Wi-Fi 环境影响
- **超级剪贴板**：文本 + 图片双向同步（1s 轮询），内容哈希签名防回环，相册零重复
- **文件管理**：按图片/视频/音频/文档/全部分类，网格/列表切换，缩略图秒开，导入导出
- **手机投屏**：一键拉起 scrcpy 独立窗口，窗口关闭 UI 自动恢复
- **断线自愈**：USB 断线（含息屏 cgroup 冻结）≤30 秒自动重连，全程后台完成
- **安全隔离**：手机端可一键「暂停局域网」，公共 Wi-Fi 下仅允许 USB 连接
- **实测速率**：Wi-Fi 上传 166Mbps / 下载 148Mbps

---

## 整体架构

```
┌─────────────── PC（Electron）───────────────┐      ┌──────────── 手机（互联桥 APK）────────────┐
│                                              │      │                                           │
│  main.js                                     │      │  BridgeService（前台服务，常驻）            │
│  ├─ autoConnect（自动：USB优先→LAN缓存→扫描） │      │  ├─ HttpServer        :35791 (HTTP)       │
│  ├─ usbConnect（adb forward 35791/35792）    │◄─USB─┤  │   ├─ /ping /clipboard /files           │
│  ├─ usbWatchTimer（5s 健康检查+断线自愈）      │      │  │   ├─ /file /thumb /open                │
│  ├─ lanScan（UDP 多播发现 239.0.0.1:35791）   │◄─WiFi┤  ├─ FileReceiver      :35792 (raw TCP)    │
│  ├─ 剪贴板 watcher（1s 轮询双向同步）          │      │  ├─ MdnsBroadcaster（5s UDP 广播）        │
│  └─ 文件管理（list/pull/push/进度）           │      │  └─ ClipboardWatcher（手机剪贴板变化）     │
└──────────────────────────────────────────────┘      └───────────────────────────────────────────┘
```

- **USB 通道**：`adb forward tcp:35791/35792` 双端口转发，PC 以 127.0.0.1 访问手机服务，与无线调试可并存
- **LAN 通道**：UDP 多播发现 + Wi-Fi 直连，免线缆

---

## 目录结构

```
Zian/
├── resources/
│   └── app.asar.unpacked/          # 桌面端源码（Electron 应用）
│       ├── main.js                 # 主进程：ADB、连接管理、剪贴板同步、文件传输
│       ├── lib/                    # 主进程模块：util / adb / net
│       ├── preload.js              # 预加载脚本（IPC 桥）
│       ├── renderer.js             # 渲染进程：全部界面逻辑
│       ├── index.html / splash.html
│       ├── style.css               # 含浅色/深色双主题变量
│       ├── package.json
│       └── assets/                 # 图标资源
├── tools/                          # 项目内工具：pack-asar.js / verify-asar.js / md2docx.ps1
├── apk-src/                        # 互联桥 APK 源码与编译脚本
│   ├── build.ps1                   # 手写编译链（无 Gradle）
│   ├── AndroidManifest.xml
│   ├── src/com/zian/bridge/        # Java 源码
│   │   ├── BridgeService.java      # 前台服务、保活、暂停局域网
│   │   ├── HttpServer.java         # NanoHTTPD：ping/剪贴板/文件/缩略图
│   │   ├── FileReceiver.java       # raw TCP 35792 大文件接收
│   │   ├── MdnsBroadcaster.java    # UDP 多播广播
│   │   ├── ClipboardWatcher.java
│   │   ├── BootReceiver.java       # 开机自启三链
│   │   └── VivoOfficeAdapter.java  # vivo 办公打开适配
│   ├── libs/nanohttpd-2.3.1.jar
│   └── res/                        # Android 资源
├── repack-asar.ps1                 # 无 Node 环境下的 asar 单文件替换重打包器
├── cdp.ps1 / shot.ps1              # Chrome DevTools 协议自动化测试脚本
├── capture.ps1 / click.ps1         # 无扰截图 / 后台点击（PrintWindow / PostMessage）
├── add-firewall-rule.bat           # 放行 UDP 多播防火墙规则
├── version
└── 梓安搞机工具箱-功能与互联计划文档.docx/.md   # 详细技术文档
```

> 完整打包后的 Electron 运行时（`app.asar`、`*.exe`、`*.dll`、`icudtl.dat` 等）与第三方工具（`resources/adb`、`resources/scrcpy`、`resources/ffmpeg`）不包含在仓库中，运行时需自备，见下文说明。

---

## 快速开始

### 前置条件

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | 18+（Electron 33 要求） | 运行与打包桌面端 |
| adb.exe | platform-tools 较新版本 | 安卓设备通信（打包时置于 `resources/adb/`） |
| scrcpy | 2.x（可选） | 手机投屏（置于 `resources/scrcpy/`） |
| ffmpeg | 可选 | 录屏音频处理（置于 `resources/ffmpeg/`） |
| JDK | 17 | 编译互联桥 APK |
| Android SDK | build-tools 34.0.0 + platform 34 | 编译互联桥 APK |

### 手机端准备

1. 安装「梓安互联桥」APK 并保持运行
2. 开启手机「USB 调试」（USB 通道）或确保手机与电脑在同一 Wi-Fi（LAN 通道）
3. vivo 机型建议在电池/后台管理中将互联桥加入白名单

### 桌面端开发运行

```bash
cd resources/app.asar.unpacked
npm install
npm start
```

---

## 桌面端运行与打包

### 开发运行

```bash
cd resources/app.asar.unpacked
npm start          # 等同于 electron .
```

### 打包为 Windows 可执行程序

```bash
cd resources/app.asar.unpacked
npm run dist
```

`package.json` 中的 `dist` 脚本使用 `@electron/packager`，关键参数：

- `--platform=win32 --arch=x64`：Windows 64 位
- `--asar`：源码打包为 `app.asar`
- `--extra-resource=resources/adb`（及 scrcpy、ffmpeg）：内置第三方工具
- `--icon=assets/icon.ico`：应用图标（含 16~256px 多尺寸）

### 修改包内文件后重打包

使用项目内无依赖打包器（推荐，全量重建 + 哈希校验）：

```bash
node tools/pack-asar.js "resources/app.asar.unpacked" "resources/app.asar"
node tools/verify-asar.js "resources/app.asar" "resources/app.asar.unpacked"
```

历史方案：`repack-asar.ps1`（依赖旧包结构、只做单文件替换，包内容缺失时会失效）。

> 修改 `main.js` / `renderer.js` / `style.css` 等包内文件后必须重打包并重启工具箱。

---

## 互联桥 APK 编译

无需 Android Studio / Gradle，`apk-src/build.ps1` 串联六步手工编译：

```
aapt2 compile → aapt2 link → javac(JDK17) → d8(含 NanoHTTPD jar) → zipalign → apksigner
```

```powershell
cd apk-src
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

注意事项：

- **aapt2 在中文路径下会崩溃**：脚本用 `subst` 临时映射 ASCII 盘符再编译，构建目录仍在项目内 `_build/apk`
- 签名 keystore 生成在 `_build/apk/debug.keystore`，产物为 `apk-src/app.apk`
- 源码新增公共类：`Constants`（端口/版本）、`NetUtil`（IP）、`JsonUtil`（转义）、`IoUtil`（MD5/读流）
- d8 需手动携带 `libs/nanohttpd-2.3.1.jar` 做 classpath 合并
- 产物 `app.apk` 会自动复制回 `apk-src/`
- 安装：`adb -s <serial> install -r -g app.apk`，随后 `adb shell appops set com.zian.bridge MANAGE_EXTERNAL_STORAGE allow`（不发送任何唤醒键）

---

## 互联协议与端口

| 通道 | 端口 | 用途 |
|------|------|------|
| UDP 多播 | `239.0.0.1:35791` | 手机每 5s 广播 JSON（name/model/ip/filePort），PC 扫描发现 |
| HTTP | 35791 | ping 心跳、剪贴板、文件列表、缩略图、下载、vivo 办公打开 |
| raw TCP | 35792 | 大文件流式上传 |

raw TCP 推送行头协议：

```
目标目录\n
文件名\n
字节数\n
<raw 字节流>
```

手机端完成后返回 `OK <字节数>` 或 `ERR <原因>`。

剪贴板内容签名格式（两端一致，防回环的基石）：

```
type:长度:md5前8
# 例：img:30142:2cd8bde4   txt:12:a3f9c2d1
```

---

## 核心技术亮点

1. **剪贴板内容哈希防回环**：用 `type:长度:md5前8` 而非时间戳作为内容签名，同一内容两端 sig 恒定；配合 `lastClipSig` / 一次性回声令牌 `echoGuard` / `lastPhoneWrittenSig` / 写回后重算本机 sig 四重机制，杜绝双向无限互推与相册重复图
2. **adb forward 半关闭陷阱修复**：raw TCP 数据发完不能 `sock.end()`（中继会把 FIN 当作连接终结，回执永远回不来），需 `allowHalfOpen: true` + `pipe(sock, {end:false})`，收完响应再统一关闭
3. **息屏冻结 × 免打扰自愈**：vivo 息屏 cgroup 冻结后仅用 `KEYCODE_WAKEUP`（绝不 `am start` 拉起 App）+ 耐心重试 ping 解冻恢复，全程不打扰用户
4. **视频缩略图加速**：优先查 MediaStore 系统缓存（约 20ms），替代 `MediaMetadataRetriever` 逐帧解码（500ms–2s），快 10 倍以上
5. **暂停局域网三重隔离**：volatile 标志 + HttpServer 入口对非 127.0.0.1 返回 403 + 停止多播广播
6. **无 Node 手写 asar 重打包器**：纯 PowerShell 解析 asar 的 Chrome Pickle 头部结构与字符串型 offset，绕过本机无 Node/asar 工具的限制
7. **无扰自动化测试**：通过 Chrome DevTools Protocol（`--remote-debugging-port=9222`）直接驱动 Electron renderer，配合 PrintWindow/PostMessage，实现不动用户鼠标键盘屏幕的 USB/LAN 双通道全功能回归

更完整的实现细节、踩坑过程与避坑清单见仓库内 **《梓安搞机工具箱-功能与互联计划文档》**。

---

## 平台限制与注意事项

- **Android 10+ 后台读剪贴板受限**：互联桥在后台时 `GET /clipboard` 返回 empty（手机→PC 同步仅在互联桥前台/获焦时可用）；PC→手机**写**剪贴板不受限，后台随时可用。这是系统平台行为
- **局域网自动扫描只上报前台运行的互联桥**（按手机自报的 `fg` 标志过滤）；后台服务请使用「仅局域网」手动直连
- 多设备场景（USB + 无线调试同时在线）下所有 adb 命令必须带 `-s <serial>`，否则可能误选设备
- vivo ROM 可能阉割 `screenrecord --audio`，录屏音频源会自动回退
- 更新 EXE 图标后若未刷新，可能需要重启资源管理器清 Windows 图标缓存

---

## 第三方资源与许可证

本仓库仅包含项目自研代码与文档，**不包含**以下第三方二进制资源，使用完整安装包时需自行获取：

| 资源 | 用途 | 获取方式 |
|------|------|----------|
| Electron 运行时 | 桌面框架 | https://www.electronjs.org/ |
| adb（Android platform-tools） | 设备通信 | https://developer.android.com/tools/releases/platform-tools |
| scrcpy | 手机投屏 | https://github.com/Genymobile/scrcpy |
| ffmpeg | 录屏音视频处理 | https://ffmpeg.org/ |
| NanoHTTPD 2.3.1 | 手机端 HTTP 服务（jar 已随 `apk-src/libs/` 提供） | https://github.com/NanoHttpd/nanohttpd |

仓库根目录的 `LICENSE` 为随 Electron 运行时分发的 **Electron MIT 许可证**（Copyright (c) Electron contributors / GitHub Inc.），仅覆盖 Electron 第三方组件。项目自身源码的许可证以作者后续声明为准。
