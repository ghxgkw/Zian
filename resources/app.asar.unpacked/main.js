const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const http = require('http');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { ts, delay, parseKeyVals, safeWinName, lastErrLine, fileOk, endpointOf } = require('./lib/util');
const { createAdb } = require('./lib/adb');
const { pingDevice, httpGetJson, lanScan, authHeaders, isUnauthorized } = require('./lib/net');

// ---------- 路径解析 ----------
// 打包态资源在 exe 同级 resources；开发态 unpacked 位于 <项目>/resources/app.asar.unpacked
const RES_DIR = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '..', '..', 'resources');
const ADB = path.join(RES_DIR, 'adb', 'adb.exe');
const SCRCPY = path.join(RES_DIR, 'scrcpy', 'scrcpy.exe');
const { adb, adbBinary, parseDevices, onlineSerials } = createAdb(ADB);

// 数据目录（截图/APK导出/脚本）：exe 同级目录 → 文档目录 → 系统临时目录逐级回退。
// 每一级都必须兜住异常：回退分支若在目录不可写时抛出，应用会在启动阶段直接崩溃
function setupDirs() {
  const subDirs = ['Screenshots', 'ApkExt', 'Script', 'Log'];
  const mk = (root) => {
    for (const d of subDirs) fs.mkdirSync(path.join(root, d), { recursive: true });
    return root;
  };
  try {
    return mk(app.isPackaged ? path.dirname(process.execPath) : __dirname);
  } catch {}
  try {
    return mk(path.join(app.getPath('documents'), '梓安工具箱'));
  } catch {}
  return mk(path.join(os.tmpdir(), '梓安工具箱'));
}
const BASE_DIR = setupDirs();

// ---------- 窗口 ----------
let splash = null;
let mainWin = null;
let mainReady = false;
const t0 = Date.now();

const ICON = process.platform === 'win32'
  ? (fs.existsSync(path.join(__dirname, 'assets', 'icon.ico')) ? path.join(__dirname, 'assets', 'icon.ico') : path.join(__dirname, 'assets', 'icon.png'))
  : path.join(__dirname, 'assets', 'icon.png');

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    show: false,
    backgroundColor: '#070c18',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWin.loadFile('index.html');
  mainWin.webContents.on('dom-ready', () => log('主窗口 dom-ready'));
  mainWin.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    log('主窗口 did-fail-load', code, desc, url || '');
    if (!mainWin || isMainFrame === false || code === -3) return;   // -3 = ERR_ABORTED（主动中止/关闭）
    // 加载失败不能让用户只看到 splash：显示主窗并渲染可读错误页
    const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const html = '<!DOCTYPE html><meta charset="utf-8"><title>界面加载失败</title>'
      + '<body style="background:#070c18;color:#dbe6ff;font:14px/1.9 Microsoft YaHei,sans-serif;padding:48px">'
      + '<h2 style="color:#ff8a8a;font-weight:600">界面加载失败</h2>'
      + '<p>错误码：' + escHtml(code) + ' ' + escHtml(desc) + '</p>'
      + '<p style="word-break:break-all;color:#8fa6cc">' + escHtml(url || '') + '</p>'
      + '<p>请重新解压完整程序后重试；若仍失败，请把 Log\\zian.log 一并反馈。</p></body>';
    mainWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
    mainReady = true;
    revealMain();
  });
  mainWin.webContents.on('render-process-gone', (_e, d) => log('主窗口渲染进程退出', JSON.stringify(d)));
  mainWin.webContents.on('did-finish-load', () => {
    log('主窗口 did-finish-load');
    mainReady = true;
    revealMain();
  });
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}

// 开屏至少展示 2 秒后才显示主窗口
function revealMain() {
  if (!mainReady || !mainWin) return;
  const remain = 2000 - (Date.now() - t0);
  setTimeout(() => {
    if (!mainWin) return;
    mainWin.show();
    if (splash) { splash.destroy(); splash = null; }
  }, Math.max(0, remain));
}

function createSplash() {
  splash = new BrowserWindow({
    width: 520,
    height: 340,
    frame: false,
    resizable: false,
    movable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    show: false,
    webPreferences: { contextIsolation: true }
  });
  splash.loadFile('splash.html');
  splash.once('ready-to-show', () => splash.show());
}

// ---------- ADB 执行封装（见 lib/adb.js）----------

function log(...msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg.join(' ')}`;
  try { fs.appendFileSync(path.join(BASE_DIR, 'Log', 'zian.log'), line + '\n'); } catch {}
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('logcat:data', line);
}

// ---------- IPC ----------
ipcMain.handle('win:min', () => mainWin && mainWin.minimize());
ipcMain.handle('win:close', () => mainWin && mainWin.close());

ipcMain.handle('adb:devices', async () => {
  const r = await adb(['devices', '-l']);
  return parseDevices(r.out);
});

ipcMain.handle('adb:run', (_e, args, serial) => adb(args, serial));

// UFS 代际检测（best-effort）：内核日志 / MTK 专用节点 / UFS sysfs 描述符，
// 用户机普遍仅 root 可读，读不到返回空串
async function detectUfsGen(serial) {
  const probes = [
    'dmesg 2>/dev/null',
    'cat /proc/ufs_debug 2>/dev/null',
    'cat /sys/devices/platform/soc/*ufshc*/device_descriptor /sys/devices/platform/soc/*ufshci/device_descriptor 2>/dev/null',
    'cat /sys/devices/platform/*ufshc*/device_descriptor /sys/devices/platform/*ufshci*/device_descriptor 2>/dev/null'
  ];
  for (const p of probes) {
    const r = await adb(['shell', p], serial, 9000);
    const t = String(r.out || '');
    const m = t.match(/UFS[\s_]?V?([1-4])\.([0-9])/i)
      || t.match(/bcdUFS[\s:]*0x0?([1-4])([0-9])0?\b/i)
      || t.match(/Specification\s*Version[\s:]*0x0?([1-4])([0-9])0?\b/i);
    if (m) return `${m[1]}.${m[2]}`;
  }
  return '';
}

ipcMain.handle('device:info', async (_e, serial) => {
  const [props, size, density, battery, uptime, cpufreq, flash, kernel, arch] = await Promise.all([
    adb(['shell', 'getprop'], serial),
    adb(['shell', 'wm', 'size'], serial),
    adb(['shell', 'wm', 'density'], serial),
    adb(['shell', 'dumpsys', 'battery'], serial, 15000),
    adb(['shell', 'cat /proc/uptime'], serial, 10000),
    adb(['shell', 'cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null'], serial, 10000),
    adb(['shell', 'ls /sys/devices/platform/ 2>/dev/null | grep -iE \'ufs|emmc\''], serial, 10000),
    adb(['shell', 'cat /proc/version'], serial, 10000),
    adb(['shell', 'uname -m'], serial, 10000)
  ]);
  const prop = {};
  for (const line of props.out.split('\n')) {
    const m = line.match(/^\[(.+?)\]:\s*\[(.*?)\]/);
    if (m) prop[m[1]] = m[2];
  }
  const bat = parseKeyVals(battery.out);
  // 运行时长
  const upSec = parseFloat((uptime.out.split(/\s+/)[0] || '0'));
  const d = Math.floor(upSec / 86400), h = Math.floor(upSec % 86400 / 3600), mi = Math.floor(upSec % 3600 / 60);
  const uptimeStr = upSec > 0 ? `${d}天${h}小时${mi}分` : '';
  // CPU 各核实时频率 (kHz → MHz)
  const cpuFreqs = cpufreq.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d+$/.test(l))
    .map((l) => (Math.round(parseInt(l) / 1000 * 10) / 10) + 'MHz');
  // 闪存类型：boot_devices 分区名 + platform 目录双重判断
  const bootDev = ((prop['ro.boot.boot_devices'] || '') + ' ' + (prop['ro.boot.bootdevice'] || '') + ' ' + flash.out).toLowerCase();
  let flashType = /ufs/.test(bootDev) ? 'UFS' : (/msdc|emmc|mmc/.test(bootDev) ? 'eMMC' : '未知');
  if (flashType === 'UFS') {
    // 代际 best-effort：多数机型需要 ROOT 才能读取，读不到则诚实显示未知
    const gen = await detectUfsGen(serial);
    flashType = gen ? `UFS ${gen}` : 'UFS（代际未知）';
  }
  // 内核版本
  const kernelM = kernel.out.match(/Linux version (\S+)/);
  return {
    ok: props.code === 0,
    brand: prop['ro.product.brand'] || prop['ro.product.manufacturer'] || '未知',
    model: prop['ro.product.model'] || '未知',
    device: prop['ro.product.device'] || '',
    android: prop['ro.build.version.release'] || '',
    sdk: prop['ro.build.version.sdk'] || '',
    security: prop['ro.build.version.security_patch'] || '',
    abi: prop['ro.product.cpu.abi'] || '',
    serialno: prop['ro.serialno'] || prop['ro.boot.serialno'] || serial,
    build: prop['ro.build.display.id'] || '',
    fingerprint: prop['ro.build.fingerprint'] || '',
    board: prop['ro.board.platform'] || 'N/A',
    arch: (arch.out || '').trim() || (prop['ro.product.cpu.abi'] === 'arm64-v8a' ? 'aarch64' : ''),
    resolution: (size.out.match(/(\d+x\d+)/g) || []).pop() || '',
    density: (density.out.match(/(\d+)/) || [])[1] || '',
    uptime: uptimeStr,
    cpuFreqs,
    flashType,
    kernel: kernelM ? kernelM[1] : (kernel.out || '').trim().slice(0, 80),
    battery: bat['level'] || '',
    batteryTemp: bat['temperature'] || '',
    batteryHealth: bat['health'] || '',
    batteryStatus: bat['status'] || '',
    batteryVoltage: bat['Voltage'] || bat['voltage'] || '',
    batteryTech: bat['technology'] || '',
    batteryCounter: bat['Charge counter'] || '',
    powered: bat['AC powered'] || bat['USB powered'] || 'false',
    raw: props.out
  };
});

// 电池专用轻量读取
ipcMain.handle('battery:read', async (_e, serial) => {
  const [b, up, ps] = await Promise.all([
    adb(['shell', 'dumpsys battery'], serial, 20000),
    adb(['shell', 'cat /proc/uptime'], serial, 10000),
    adb(['shell', 'cat /sys/class/power_supply/*/uevent 2>/dev/null'], serial, 10000)
  ]);
  const bat = parseKeyVals(b.out);
  // 电源计量节点：设计容量 / 满充容量 / 循环次数（µAh → mAh）
  let fullCap = 0, designCap = 0, cycles = 0;
  for (const line of (ps.out || '').split(/\r?\n/)) {
    const m = line.match(/^POWER_SUPPLY_([A-Z_]+)=(\d+)/);
    if (!m) continue;
    const v = parseInt(m[2]);
    if (m[1] === 'CHARGE_FULL' && v > fullCap) fullCap = v;
    if (m[1] === 'CHARGE_FULL_DESIGN' && v > designCap) designCap = v;
    if (m[1] === 'CYCLE_COUNT' && v > cycles) cycles = v;
  }
  const upSec = parseFloat(((up.out || '').split(/\s+/)[0] || '0'));
  const d = Math.floor(upSec / 86400), h = Math.floor(upSec % 86400 / 3600), mi = Math.floor(upSec % 3600 / 60);
  return {
    ok: b.code === 0 && /level/i.test(b.out || ''),
    raw: ((b.out || '') + (b.err || '')).trim(),
    level: bat['level'] ?? '', scale: bat['scale'] ?? '100',
    status: bat['status'] ?? '', health: bat['health'] ?? '',
    voltage: bat['Voltage'] ?? bat['voltage'] ?? '',
    temp: bat['temperature'] ?? '', tech: bat['technology'] ?? '',
    counter: bat['Charge counter'] ?? '',
    acPowered: /true/i.test(bat['AC powered'] || ''),
    usbPowered: /true/i.test(bat['USB powered'] || ''),
    wirelessPowered: /true/i.test(bat['Wireless powered'] || ''),
    present: bat['present'] ?? '',
    designCap: designCap ? Math.round(designCap / 1000) : 0,
    fullCap: fullCap ? Math.round(fullCap / 1000) : 0,
    cycles,
    uptime: upSec > 0 ? `${d}天${h}小时${mi}分` : ''
  };
});

// 数据目录
ipcMain.handle('paths:get', () => ({
  base: BASE_DIR,
  screenshots: path.join(BASE_DIR, 'Screenshots'),
  apkext: path.join(BASE_DIR, 'ApkExt'),
  script: path.join(BASE_DIR, 'Script'),
  log: path.join(BASE_DIR, 'Log'),
  versions: {
    main: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }
}));

// ---------- 控机脚本（编辑器） ----------
ipcMain.handle('script:read', (_e, name) => {
  if (!/^[^\\/]+\.(bat|cmd|txt)$/i.test(name)) return { ok: false, msg: '非法脚本名' };
  const full = path.join(BASE_DIR, 'Script', name);
  if (!fs.existsSync(full)) return { ok: false, msg: '脚本不存在' };
  return { ok: true, content: fs.readFileSync(full, 'utf8') };
});
ipcMain.handle('script:save', (_e, name, content) => {
  if (!/^[^\\/]+\.(bat|cmd|txt)$/i.test(name)) return { ok: false, msg: '非法脚本名（需 .bat/.cmd/.txt 后缀）' };
  const full = path.join(BASE_DIR, 'Script', name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  log('保存脚本', name, `${content.length} 字节`);
  return { ok: true, msg: `${name} 已保存` };
});

ipcMain.handle('cmd:run', (_e, serial, cmd) => adb(['shell', cmd], serial, 60000));

// ---------- 应用管理 ----------
ipcMain.handle('app:install', async (e, serial, downgrade) => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: '选择 APK 安装包',
    filters: [{ name: 'APK 文件', extensions: ['apk'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, msg: '已取消' };
  const results = [];
  for (const p of r.filePaths) {
    const res = await adb(['install', '-r', ...(downgrade ? ['-d'] : []), p], serial, 300000);
    results.push(`${path.basename(p)}: ${(res.out || res.err || '').trim().split('\n').pop()}`);
    log('安装', path.basename(p), res.out.trim() || res.err.trim());
  }
  return { ok: true, msg: results.join('\n') };
});

// 卸载成败以设备端包列表终态为准：vivo 返回 "Failure [not installed for 0]" 但包其实已卸掉，
// 只按 adb 英文输出匹配会把成功判成失败
ipcMain.handle('app:uninstall', async (_e, serial, pkg) => {
  const remains = async () => {
    const q = await adb(['shell', 'pm', 'list', 'packages', pkg], serial, 30000);
    if (q.code !== 0) return null;   // 查询本身失败 → 无法校验
    return (q.out || '').split('\n')
      .map((l) => l.trim().replace(/^package:/, ''))
      .some((n) => n === pkg);
  };
  let r = await adb(['uninstall', pkg], serial, 60000);
  let out = (r.out || r.err).trim();
  if ((await remains()) === true) {
    // 系统应用尝试 --user 0 卸载
    r = await adb(['shell', 'pm', 'uninstall', '--user', '0', pkg], serial, 60000);
    out = (r.out || r.err).trim();
  }
  const still = await remains();
  log('卸载', pkg, out, still === false ? '· 已确认移除' : still === true ? '· 包仍存在' : '· 无法校验');
  if (still === false) return { ok: true, msg: /Success/i.test(out) ? out : `已卸载（设备原始输出：${out || '空'}）` };
  if (still === true) return { ok: false, msg: out || '卸载失败：包仍在设备上' };
  return { ok: /Success/i.test(out), msg: out };
});

ipcMain.handle('app:extract', async (_e, serial, pkg) => {
  const r = await adb(['shell', 'pm', 'path', pkg], serial, 30000);
  const paths = r.out.split('\n').map((l) => l.replace(/^package:|\s+$/g, '').trim()).filter(Boolean);
  if (!paths.length) return { ok: false, msg: '未找到 APK 路径' };
  const outDir = path.join(BASE_DIR, 'ApkExt');
  const saved = [];
  for (const rp of paths) {
    const dest = path.join(outDir, `${pkg}_${path.posix.basename(rp)}`);
    const p = await adb(['pull', rp, dest], serial, 300000);
    if (p.code === 0 && fs.existsSync(dest)) saved.push(path.basename(dest));
    else saved.push(`${path.posix.basename(rp)} 失败: ${(p.err || p.out).trim().split('\n').pop()}`);
  }
  log('提取', pkg, saved.join(', '));
  return { ok: saved.every((s) => !s.includes('失败')), msg: saved.join('\n'), dir: outDir };
});

// 批量恢复：逐个 pm enable，并用终态（pm list packages -d）复核，成败可逐个区分
ipcMain.handle('gapps:restore', async (_e, serial, pkgs) => {
  if (!Array.isArray(pkgs) || !pkgs.length) return { ok: false, msg: '没有需要恢复的包', results: [] };
  const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
  const results = [];
  for (const raw of pkgs) {
    const pkg = String(raw);
    if (!PKG_RE.test(pkg)) { results.push({ pkg, ok: false, msg: '非法包名，已跳过' }); continue; }
    const r = await adb(['shell', 'pm', 'enable', pkg], serial, 30000);
    const out = ((r.out || '') + (r.err || '')).trim();
    results.push({ pkg, ok: r.code === 0 && !/Exception|Error|not found/i.test(out), msg: out.split('\n').pop() || '已启用' });
  }
  // 终态复核：仍出现在禁用列表里的算失败
  const q = await adb(['shell', 'pm', 'list', 'packages', '-d'], serial, 30000);
  if (q.code === 0) {
    const stillDisabled = new Set((q.out || '').split('\n').map((l) => l.trim().replace(/^package:/, '')).filter(Boolean));
    for (const x of results) if (x.ok && stillDisabled.has(x.pkg)) { x.ok = false; x.msg = '仍处于禁用状态'; }
  }
  log('批量恢复 Google 组件', results.map((x) => x.pkg + ':' + (x.ok ? 'OK' : 'FAIL')).join(' '));
  return { ok: results.every((x) => x.ok), results };
});

// ---------- 截图 / 录屏 ----------
ipcMain.handle('screen:shot', async (_e, serial, opts) => {
  const toPc = !opts || opts.toPc !== false;
  const { code, buf } = await adbBinary(['exec-out', 'screencap', '-p'], serial);
  const dir = toPc ? path.join(BASE_DIR, 'Screenshots') : app.getPath('temp');
  if (code !== 0 || buf.length < 100) {
    return { ok: false, msg: '截图失败：' + buf.toString().slice(0, 120) };
  }
  const file = path.join(dir, `zian_${ts()}.png`);
  fs.writeFileSync(file, buf);
  log('截图', file);
  return { ok: true, msg: file, temp: !toPc, dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
});

const recordChildren = new Set();
let recordStopRequested = false;
let recordSerial = null;
let mirrorChild = null;   // scrcpy 屏幕镜像进程（与录屏互斥）

// ---------- 局域网互联 ----------
let currentLink = null;            // {ip, port, name, model, brand, ver}
const linksCacheFile = () => path.join(BASE_DIR, 'links.json');

function loadLinksCache() {
  try {
    // 容错 UTF-8 BOM（外部编辑器/脚本写入的文件可能带 BOM）
    const text = fs.readFileSync(linksCacheFile(), 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text || '[]');
  } catch { return []; }
}
function saveLinksCache(arr) {
  try { fs.writeFileSync(linksCacheFile(), JSON.stringify(arr, null, 2), 'utf8'); } catch {}
}

// ---------- 配对令牌（协议 v1.1） ----------
const TOKEN_RE = /^[0-9a-f]{32}$/;
let clipAuthFailed = false;   // 401 后停止剪贴板拉取，等重新配对（不静默重试）
let lastAuthWarn = 0;

/** 取鉴权令牌：显式 link 自带优先，否则用当前连接（令牌不下发到渲染层） */
function tokenOf(link) {
  return (link && link.token) || (currentLink && currentLink.token) || '';
}

/** 下发给渲染层前剥离令牌，只暴露是否已配对 */
function publicLink(link) {
  if (!link) return link;
  const { token, ...rest } = link;
  return { ...rest, paired: !!token };
}

/** 从 links.json 缓存按 ip 补令牌：扫描/自动重连会产生不带令牌的新对象 */
function attachCachedToken(link) {
  if (!link) return link;
  if (!link.token) {
    const c = loadLinksCache().find((d) => d.ip === link.ip && d.token);
    if (c) link.token = c.token;
  }
  link.paired = !!link.token;
  return link;
}

/** 401 统一出口：明确提示重新配对并限流，绝不静默重试 */
function warnUnauthorized() {
  clipAuthFailed = true;
  if (Date.now() - lastAuthWarn < 5000) return;
  lastAuthWarn = Date.now();
  log('鉴权失败 401：设备令牌不匹配，需要重新配对');
  notifyLink('net:unauthorized', { ok: false, msg: '设备要求配对码，请重新配对' });
}

/** GET /pair：只有回环来源（USB/adb forward）才会拿到令牌 */
function pairGetToken(ip, port) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: '/pair', timeout: 4000 }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        let j = null;
        try { j = JSON.parse(d); } catch {}
        if (r.statusCode === 200 && j && j.ok && TOKEN_RE.test(String(j.token || ''))) resolve({ ok: true, token: String(j.token) });
        else resolve({ ok: false, status: r.statusCode, msg: (j && j.err) || ('status ' + r.statusCode) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, msg: '配对请求超时' }); });
    req.on('error', () => resolve({ ok: false, msg: '配对请求失败' }));
  });
}

/** 只探测状态码、不下载正文：用于校验用户输入的配对码 */
function probeToken(ip, port, token) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: '/clipboard', timeout: 4000, headers: authHeaders(token) }, (r) => {
      const code = r.statusCode;
      r.destroy();
      resolve(code === 401 ? 'bad' : 'ok');
    });
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.on('error', () => resolve('error'));
  });
}

// UDP 多播扫描 + USB 附加发现：239.0.0.1:35791
ipcMain.handle('net:scan', async (_e, timeoutMs = 30000) => {
  const list = await lanScan(Math.min(60000, Math.max(3000, timeoutMs)));
  // 附加 USB 设备（优先选 USB transport_id，而非无线调试的 serial）
  try {
    const devs = await adb(['devices', '-l'], null, 8000);
    const rows = (devs.out || '').split('\n').slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length >= 2 && p[1] === 'device');
    // 优先选 transport_id 小的（USB 数据线通常先枚举），兜底第一个
    const pick = rows.sort((a, b) => {
      const ta = parseInt((a.find(x => /transport_id:(\d+)/.test(x)) || ['','999'])[1] || '999');
      const tb = parseInt((b.find(x => /transport_id:(\d+)/.test(x)) || ['','999'])[1] || '999');
      return ta - tb;
    })[0];
    const serial = pick ? pick[0] : null;
    if (serial && !serial.includes(':')) { // 无线设备 serial 带冒号
      const f = await adb(['forward', 'tcp:35791', 'tcp:35791'], serial, 8000);
      if (f.code === 0) {
        const info = await pingDevice('127.0.0.1', 35791);
        // 与 usbConnect 一致：通道地址必须钉住 127.0.0.1，否则 /ping 自报的 LAN IP 会覆盖它
        if (info) list.push({ ...pinUsb(info), serial });
      }
    }
  } catch {}
  return list.map((d) => publicLink(attachCachedToken(d)));
});

// ---------- USB 互联通道（adb forward，走 USB 数据线）----------
// forward 添加偶发瞬时失败（如上个实例残留 TIME_WAIT 占用本地端口），失败自动重试一次
async function tryForward(serial, local, remote) {
  let r = await adb(['forward', local, remote], serial, 8000);
  if (r.code !== 0) {
    await new Promise((res) => setTimeout(res, 500));
    r = await adb(['forward', local, remote], serial, 8000);
  }
  return r;
}

/** USB 通道地址固定为 127.0.0.1（防 /ping 自报 LAN IP 覆盖通道地址） */
const pinUsb = (info) => ({ ...info, ip: '127.0.0.1', port: 35791, usb: true, mode: 'usb' });

async function usbConnect() {
  const devs = await adb(['devices']);
  const serial = onlineSerials(devs.out)[0];
  if (!serial) return { ok: false, msg: '未发现 USB 连接的设备' };
  const f1 = await tryForward(serial, 'tcp:35791', 'tcp:35791');
  const f2 = await tryForward(serial, 'tcp:35792', 'tcp:35792');
  let info = await pingDevice('127.0.0.1', 35791);
  // 多开场景：本地转发端口可能已被另一个实例建立（adb 服务器共用一张转发表），
  // 此时 forward 命令报失败但通道其实可用——只有通道确实 ping 不通才算失败，否则第二个实例进不来。
  if ((f1.code !== 0 || f2.code !== 0) && !info) return { ok: false, msg: 'adb forward 失败' };
  if (!info) {
    // ping 失败：后台重试 3 次 × 1.5s，给互联桥恢复时间。
    // 注意：绝不唤醒屏幕或拉起 App——不发送任何按键，也不 am start。
    for (let i = 0; i < 3 && !info; i++) {
      await delay(1500);
      info = await pingDevice('127.0.0.1', 35791);
    }
    if (!info) return { ok: false, msg: 'USB 通道无法连通「梓安互联桥」（请确认手机端已安装并启动）' };
  }
  currentLink = { ...info, ...pinUsb({}), serial };
  // USB 通道在手机侧就是 127.0.0.1，/pair 会直接给出令牌；失败则回退缓存里的旧令牌
  const pr = await pairGetToken('127.0.0.1', 35791);
  if (pr.ok) currentLink.token = pr.token;
  else log('USB 自动配对未成功', pr.msg);
  attachCachedToken(currentLink);
  // 与 net:connect 一致：按 ip 去重后插入队首，保留历史 LAN 设备
  //（覆盖式写入会清空缓存里的其它设备）
  const cache = loadLinksCache().filter((d) => d.ip !== currentLink.ip);
  cache.unshift(currentLink);
  saveLinksCache(cache);
  startUsbWatch();
  return { ok: true, link: publicLink(currentLink) };
}

// ---------- USB 通道断线自动重连 ----------
let usbWatchTimer = null;
let usbFailCount = 0;

function notifyLink(ch, payload) {
  try {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, payload);
  } catch {}
}

function startUsbWatch() {
  if (usbWatchTimer) return;
  usbWatchTimer = setInterval(usbHealthCheck, 5000);
}

function stopUsbWatch() {
  if (usbWatchTimer) { clearInterval(usbWatchTimer); usbWatchTimer = null; }
  usbFailCount = 0;
}

// 每 5 秒 ping 一次；连续 2 次失败判定断线，自动重建 forward 重连。
// 若当前无连接但存在 USB 缓存（autoConnect 失败后的场景），每轮尝试重连。
async function usbHealthCheck() {
  const usbLink = currentLink && (currentLink.usb || currentLink.mode === 'usb');
  if (!usbLink && !currentLink) {
    // 无连接：有 USB 缓存则继续尝试恢复（手机重新插回时自动恢复）
    if (loadLinksCache().some((d) => d.usb || d.mode === 'usb' || d.ip === '127.0.0.1')) {
      const r = await usbConnect();
      if (r.ok) notifyLink('net:reconnected', currentLink);
      return;
    }
    stopUsbWatch();
    return;
  }
  if (!usbLink) { stopUsbWatch(); return; }   // 已切换为局域网连接
  const info = await pingDevice('127.0.0.1', 35791);
  if (info) {
    if (usbFailCount > 0) {
      usbFailCount = 0;
      // 同 usbConnect：ip/port 必须钉住 127.0.0.1，防 /ping 自报 IP 覆盖通道地址
      currentLink = { ...currentLink, ...pinUsb(info) };
      notifyLink('net:reconnected', publicLink(currentLink));
    }
    return;
  }
  usbFailCount++;
  if (usbFailCount === 2) notifyLink('net:linkstate', { state: 'reconnecting' });
  if (usbFailCount >= 2) {
    const r = await usbConnect();   // 成功则更新 currentLink 并继续 watch
    if (!r.ok) notifyLink('net:linkstate', { state: 'reconnecting' }); // 继续下轮重试
  }
}

// 局域网缓存重连（只认非 USB 缓存，且要求设备可达且在前台）
async function connectLanCache() {
  for (const dev of loadLinksCache().filter((d) => !d.usb)) {
    const info = await pingDevice(dev.ip, dev.port);
    if (info && info.fg !== false) {
      currentLink = { ...dev, ...info };
      attachCachedToken(currentLink);
      stopUsbWatch();
      return currentLink;
    }
  }
  return null;
}

// 局域网全量扫描后连接第一台（30s 窗口）
async function connectLanScan() {
  const list = await lanScan(30000);
  if (!list.length) return null;
  const info = await pingDevice(list[0].ip, list[0].port);
  currentLink = { ...list[0], ...(info || {}) };
  attachCachedToken(currentLink);
  // 与 net:connect 一致：按 ip 去重后插入队首，保留历史设备与令牌
  const cache = loadLinksCache().filter((d) => d.ip !== currentLink.ip);
  cache.unshift(currentLink);
  saveLinksCache(cache);
  stopUsbWatch();
  return currentLink;
}

// 自动连接：mode = auto | lan | usb
async function autoConnect(mode = 'auto') {
  if (mode === 'usb') {
    const r = await usbConnect();
    return r.ok ? currentLink : null;
  }
  if (mode === 'lan') {
    return (await connectLanCache()) || (await connectLanScan());
  }
  // ===== auto 模式：USB 优先 =====
  {
    const r = await usbConnect();
    if (r.ok) return currentLink;
  }
  const lan = (await connectLanCache()) || (await connectLanScan());
  if (lan) return lan;
  // 全部失败：若存在 USB 缓存，保持低频重试监控（手机重新插回时自动恢复）
  if (loadLinksCache().some((d) => d.usb || d.mode === 'usb' || d.ip === '127.0.0.1')) {
    startUsbWatch();
  }
  return null;
}
ipcMain.handle('net:autoconnect', async (_e, mode) => publicLink(await autoConnect(mode || 'auto')));

// 局域网 UDP 扫描与 ping 见 lib/net.js

ipcMain.handle('net:connect', async (_e, ip, port, opts = {}) => {
  // USB 设备：走 adb forward 通道
  if (opts.usb) {
    const r = await usbConnect();
    if (r.ok && currentLink) { const l = publicLink(currentLink); return { ok: true, link: l }; }
    return r;
  }
  const info = await pingDevice(ip, port || 35791);
  if (!info) return { ok: false, msg: `无法连接 ${ip}:${port}` };
  if (info.fg === false) return { ok: false, msg: '未发现设备：请打开手机上的「梓安互联桥」后再试' };
  currentLink = { ip, port: port || 35791, mode: 'lan', ...info };
  attachCachedToken(currentLink);   // 已配对设备从缓存继承令牌
  clipAuthFailed = false;
  stopUsbWatch();
  // 加入缓存
  const cache = loadLinksCache().filter((d) => d.ip !== ip);
  cache.unshift(currentLink);
  saveLinksCache(cache);
  return { ok: true, link: publicLink(currentLink) };
});

ipcMain.handle('net:disconnect', () => { currentLink = null; stopUsbWatch(); clipAuthFailed = false; return { ok: true }; });

// 局域网人工配对：校验手机 App 上显示的 32 位令牌，校验通过才落盘（错码不写缓存）
ipcMain.handle('net:pair', async (_e, link, code) => {
  const ep = endpointOf(link, currentLink);
  if (!ep) return { ok: false, msg: '未连接设备' };
  const token = String(code || '').trim().toLowerCase();
  if (!TOKEN_RE.test(token)) return { ok: false, msg: '配对码格式不对（应为 32 位十六进制）' };
  const probe = await probeToken(ep.ip, ep.port, token);
  if (probe === 'bad') return { ok: false, msg: '配对码不正确' };
  if (probe !== 'ok') return { ok: false, msg: '设备无响应，无法校验配对码' };
  if (currentLink && currentLink.ip === ep.ip) { currentLink.token = token; currentLink.paired = true; }
  const cache = loadLinksCache().filter((d) => d.ip !== ep.ip);
  const base = link && link.ip ? { ...link } : { ip: ep.ip, port: ep.port, mode: 'lan' };
  delete base.paired;
  cache.unshift({ ...base, token });
  saveLinksCache(cache);
  clipAuthFailed = false;
  log('配对成功', ep.ip);
  return { ok: true, paired: true };
});

// ---------- 超级剪贴板 ----------
let clipboardTimer = null;
let lastClipSig = '';
let echoGuard = '';
let lastPhoneWrittenSig = '';   // 最近一次从手机写回本机的内容 sig（手机端哈希），防重复写回
let lastFocusHint = 0;          // focusRequired 提示限流时间戳（不能每秒刷状态行）
const FOCUS_HINT_MS = 60000;
// 自动借焦点（focusRequired → 自动 GET /clipboard/pull）：手机端大多能直接拉起 1x1 透明界面，用户不必点通知
const AUTO_PULL_BASE_MS = 10000;      // 两次自动 pull 的最小间隔
const AUTO_PULL_BACKOFF_MS = 30000;   // 连续 2 次 pull 后仍 focusRequired 的退避间隔
const AUTO_PULL_TAP_MS = 60000;       // 手机端明确 launched:false（只能人工点通知）后的静默期
const TAP_HINT_MS = 60000;
let lastAutoPullAt = 0;
let autoPullStreak = 0;               // 连续「pull 过、后续仍 focusRequired」的次数
let autoPullAwaitingProof = false;    // 上一次自动 pull 还没有结果
let autoPullBackoffUntil = 0;
let autoPullInFlight = false;
let lastTapHint = 0;

// HTTP JSON 请求见 lib/net.js

ipcMain.handle('clipboard:get', async (_e, link) => {
  const ep = endpointOf(link, currentLink);
  if (!ep) return null;
  const r = await httpGetJson(ep.ip, ep.port, '/clipboard', 8000, 1, tokenOf(link));
  if (isUnauthorized(r)) { warnUnauthorized(); return null; }
  return r;
});

// 手机端 GET /clipboard/pull：借一次焦点读剪贴板并写入手机端缓存（TTL 60s）。
// Android 10+ 前台应用才能读剪贴板，所以后台只能走这条"借焦点"的路径。
// 手动按钮与自动借焦点共用本函数：令牌、超时、401 处理只有一份。
async function requestPhonePull(link) {
  const ep = endpointOf(link, currentLink);
  if (!ep) return { ok: false, msg: '未连接设备' };
  // retries=0：失败直接回报，绝不静默重试；401 走统一出口提示重新配对
  const r = await httpGetJson(ep.ip, ep.port, '/clipboard/pull', 8000, 0, tokenOf(link));
  if (isUnauthorized(r)) { warnUnauthorized(); return { ok: false, err: 'unauthorized', msg: '需要重新配对（401）' }; }
  if (!r) return { ok: false, msg: '设备无响应，请确认手机「梓安互联桥」仍在前台' };
  if (r.ok === false) return { ok: false, msg: String(r.err || '手机端拒绝了读取请求') };
  // launched=false：直接拉起透明界面被系统拦下，只能靠用户点通知
  return { ok: true, launched: r.launched !== false, focusRequired: !!r.focusRequired };
}

ipcMain.handle('clipboard:pull', async (_e, link) => {
  // 用户显式点击：不受自动限流约束，并把退避状态清零，下一次自动 pull 立刻可用
  lastAutoPullAt = 0;
  autoPullStreak = 0;
  autoPullAwaitingProof = false;
  autoPullBackoffUntil = 0;
  return requestPhonePull(link);
});

// 手动拉取到的内容由渲染层回传：走与自动同步同一条写回路径（防回环记账只有一份）
ipcMain.handle('clipboard:apply-remote', (e, remote) => {
  const okWrite = writeRemoteToLocal((ch, p) => { try { e.sender.send(ch, p); } catch {} }, remote);
  return { ok: okWrite, type: remote && remote.type, cached: !!(remote && remote.cached) };
});

// 推送剪贴板内容到手机 /clipboard（image 走 multipart，text 走 raw POST）
function pushClipToPhone(ip, port, payload, token) {
  return new Promise((resolve) => {
    let body, headers, timeout;
    if (payload.type === 'image') {
      const boundary = '----zian-clip-' + Date.now();
      const data = Buffer.from(payload.data, 'base64');
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.png"\r\nContent-Type: ${payload.mime || 'image/png'}\r\n\r\n`);
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      body = Buffer.concat([head, data, tail]);
      headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length };
      timeout = 10000;
    } else {
      body = Buffer.from(payload.data || '', 'utf8');
      headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) };
      timeout = 5000;
    }
    const req = http.request({ host: ip, port, path: '/clipboard', method: 'POST', headers: { ...headers, ...authHeaders(token) }, timeout }, (r) => {
      if (r.statusCode === 401) { warnUnauthorized(); resolve({ ok: false, err: 'unauthorized' }); return; }
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => resolve({ ok: /"ok"\s*:\s*true/i.test(d) }));
    });
    req.on('error', () => resolve({ ok: false, msg: 'push 失败' }));
    req.write(body);
    req.end();
  });
}

ipcMain.handle('clipboard:set', async (_e, link, payload) => {
  const ep = endpointOf(link, currentLink);
  if (!ep) return { ok: false, msg: '未连接设备' };
  // payload 为空时取本地剪贴板文本
  if (!payload) payload = { type: 'text', data: clipboard.readText() || '' };
  return pushClipToPhone(ep.ip, ep.port, payload, tokenOf(link));
});

// 读取本机剪贴板并计算内容 sig（格式与手机端对齐：type:len:md5前8）与推送 payload
function localClipSig() {
  const img = clipboard.readImage();
  if (!img.isEmpty()) {
    const png = img.toPNG();
    return {
      sig: 'img:' + png.length + ':' + crypto.createHash('md5').update(png).digest('hex').slice(0, 8),
      payload: { type: 'image', mime: 'image/png', data: png.toString('base64') }
    };
  }
  const t = clipboard.readText() || '';
  return {
    // 长度单位必须与手机端一致：HttpServer.java 用的是 UTF-8 字节数（raw.length），
    // 这里用字符数会让中文剪贴板的 sig 永远对不上
    sig: 'txt:' + Buffer.byteLength(t, 'utf8') + ':' + crypto.createHash('md5').update(t).digest('hex').slice(0, 8),
    payload: { type: 'text', data: t }
  };
}

/** 把手机端 /clipboard 内容写回本机剪贴板。
 *  自动同步与手动「从手机读剪贴板」共用这一条路径：防回环记账（echoGuard / lastClipSig / lastPhoneWrittenSig）
 *  只有一份，否则手动写回的内容会被下一 tick 当成"本地新内容"推回手机。返回是否真的写了。 */
function writeRemoteToLocal(send, remote) {
  const remoteSig = (remote && remote.sig) || '';
  if (remoteSig && remoteSig === echoGuard) {
    // 防回环令牌一次性化：匹配（这是我方推送内容的回传）后立即清空。
    // 残留不清理的话，之后任何时刻用户在手机上手动复制相同内容都会被误忽略，
    // 尤其是推送失败场景残留的 sig 会永久屏蔽该内容的手机→PC 同步
    echoGuard = '';
    return false;
  }
  // empty/intent 的 sig 是空串，不参与回环判定
  if (!remoteSig) return false;
  if (remoteSig === lastClipSig || remoteSig === lastPhoneWrittenSig) return false;
  lastPhoneWrittenSig = remoteSig;
  const cached = !!remote.cached;   // 手机端返回的是"借焦点读到的缓存"（TTL 60s）
  if (remote.type === 'text') {
    try {
      const text = Buffer.from(remote.data, 'base64').toString('utf8');
      clipboard.writeText(text);
      send('clipboard:remote', { type: 'text', data: text, cached });
    } catch { return false; }
  } else if (remote.type === 'image') {
    try {
      const buf = Buffer.from(remote.data, 'base64');
      const img2 = nativeImage.createFromBuffer(buf, { scaleFactor: 1 });
      if (img2.isEmpty()) return false;
      clipboard.writeImage(img2);
      send('clipboard:remote', { type: 'image', mime: remote.mime, data: remote.data, cached });
    } catch { return false; }
  } else {
    return false;
  }
  // 写回后重算本机实际 sig 并同步记录：内容经剪贴板重编码后哈希会变，
  // 不重算的话下一 tick 会误判"本地有新内容"再推回手机，形成双向死循环
  const back = localClipSig();
  if (back.sig) { lastClipSig = back.sig; echoGuard = back.sig; }
  return true;
}

/** 手机端后台读不到剪贴板（Android 10+ 焦点闸门）时提示人工入口，限流 60s 一次：自动同步每秒一轮，不能每秒刷 */
function notifyFocusRequired(send) {
  if (Date.now() - lastFocusHint < FOCUS_HINT_MS) return false;
  lastFocusHint = Date.now();
  send('clipboard:focus-required', { msg: '手机端后台读不到剪贴板，点「从手机读剪贴板」或让互联桥在前台' });
  return true;
}

/** 手机端直接拉起被拦（只能人工点通知）：提示一次，配合退避静默，绝不进入每秒重试 */
function notifyTapRequired(send) {
  if (Date.now() - lastTapHint < TAP_HINT_MS) return false;
  lastTapHint = Date.now();
  send('clipboard:tap-required', { msg: '手机端拦下了后台读取，请在手机上点一下通知' });
  return true;
}

/** focusRequired 时自动借一次焦点（GET /clipboard/pull），成功后下一轮轮询即可拿到 cached 内容。
 *  限流：两次自动 pull 至少 10s；pull 之后连续 2 轮仍 focusRequired 退避到 30s；
 *  手机端明确 launched:false（被系统拦截）静默 60s，只留人工入口。 */
function maybeAutoPull(send) {
  if (!currentLink || autoPullInFlight) return false;
  const now = Date.now();
  if (now < autoPullBackoffUntil) return false;
  const gap = autoPullStreak >= 2 ? AUTO_PULL_BACKOFF_MS : AUTO_PULL_BASE_MS;
  if (lastAutoPullAt && now - lastAutoPullAt < gap) return false;
  lastAutoPullAt = now;
  autoPullAwaitingProof = true;
  autoPullInFlight = true;
  requestPhonePull(currentLink).then((r) => {
    autoPullInFlight = false;
    if (!r || !r.ok) return;
    if (r.launched === false) {
      autoPullStreak += 1;
      autoPullBackoffUntil = Date.now() + AUTO_PULL_TAP_MS;
      notifyTapRequired(send);
    }
  }).catch(() => { autoPullInFlight = false; });
  return true;
}

ipcMain.handle('clipboard:watch:start', (e) => {
  if (clipboardTimer) clearInterval(clipboardTimer);
  lastClipSig = '';
  echoGuard = '';
  lastPhoneWrittenSig = '';
  lastFocusHint = 0;             // 新开启的会话允许立刻提示一次
  lastTapHint = 0;
  lastAutoPullAt = 0;
  autoPullStreak = 0;
  autoPullAwaitingProof = false;
  autoPullBackoffUntil = 0;
  clipAuthFailed = false;
  let tickBusy = false;          // tick 防重入：上一轮 await 未完成时跳过本轮
  let pushFailUntil = 0;         // 推送失败退避：在此之前不重推（防止对不可达设备每秒重试风暴）
  clipboardTimer = setInterval(async () => {
    if (tickBusy) return;
    tickBusy = true;
    try {
      // 1. 本地剪贴板变化 → 推送到手机
      const local = localClipSig();
      let pushed = false;
      if (local.sig && local.sig !== lastClipSig && Date.now() > pushFailUntil) {
        if (currentLink) {
          // 必须检查返回值：pushClipToPhone 失败走 resolve({ok:false}) 不抛异常。
          // 只有推送成功才记录 sig——失败时保留旧记录让下一 tick 自动重试（带退避），
          // 且失败不再跳过拉取，否则手机旧内容会把本机刚复制的内容覆盖掉（内容丢失）
          const r = await pushClipToPhone(currentLink.ip, currentLink.port, local.payload, currentLink.token);
          if (r && r.ok) {
            pushed = true;
            lastClipSig = local.sig;
            echoGuard = local.sig;   // 防止手机端 /clipboard 回传时反向推送回来
          } else {
            if (r && r.err === 'unauthorized') warnUnauthorized();
            pushFailUntil = Date.now() + 8000;
          }
        } else {
          lastClipSig = local.sig;   // 无连接：仅记录，连接后由回环机制决定方向
        }
      }

      // 2. 拉取手机剪贴板
      if (!currentLink) return;
      // 刚推送过就本轮不拉取：手机端还没应用本次推送，拉到的旧内容会被误写回本机、
      // 覆盖刚复制的内容（推送/拉取竞态），等下一 tick 手机端已更新后再拉
      if (pushed) return;
      if (clipAuthFailed) return;   // 401 后不静默重试：等用户重新配对
      const remote = await httpGetJson(currentLink.ip, currentLink.port, '/clipboard', 8000, 1, currentLink.token);
      if (isUnauthorized(remote)) { warnUnauthorized(); return; }
      if (!remote) return;
      const send = (ch, p) => { try { e.sender.send(ch, p); } catch {} };
      // 手机端在后台读不到剪贴板（且缓存已过期）：自动借一次焦点，并按限流/退避提示
      if (remote.type === 'empty' && remote.focusRequired) {
        // 上一轮自动 pull 之后仍读不到：累计无果次数，用于把间隔退避到 30s
        if (autoPullAwaitingProof) { autoPullAwaitingProof = false; autoPullStreak += 1; }
        if (autoPullStreak >= 2) notifyTapRequired(send);
        else notifyFocusRequired(send);
        maybeAutoPull(send);
        return;
      }
      // 拿到真内容：借焦点链路有效，退避计数清零
      if (remote.type !== 'empty') { autoPullStreak = 0; autoPullAwaitingProof = false; }
      // 手机端 sig 本身已是 "txt:<len>:<hash8>" / "img:<len>:<hash8>"（与 localClipSig 同格式），
      // 再拼一次类型前缀会得到 "txt:txt:…" 永远对不上，所以回环判定统一放在共用写回函数里
      writeRemoteToLocal(send, remote);
    } finally {
      tickBusy = false;
    }
  }, 1000);
  return { ok: true };
});

ipcMain.handle('clipboard:watch:stop', () => {
  if (clipboardTimer) clearInterval(clipboardTimer);
  clipboardTimer = null;
  return { ok: true };
});

// ---------- 文件同步（局域网） ----------

ipcMain.handle('files:list', async (_e, link, type, dir) => {
  const ep = endpointOf(link, currentLink);
  if (!ep) return null;
  let q = '/files?type=' + encodeURIComponent(type || 'all');
  if (dir) q += '&dir=' + encodeURIComponent(dir);
  // 15s 长超时；null=失败（区别于 [] = 真空分类），失败不缓存
  const r = await httpGetJson(ep.ip, ep.port, q, 15000, 1, tokenOf(link));
  if (isUnauthorized(r)) { warnUnauthorized(); return null; }
  return Array.isArray(r) ? r : null;
});

ipcMain.handle('files:pull', async (e, link, remotePath, savePath) => {
  const ep = endpointOf(link, currentLink);
  if (!ep) return { ok: false, msg: '未连接设备' };
  const ip = ep.ip;
  const port = ep.port;
  // savePath 留空时自动用 BASE_DIR/Synced + 文件名
  if (!savePath) {
    const dir = path.join(BASE_DIR, 'Synced');
    fs.mkdirSync(dir, { recursive: true });
    let name = safeWinName(path.basename(remotePath || ('file_' + Date.now())));
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name = name + '_' + ts() + '.bin';
    savePath = path.join(dir, name);
  } else {
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
  }
  return new Promise((resolve) => {
    // NanoHTTPD 按 URLDecoder 语义解码 query：字面 '+' 会被解成空格，所以 '+' 必须写成 %2B。
    // encodeURIComponent 本身已把 '+' 编码为 %2B，这里再显式替换一次，避免日后改用弱编码函数时静默回归
    const req = http.get({ host: ip, port, path: '/file?path=' + encodeURIComponent(remotePath).replace(/\+/g, '%2B'), timeout: 0, agent: false, headers: authHeaders(tokenOf(link)) }, (res) => {
      if (res.statusCode === 401) { res.destroy(); warnUnauthorized(); resolve({ ok: false, msg: '需要重新配对（401）' }); return; }
      if (res.statusCode !== 200) {
        let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ ok: false, msg: 'status ' + res.statusCode + ' ' + d.slice(0, 100) }));
        return;
      }
      // Content-Disposition 经 NanoHTTPD 用 ISO-8859-1 写出，中文文件名在线路上会变成
      // 字面 '?'（Windows 非法字符 → 保存时 ENOENT）。只接受未被污染的可打印 ASCII 名，
      // 否则沿用 remotePath 里的原始文件名（UTF-8 JSON 来源，可靠）。
      const cd = res.headers['content-disposition'] || '';
      const m = cd.match(/filename="([^"]+)"/);
      if (m && m[1] && /^[\x20-\x7e]+$/.test(m[1]) && !/[<>:"/\\|?*]/.test(m[1])) {
        savePath = path.join(path.dirname(savePath), m[1]);
      }
      const total = parseInt(res.headers['content-length'] || '0');
      let recv = 0;
      const ws = fs.createWriteStream(savePath);
      res.on('data', (c) => {
        recv += c.length;
        if (total > 0) {
          const pct = Math.round(recv * 100 / total);
          try { e.sender.send('files:progress', pct); } catch {}
        }
      });
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve({ ok: true, msg: savePath, size: recv }); });
      ws.on('error', (err) => { res.destroy(); resolve({ ok: false, msg: err.message }); });
    });
    req.on('error', (err) => resolve({ ok: false, msg: err.message }));
  });
});

ipcMain.handle('files:push', async (e, link, localPath, remoteDir) => {
  const ep = endpointOf(link, currentLink);
  if (!ep) return { ok: false, msg: '未连接设备' };
  const ip = ep.ip;
  let stat;
  try { stat = fs.statSync(localPath); } catch (err) { return { ok: false, msg: '读取本地文件失败: ' + err.message }; }
  const name = path.basename(localPath);
  const PORT = 35792;  // raw TCP 文件接收端口
  const isUsb = ip === '127.0.0.1' || ip === 'localhost';

  function attempt() {
    return new Promise((resolve) => {
      const sock = net.connect({ host: ip, port: PORT, allowHalfOpen: true });
      let done = false;
      let resp = '';
      let lastData = Date.now();
      const finish = (r) => { if (!done) { done = true; clearInterval(guard); try { sock.destroy(); } catch {} resolve(r); } };
      const connectT = setTimeout(() => finish({ ok: false, msg: '连接超时', retryable: true }), 6000);
      // 停滞保护：30s 无任何字节进展视为通道故障，避免无限挂起
      const guard = setInterval(() => {
        if (Date.now() - lastData > 30000) finish({ ok: false, msg: '传输停滞超时', retryable: true });
      }, 5000);
      sock.on('error', (err) => { clearTimeout(connectT); finish({ ok: false, msg: err.message, retryable: true }); });
      sock.on('close', () => {
        clearTimeout(connectT);
        finish({ ok: false, msg: 'connection closed before response', retryable: true });
      });
      sock.on('connect', () => {
        clearTimeout(connectT);
        lastData = Date.now();
        // 协议 v1.1：令牌 + \n + 目标目录 + \n + 文件名 + \n + 长度 + \n + raw bytes
        const header = Buffer.from(tokenOf(link) + '\n' + remoteDir + '\n' + name + '\n' + stat.size + '\n', 'utf8');
        sock.write(header);
        const rs = fs.createReadStream(localPath, { highWaterMark: 1 << 20 });
        let sent = 0;
        rs.on('data', (c) => {
          sent += c.length;
          lastData = Date.now();
          const pct = Math.round(sent * 100 / stat.size);
          try { e.sender.send('files:progress', pct); } catch {}
        });
        rs.on('error', (err) => finish({ ok: false, msg: err.message }));
        // 关键：数据发完后【不能】sock.end() 半关闭——adb forward 中继会把 PC 的 FIN
        // 当作连接结束并提前关掉到手机的中继，导致手机端的 OK/ERR 响应永远回不来
        //（Wi-Fi 直连没事，USB 通道必挂）。保持写端打开，等响应后由 finish() 关闭。
        rs.pipe(sock, { end: false });
      });
      // 读取响应（OK / ERR）
      sock.on('data', (c) => {
        lastData = Date.now();
        resp += c.toString('utf8');
        if (resp.includes('\n')) finish({ ok: /^OK/.test(resp), msg: resp.trim() });
      });
    });
  }

  let r = await attempt();
  // 通道类失败（连接错误/被关闭/超时）自动重建通道后重试一次；
  // 服务端明确返回 ERR（手机端写文件失败等）不重试。
  if (!r.ok && r.retryable) {
    if (isUsb) { try { await usbConnect(); } catch {} }
    else { try { await pingDevice(ip, link ? link.port : (currentLink && currentLink.port) || 35791); } catch {} }
    await new Promise((res) => setTimeout(res, 800));
    r = await attempt();
  }
  return r;
});

ipcMain.handle('files:open-in-vivo', async (_e, link, remotePath) => {
  const ep = endpointOf(link, currentLink);
  if (!ep) return { ok: false, msg: '未连接设备' };
  const r = await httpGetJson(ep.ip, ep.port, '/open?path=' + encodeURIComponent(remotePath) + '&app=vivo_office', 8000, 1, tokenOf(link));
  if (isUnauthorized(r)) { warnUnauthorized(); return { ok: false, msg: '需要重新配对（401）' }; }
  return r || { ok: false };
});

// 缩略图：<img src> 无法携带鉴权头（协议 v1.1 要求 X-Zian-Token），手机端开启鉴权后直连必 401。
// 渲染层在图片 onerror 时回落到这里：主进程带令牌抓图后回传 data URL。
ipcMain.handle('files:thumb', async (_e, link, remotePath) => {
  const ep = endpointOf(link, currentLink);
  if (!ep) return { ok: false, msg: '未连接设备' };
  return new Promise((resolve) => {
    const q = '/thumb?path=' + encodeURIComponent(remotePath || '').replace(/\+/g, '%2B');
    const req = http.get({ host: ep.ip, port: ep.port, path: q, timeout: 8000, headers: authHeaders(tokenOf(link)) }, (res) => {
      if (res.statusCode === 401) { res.destroy(); warnUnauthorized(); resolve({ ok: false, msg: '需要重新配对（401）' }); return; }
      if (res.statusCode !== 200) { res.destroy(); resolve({ ok: false, msg: 'status ' + res.statusCode }); return; }
      const ct = String(res.headers['content-type'] || 'image/jpeg');
      if (!/^image\/[a-z0-9.+-]+$/i.test(ct)) { res.destroy(); resolve({ ok: false, msg: '非图片响应' }); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 8 * 1024 * 1024) { res.destroy(); resolve({ ok: false, msg: '缩略图过大' }); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ ok: true, dataUrl: 'data:' + ct + ';base64,' + Buffer.concat(chunks).toString('base64') }));
      res.on('error', () => resolve({ ok: false, msg: '读取失败' }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, msg: '超时' }); });
    req.on('error', () => resolve({ ok: false, msg: '连接失败' }));
  });
});

// ---------- 屏幕镜像（scrcpy 弹窗 + 键鼠控制） ----------
ipcMain.handle('mirror:start', async (_e, serial, withControl = true) => {
  if (!serial) return { ok: false, msg: '请先选择 USB/无线调试设备' };
  if (recordChildren.size > 0) return { ok: false, msg: '镜像与录屏互斥，请先停止当前录屏' };
  if (mirrorChild) try { mirrorChild.kill(); } catch {}
  // scrcpy 弹窗 + 键鼠控制：不加 --no-window，不加 --record
  // scrcpy 3.x：--no-key-repeat 仅与 --keyboard=sdk 搭配；--stay-awake 仅在有控制时可用
  // scrcpy 3.x 需要显式指定 adb 路径（不再自动使用同目录/内置 adb）
  const args = ['-s', serial, '--no-audio-playback', '--max-size=1920', '--video-bit-rate=12M'];
  if (withControl) args.push('--stay-awake', '--keyboard=sdk', '--no-key-repeat');
  else args.push('--no-control');
  const child = spawn(SCRCPY, args, { windowsHide: false, cwd: path.dirname(SCRCPY), detached: false, env: { ...process.env, ADB } });
  mirrorChild = child;
  let errBuf = '';
  child.stderr.on('data', (d) => { errBuf += d.toString(); });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: true, msg: 'scrcpy 镜像已启动' }), 1500);
    child.on('error', () => { clearTimeout(t); if (mirrorChild === child) mirrorChild = null; resolve({ ok: false, msg: 'scrcpy 启动失败' }); });
    child.on('close', (code) => {
      clearTimeout(t);
      // 只清理自己：旧进程的 close 晚于新进程 spawn 时无条件置空会抹掉新引用，
      // 镜像互斥因此失效（录屏会在 scrcpy 仍在跑时启动）
      if (mirrorChild === child) mirrorChild = null;
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('mirror:stopped');
      if (code !== 0 && errBuf) resolve({ ok: false, msg: 'scrcpy 异常退出: ' + errBuf.slice(0, 200) });
      // 已经 resolve 过就直接返回
    });
  });
});

ipcMain.handle('mirror:stop', () => {
  if (mirrorChild) { try { mirrorChild.kill(); } catch {}; mirrorChild = null; return { ok: true, msg: '镜像已停止' }; }
  return { ok: false, msg: '当前没有进行中的镜像' };
});

// ---------- 结束录制：杀设备端 scrcpy server，客户端正常收尾关闭 mp4 ----------
ipcMain.handle('screen:record-stop', async () => {
  if (!recordChildren.size) return { ok: false, msg: '当前没有进行中的录屏' };
  recordStopRequested = true;
  for (const c of [...recordChildren]) {
    try {
      if (/scrcpy/i.test(String(c.spawnfile || ''))) {
        await adb(['shell', 'pkill -f com.genymobile.scrcpy.Server'], recordSerial, 8000);
      }
    } catch {}
  }
  return { ok: true, msg: '正在结束录制并保存文件…' };
});

// 音轨响度检测：silent=纯静音 ok=有声 noaudio=无音轨
function audioLevel(p, ff) {
  return new Promise((res) => {
    if (!ff) return res('unknown');
    execFile(ff, ['-hide_banner', '-i', p, '-map', '0:a:0?', '-af', 'volumedetect', '-f', 'null', '-'],
      { timeout: 60000, windowsHide: true }, (err, so, se) => {
        const out = String((se || '') + (so || ''));
        const m = out.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
        if (!m) return res('noaudio');
        res(parseFloat(m[1]) <= -70 ? 'silent' : 'ok');
      });
  });
}

// ffmpeg：优先用内置的，其次找系统 PATH
async function findFFmpeg() {
  const bundled = path.join(RES_DIR, 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;
  return new Promise((res) => {
    execFile('ffmpeg', ['-version'], { timeout: 5000, windowsHide: true }, (err) => res(err ? '' : 'ffmpeg'));
  });
}

// 兜底超时：录屏进程正常运行时几乎不写 stderr，不能按"无输出"判定（会误杀正常录制），
// 只按总时长上限 = --time-limit + 90s 收尾余量。超时强杀并清 recordChildren，
// 否则卡死的进程会永久占用录屏互斥锁，之后所有录屏/镜像请求都被拒绝
function runScrcpy(args, timeoutMs) {
  return new Promise((res) => {
    const c = spawn(SCRCPY, args, { windowsHide: true, cwd: path.dirname(SCRCPY), env: { ...process.env, ADB } });
    let err = '';
    let done = false;
    let timer = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      recordChildren.delete(c);
      res(r);
    };
    timer = setTimeout(() => {
      try { c.kill(); } catch {}
      finish({ code: -1, err: (err || '') + '\n[录屏超时 ' + Math.round(timeoutMs / 1000) + 's，已强制结束]' });
    }, timeoutMs);
    c.stderr.on('data', (d) => { err += d.toString(); });
    recordChildren.add(c);
    c.on('error', () => finish({ code: -1, err: 'scrcpy 启动失败' }));
    c.on('close', (code) => finish({ code, err }));
  });
}

ipcMain.handle('screen:record', async (e, serial, seconds, audioMode) => {
  seconds = Math.min(180, Math.max(3, parseInt(seconds) || 30));
  if (recordChildren.size) return { ok: false, msg: '已有录屏进行中' };
  if (mirrorChild) return { ok: false, msg: '镜像与录屏互斥，请先停止屏幕镜像' };
  recordStopRequested = false;
  recordSerial = serial;
  const send = (st) => { try { e.sender.send('record:state', st); } catch {} };
  const sendNote = (msg) => { log('录制提示', msg); send({ state: 'note', msg }); };
  const local = path.join(BASE_DIR, 'Screenshots', `zian_rec_${ts()}.mp4`);
  const audio = audioMode || 'none';
  const modeName = audio === 'playback' ? '设备内录' : audio === 'mic' ? '手机麦克风' : audio === 'output' ? '系统总输出' : '无声';

  try { fs.rmSync(local, { force: true }); } catch {}

  // scrcpy 单实例录视频+音频到文件；电脑端全程无声（--no-audio-playback），无窗口
  const args = ['-s', serial, '--no-window', '--no-audio-playback', '--record=' + local, '--time-limit=' + String(seconds)];
  if (audio === 'none') args.push('--no-audio');
  else args.push('--audio-source=' + audio);

  send({ state: 'recording', seconds });
  log('scrcpy 录屏开始', modeName, '时长', seconds, '秒');

  const r = await runScrcpy(args, seconds * 1000 + 90000);

  // 手动停止：杀设备端 scrcpy server，客户端正常收尾关闭 mp4
  if (recordStopRequested) {
    if (fileOk(local, 5000)) {
      log('录屏已保存', local, '(scrcpy·' + modeName + '·手动停止)');
      send({ state: 'done', path: local });
      return { ok: true, msg: `录屏已保存（${modeName}）` };
    }
    send({ state: 'error', msg: '录制停止但文件未生成' });
    return { ok: false, msg: '文件未生成' };
  }

  // 到时正常结束
  if (r.code !== 0 || !fileOk(local, 5000)) {
    const err = lastErrLine(r.err);
    log('scrcpy 录屏失败', err);
    send({ state: 'error', msg: '录屏失败: ' + err.slice(0, 120) });
    return { ok: false, msg: '录屏失败: ' + err.slice(0, 120) };
  }

  // 音轨检测提示
  if (audio !== 'none') {
    const lv = await audioLevel(local, await findFFmpeg());
    if (lv === 'silent') sendNote('音轨为纯静音：录制期间手机未播放声音，或 vivo 音频路由限制导致内录静音');
    else if (lv === 'noaudio') sendNote('视频无音轨');
  }

  log('录屏已保存', local, '(scrcpy·' + modeName + ')');
  send({ state: 'done', path: local });
  return { ok: true, msg: `录屏 ${seconds} 秒已保存（${modeName}）` };
});

// ---------- 文件传输 ----------
// 推送后刷新相册媒体索引（MediaStore scan_volume，Android 10+ 通用）
async function mediaScan(serial) {
  await adb(['shell', 'content call --uri content://media/ --method scan_volume --arg external_primary'], serial, 15000);
}

ipcMain.handle('file:push', async (e, serial, destDir) => {
  const r = await dialog.showOpenDialog(mainWin, { title: '选择要推送到手机的文件', properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return { ok: false, msg: '已取消' };
  let dest = (destDir || '/sdcard/Download/').trim() || '/sdcard/Download/';
  if (!dest.startsWith('/')) dest = '/' + dest;
  const destNoSlash = dest.replace(/\/+$/, '');
  await adb(['shell', `mkdir -p "${destNoSlash}"`], serial, 15000);
  const results = [];
  let allOk = true;
  for (const p of r.filePaths) {
    const remotePath = destNoSlash + '/' + path.basename(p);
    const res = await adb(['push', p, remotePath], serial, 600000);
    // 校验文件确实存在于设备端
    const check = await adb(['shell', `ls -l "${remotePath}"`], serial, 15000);
    const ok = check.code === 0 && /\d{4}-\d|-\d+\s+\?{0,2}|[rwx-]{9}/.test(check.out) && !/No such file/i.test(check.out + check.err);
    if (ok) {
      await mediaScan(serial);
      results.push(`${path.basename(p)}: 已推送 → ${remotePath} (${check.out.trim().split(/\s+/)[4] || '?'} 字节)`);
    } else {
      allOk = false;
      results.push(`${path.basename(p)}: 推送失败 ${(res.err || res.out || '').trim().split('\n').pop()}`);
    }
    log('推送', path.basename(p), ok ? remotePath : '失败');
  }
  results.push('提示: 已触发相册刷新，若相册未立即显示请稍等几秒或重启相册应用');
  return { ok: allOk, msg: results.join('\n') };
});

// ---------- 重启 ----------
ipcMain.handle('reboot', async (_e, serial, mode) => {
  const map = {
    system: ['reboot'],
    shutdown: ['shell', 'reboot -p'],
    recovery: ['reboot', 'recovery'],
    bootloader: ['reboot', 'bootloader'],
    fastbootd: ['reboot', 'fastboot'],
    edl: ['reboot', 'edl']
  };
  const args = map[mode];
  if (!args) return { ok: false, msg: '未知模式' };
  const r = await adb(args, serial, 15000);
  return { ok: r.code === 0, msg: r.code === 0 ? '指令已发送，设备重启中…' : (r.err || '失败').trim() };
});

// ---------- 脚本 ----------
ipcMain.handle('script:list', async () => {
  const dir = path.join(BASE_DIR, 'Script');
  try {
    return fs.readdirSync(dir).filter((f) => /\.(bat|cmd)$/i.test(f));
  } catch { return []; }
});
// ---------- 日志 ----------
let logcatChild = null;
ipcMain.handle('logcat:start', (e, serial) => {
  if (logcatChild) { logcatChild.kill(); logcatChild = null; }
  const args = serial ? ['-s', serial, 'logcat', '-v', 'time'] : ['logcat', '-v', 'time'];
  logcatChild = spawn(ADB, args, { windowsHide: true });
  let buf = '';
  logcatChild.stdout.on('data', (c) => {
    buf += c.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('logcat:data', lines.join('\n'));
  });
  logcatChild.on('error', (err) => { logcatChild = null; try { e.sender.send('logcat:data', 'logcat 启动失败: ' + err.message); } catch {} });
  return { ok: true, msg: '日志流已开启' };
});
ipcMain.handle('logcat:stop', () => {
  if (logcatChild) { logcatChild.kill(); logcatChild = null; }
  return { ok: true, msg: '日志流已停止' };
});

// ---------- 其他 ----------
// 文件管理器：选择本地文件导入到手机
ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: '选择要导入的文件',
    properties: ['openFile', 'multiSelections']
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));

// ---------- 启动流程 ----------
// 不加单实例锁：用户要求支持多开，每个实例各自建窗、各自连设备，互不干扰
app.whenReady().then(() => {
  if (!fs.existsSync(ADB)) {
    dialog.showErrorBox('梓安搞机工具箱', '未找到 ADB 组件 (resources/adb/adb.exe)，请重新解压完整程序。');
    app.quit();
    return;
  }
  log('=== 梓安搞机工具箱启动 ===');
  createMainWindow();
  createSplash();
  // 异步触发局域网自动连接（不阻塞窗口加载，前端在 did-finish-load 时主动调 netAutoconnect）
  // 这里仅做一次后台扫描预热，让多播 socket 提前建立
  setTimeout(() => {
    autoConnect().then((link) => {
      if (link) log('局域网自动连接:', link.name, link.ip);
      if (link && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('net:autoconnected', publicLink(link));
    }).catch(() => {});
  }, 1000);
});

app.on('window-all-closed', () => {
  if (logcatChild) logcatChild.kill();
  if (mirrorChild) try { mirrorChild.kill(); } catch {}
  for (const c of [...recordChildren]) try { c.kill(); } catch {}
  app.quit();
});
