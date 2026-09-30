const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const dgram = require('dgram');
const http = require('http');
const os = require('os');

// ---------- 路径解析 ----------
const RES_DIR = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources');
const ADB = path.join(RES_DIR, 'adb', 'adb.exe');
const SCRCPY = path.join(RES_DIR, 'scrcpy', 'scrcpy.exe');

// 数据目录（截图/APK导出/脚本）：优先 exe 同级目录，失败则回退到文档目录
function setupDirs() {
  let base;
  try {
    base = app.isPackaged ? path.dirname(process.execPath) : __dirname;
    ['Screenshots', 'ApkExt', 'Script', 'Log'].forEach((d) =>
      fs.mkdirSync(path.join(base, d), { recursive: true })
    );
  } catch {
    base = app.getPath('documents');
    ['Screenshots', 'ApkExt', 'Script', 'Log'].forEach((d) =>
      fs.mkdirSync(path.join(base, '梓安工具箱', d), { recursive: true })
    );
    base = path.join(base, '梓安工具箱');
  }
  return base;
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
      nodeIntegration: false
    }
  });
  mainWin.loadFile('index.html');
  mainWin.webContents.on('did-finish-load', () => {
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

// ---------- ADB 执行封装 ----------
function adb(args, serial = null, timeout = 30000) {
  return new Promise((resolve) => {
    const finalArgs = serial ? ['-s', serial, ...args] : [...args];
    const child = execFile(ADB, finalArgs, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({ code: err ? (err.code ?? 1) : 0, out: (stdout || '').toString(), err: (stderr || '').toString() });
      });
    child.on('error', () => {});
  });
}

// 二进制输出（截图用）
function adbBinary(args, serial) {
  return new Promise((resolve) => {
    const finalArgs = serial ? ['-s', serial, ...args] : [...args];
    const child = spawn(ADB, finalArgs, { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    child.on('close', (code) => resolve({ code, buf: Buffer.concat(chunks) }));
    child.on('error', (e) => resolve({ code: -1, buf: Buffer.from(String(e)) }));
  });
}

function parseDevices(text) {
  const list = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload)\b\s*(.*)$/);
    if (!m) continue;
    const modelM = m[3].match(/model:(\S+)/);
    list.push({ serial: m[1], state: m[2], model: modelM ? modelM[1] : '' });
  }
  return list;
}

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function log(...msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg.join(' ')}`;
  fs.appendFileSync(path.join(BASE_DIR, 'Log', 'zian.log'), line + '\n');
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
  const bat = {};
  for (const line of battery.out.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z ]+?):\s*(.+?)\s*$/);
    if (m && bat[m[1].trim()] === undefined) bat[m[1].trim()] = m[2].trim();
  }
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
  const bat = {};
  for (const line of (b.out || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z ]+?):\s*(.+?)\s*$/);
    if (m && bat[m[1]] === undefined) bat[m[1]] = m[2];
  }
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
ipcMain.handle('app:list', async (_e, serial) => {
  const [third, sys] = await Promise.all([
    adb(['shell', 'pm', 'list', 'packages', '-3'], serial, 30000),
    adb(['shell', 'pm', 'list', 'packages', '-s'], serial, 30000)
  ]);
  const parse = (t) => t.split('\n').map((l) => l.replace(/^package:|\s+$/g, '').trim()).filter(Boolean);
  return { third: parse(third.out), sys: parse(sys.out) };
});

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

ipcMain.handle('app:uninstall', async (_e, serial, pkg) => {
  let r = await adb(['uninstall', pkg], serial, 60000);
  let out = (r.out || r.err).trim();
  if (!/Success/i.test(out)) {
    // 系统应用尝试 --user 0 卸载
    r = await adb(['shell', 'pm', 'uninstall', '--user', '0', pkg], serial, 60000);
    out = (r.out || r.err).trim();
  }
  log('卸载', pkg, out);
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
        if (info) list.push({ ip: '127.0.0.1', port: 35791, usb: true, serial, mode: 'usb', ...info });
      }
    }
  } catch {}
  return list;
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

async function usbConnect() {
  const devs = await adb(['devices']);
  const serial = (devs.out || '').split('\n').slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map((p) => p[0])[0];
  if (!serial) return { ok: false, msg: '未发现 USB 连接的设备' };
  const f1 = await tryForward(serial, 'tcp:35791', 'tcp:35791');
  const f2 = await tryForward(serial, 'tcp:35792', 'tcp:35792');
  if (f1.code !== 0 || f2.code !== 0) return { ok: false, msg: 'adb forward 失败' };
  let info = await pingDevice('127.0.0.1', 35791);
  if (!info) {
    // ping 失败：耐心重试 3 次 × 1.5s，给互联桥恢复时间。
    // 注意：绝不唤醒屏幕或拉起 App——用户明确禁止任何干涉手机前台状态的行为。
    for (let i = 0; i < 3 && !info; i++) {
      await new Promise((res) => setTimeout(res, 1500));
      info = await pingDevice('127.0.0.1', 35791);
    }
    if (!info) return { ok: false, msg: 'USB 通道无法连通「梓安互联桥」（请确认手机端已安装并启动）' };
  }
  // 通道字段必须写在 ...info 之后：/ping 返回的 ip 是手机自报局域网地址，
  // 会覆盖 127.0.0.1 导致后续请求绕开 USB forward 直走 Wi-Fi（纯 USB 线场景断连）
  currentLink = { ...info, ip: '127.0.0.1', port: 35791, usb: true, serial, mode: 'usb' };
  saveLinksCache([currentLink]);
  startUsbWatch();
  return { ok: true, link: currentLink };
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
      currentLink = { ...currentLink, ...info, ip: '127.0.0.1', port: 35791, usb: true, mode: 'usb' };
      notifyLink('net:reconnected', currentLink);
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

// 自动连接：mode = auto | lan | usb
async function autoConnect(mode = 'auto') {
  if (mode === 'usb') {
    const r = await usbConnect();
    return r.ok ? currentLink : null;
  }
  if (mode === 'lan') {
    // 局域网：缓存优先
    const cache = loadLinksCache().filter((d) => !d.usb);
    for (const dev of cache) {
      const info = await pingDevice(dev.ip, dev.port);
      if (info && info.fg !== false) {
        currentLink = { ...dev, ...info };
        stopUsbWatch();
        return currentLink;
      }
    }
    const list = await lanScan(30000);
    if (list.length) {
      const info = await pingDevice(list[0].ip, list[0].port);
      currentLink = { ...list[0], ...(info || {}) };
      saveLinksCache([currentLink]);
      stopUsbWatch();
      return currentLink;
    }
    return null;
  }
  // ===== auto 模式：USB 优先 =====
  // 1. 先尝试 USB 连接（adb forward + ping）
  {
    const r = await usbConnect();
    if (r.ok) return currentLink;
  }
  // 2. USB 失败 → 局域网缓存
  const cache = loadLinksCache().filter((d) => !d.usb);
  for (const dev of cache) {
    const info = await pingDevice(dev.ip, dev.port);
    if (info && info.fg !== false) {
      currentLink = { ...dev, ...info };
      stopUsbWatch();
      return currentLink;
    }
  }
  // 3. 局域网全量扫描（30s）
  const list = await lanScan(30000);
  if (list.length) {
    const info = await pingDevice(list[0].ip, list[0].port);
    currentLink = { ...list[0], ...(info || {}) };
    saveLinksCache([currentLink]);
    stopUsbWatch();
    return currentLink;
  }
  // 4. 全部失败：若存在 USB 缓存，保持低频重试监控（手机重新插回时自动恢复）
  if (loadLinksCache().some((d) => d.usb || d.mode === 'usb' || d.ip === '127.0.0.1')) {
    startUsbWatch();
  }
  return null;
}
ipcMain.handle('net:autoconnect', (_e, mode) => autoConnect(mode || 'auto'));

// 局域网 UDP 扫描（供 net:scan 与 autoConnect 复用）
function lanScan(timeoutMs) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { sock.close(); } catch {}; resolve([...found.values()]); };
    const timer = setTimeout(done, timeoutMs);
    sock.on('error', () => { clearTimeout(timer); done(); });
    sock.on('message', (buf) => {
      try {
        const dev = JSON.parse(buf.toString());
        if (!dev.ip || !dev.port || found.has(dev.ip)) return;
        found.set(dev.ip, dev);
        // 主动 ping 补全信息并确认可达；app 不在前台（fg=false）视为未发现
        pingDevice(dev.ip, dev.port).then((info) => {
          if (!info) return;
          if (info.fg === false) { found.delete(dev.ip); return; }
          found.set(dev.ip, { ...dev, ...info });
        });
      } catch {}
    });
    sock.bind(35791, () => { try { sock.addMembership('239.0.0.1'); } catch {} });
  });
}

// ping 设备：成功返回 {ip,fg,...}，失败返回 null
function pingDevice(ip, port) {
  return new Promise((res) => {
    const req = http.get({ host: ip, port, path: '/ping', timeout: 3000 }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => { try { const j = JSON.parse(d); res(j.ok ? j : null); } catch { res(null); } });
    });
    req.on('timeout', () => { req.destroy(); res(null); });
    req.on('error', () => res(null));
  });
}

ipcMain.handle('net:connect', async (_e, ip, port, opts = {}) => {
  // USB 设备：走 adb forward 通道
  if (opts.usb) {
    const r = await usbConnect();
    if (r.ok) return { ok: true, link: currentLink };
    return r;
  }
  const info = await pingDevice(ip, port || 35791);
  if (!info) return { ok: false, msg: `无法连接 ${ip}:${port}` };
  if (info.fg === false) return { ok: false, msg: '未发现设备：请打开手机上的「梓安互联桥」后再试' };
  currentLink = { ip, port: port || 35791, mode: 'lan', ...info };
  stopUsbWatch();
  // 加入缓存
  const cache = loadLinksCache().filter((d) => d.ip !== ip);
  cache.unshift(currentLink);
  saveLinksCache(cache);
  return { ok: true, link: currentLink };
});

ipcMain.handle('net:disconnect', () => { currentLink = null; stopUsbWatch(); return { ok: true }; });

// ---------- 超级剪贴板 ----------
let clipboardTimer = null;
let lastClipSig = '';
let echoGuard = '';

function httpGetJsonOnce(ip, port, p, timeoutMs) {
  return new Promise((res) => {
    const req = http.get({ host: ip, port, path: p, timeout: timeoutMs }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
      r.on('error', () => res(null));
    });
    // Node 的 timeout 选项只触发事件不中止请求，必须手动销毁
    req.on('timeout', () => { req.destroy(); res(null); });
    req.on('error', () => res(null));
  });
}

// GET JSON，失败自动重试一次（仅重发，不拉起手机 App——用户在其他 App 时不应被强制切回；
// 唤醒自愈只在 USB 断线重连链上触发：usbConnect / usbHealthCheck）
async function httpGetJson(ip, port, p, timeoutMs = 8000, retries = 1) {
  let r = await httpGetJsonOnce(ip, port, p, timeoutMs);
  while (r === null && retries-- > 0) {
    r = await httpGetJsonOnce(ip, port, p, timeoutMs);
  }
  return r;
}

ipcMain.handle('clipboard:get', (_e, link) => {
  return httpGetJson(link ? link.ip : (currentLink && currentLink.ip), link ? link.port : (currentLink && currentLink.port) || 35791, '/clipboard');
});

// 推送剪贴板内容到手机 /clipboard（image 走 multipart，text 走 raw POST）
function pushClipToPhone(ip, port, payload) {
  return new Promise((resolve) => {
    if (payload.type === 'image') {
      const boundary = '----zian-clip-' + Date.now();
      const data = Buffer.from(payload.data, 'base64');
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.png"\r\nContent-Type: ${payload.mime || 'image/png'}\r\n\r\n`);
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([head, data, tail]);
      const req = http.request({ host: ip, port, path: '/clipboard', method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }, timeout: 10000 }, (r) => {
        let d = ''; r.on('data', (c) => d += c); r.on('end', () => resolve({ ok: /"ok"\s*:\s*true/i.test(d) }));
      });
      req.on('error', () => resolve({ ok: false, msg: 'push 失败' }));
      req.write(body);
      req.end();
    } else {
      const body = Buffer.from(payload.data || '', 'utf8');
      const req = http.request({ host: ip, port, path: '/clipboard', method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, timeout: 5000 }, (r) => {
        let d = ''; r.on('data', (c) => d += c); r.on('end', () => resolve({ ok: /"ok"\s*:\s*true/i.test(d) }));
      });
      req.on('error', () => resolve({ ok: false, msg: 'push 失败' }));
      req.write(body);
      req.end();
    }
  });
}

ipcMain.handle('clipboard:set', async (_e, link, payload) => {
  const ip = link ? link.ip : (currentLink && currentLink.ip);
  const port = link ? link.port : (currentLink && currentLink.port) || 35791;
  if (!ip) return { ok: false, msg: '未连接设备' };
  // payload 为空时取本地剪贴板文本
  if (!payload) payload = { type: 'text', data: clipboard.readText() || '' };
  return pushClipToPhone(ip, port, payload);
});

// 读取本机剪贴板并计算内容 sig（格式与手机端对齐：type:len:md5前8）与推送 payload
function localClipSig() {
  const crypto = require('crypto');
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
    sig: 'txt:' + t.length + ':' + crypto.createHash('md5').update(t).digest('hex').slice(0, 8),
    payload: { type: 'text', data: t }
  };
}

ipcMain.handle('clipboard:watch:start', (e) => {
  if (clipboardTimer) clearInterval(clipboardTimer);
  lastClipSig = '';
  echoGuard = '';
  let lastPhoneWrittenSig = '';  // 最近一次从手机写回本机的内容 sig（手机端哈希），防重复写回
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
          const r = await pushClipToPhone(currentLink.ip, currentLink.port, local.payload);
          if (r && r.ok) {
            pushed = true;
            lastClipSig = local.sig;
            echoGuard = local.sig;   // 防止手机端 /clipboard 回传时反向推送回来
          } else {
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
      const remote = await httpGetJson(currentLink.ip, currentLink.port, '/clipboard');
      if (!remote) return;
      const remoteSig = (remote.type === 'text' ? 'txt:' : remote.type === 'image' ? 'img:' : 'empty:') + (remote.sig || '');
      if (remoteSig === echoGuard) {
        // 防回环令牌一次性化：匹配（这是我方推送内容的回传）后立即清空。
        // 残留不清理的话，之后任何时刻用户在手机上手动复制相同内容都会被误忽略，
        // 尤其是推送失败场景残留的 sig 会永久屏蔽该内容的手机→PC 同步
        echoGuard = '';
      } else if (remoteSig !== lastClipSig && remoteSig !== lastPhoneWrittenSig) {
        lastPhoneWrittenSig = remoteSig;
        if (remote.type === 'text') {
          try {
            const text = Buffer.from(remote.data, 'base64').toString('utf8');
            clipboard.writeText(text);
            try { e.sender.send('clipboard:remote', { type: 'text', data: text }); } catch {}
          } catch {}
        } else if (remote.type === 'image') {
          try {
            const buf = Buffer.from(remote.data, 'base64');
            const img2 = require('electron').nativeImage.createFromBuffer(buf, { scaleFactor: 1 });
            if (!img2.isEmpty()) {
              clipboard.writeImage(img2);
              try { e.sender.send('clipboard:remote', { type: 'image', mime: remote.mime, data: remote.data }); } catch {}
            }
          } catch {}
        }
        // 写回后重算本机实际 sig 并同步记录：内容经剪贴板重编码后哈希会变，
        // 不重算的话下一 tick 会误判"本地有新内容"再推回手机，形成双向死循环
        const back = localClipSig();
        if (back.sig) { lastClipSig = back.sig; echoGuard = back.sig; }
      }
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

// Windows 文件名清洗：非法字符/控制字符换下划线，去掉尾部点与空格
function safeWinName(name) {
  const cleaned = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return cleaned || 'file_' + Date.now();
}

ipcMain.handle('files:list', async (_e, link, type, dir) => {
  const ip = link ? link.ip : (currentLink && currentLink.ip);
  const port = link ? link.port : (currentLink && currentLink.port) || 35791;
  if (!ip) return null;
  let q = '/files?type=' + encodeURIComponent(type || 'all');
  if (dir) q += '&dir=' + encodeURIComponent(dir);
  // 15s 长超时；null=失败（区别于 [] = 真空分类），失败不缓存
  const r = await httpGetJson(ip, port, q, 15000);
  return Array.isArray(r) ? r : null;
});

ipcMain.handle('files:pull', async (e, link, remotePath, savePath) => {
  const ip = link ? link.ip : (currentLink && currentLink.ip);
  const port = link ? link.port : (currentLink && currentLink.port) || 35791;
  if (!ip) return { ok: false, msg: '未连接设备' };
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
    const req = http.get({ host: ip, port, path: '/file?path=' + encodeURIComponent(remotePath), timeout: 0, agent: false }, (res) => {
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
  const ip = link ? link.ip : (currentLink && currentLink.ip);
  if (!ip) return { ok: false, msg: '未连接设备' };
  let stat;
  try { stat = fs.statSync(localPath); } catch (err) { return { ok: false, msg: '读取本地文件失败: ' + err.message }; }
  const name = path.basename(localPath);
  const PORT = 35792;  // raw TCP 文件接收端口
  const isUsb = ip === '127.0.0.1' || ip === 'localhost';
  const net = require('net');

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
        // 协议：目标目录 + \n + 文件名 + \n + 长度 + \n + raw bytes
        const header = Buffer.from(remoteDir + '\n' + name + '\n' + stat.size + '\n', 'utf8');
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
  const ip = link ? link.ip : (currentLink && currentLink.ip);
  const port = link ? link.port : (currentLink && currentLink.port) || 35791;
  if (!ip) return { ok: false, msg: '未连接设备' };
  const r = await httpGetJson(ip, port, '/open?path=' + encodeURIComponent(remotePath) + '&app=vivo_office');
  return r || { ok: false };
});

// ---------- 屏幕镜像（scrcpy 弹窗 + 键鼠控制） ----------
ipcMain.handle('mirror:start', async (_e, serial, withControl = true) => {
  if (!serial) return { ok: false, msg: '请先选择 USB/无线调试设备' };
  if (recordChildren.size > 0) return { ok: false, msg: '镜像与录屏互斥，请先停止当前录屏' };
  if (mirrorChild) try { mirrorChild.kill(); } catch {}
  // scrcpy 弹窗 + 键鼠控制：不加 --no-window，不加 --no-control，不加 --record
  const args = ['-s', serial, '--no-audio-playback', '--max-size=1920', '--video-bit-rate=12M', '--stay-awake', '--no-key-repeat'];
  if (!withControl) args.push('--no-control');
  mirrorChild = spawn(SCRCPY, args, { windowsHide: false, cwd: path.dirname(SCRCPY), detached: false });
  let errBuf = '';
  mirrorChild.stderr.on('data', (d) => { errBuf += d.toString(); });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: true, msg: 'scrcpy 镜像已启动' }), 1500);
    mirrorChild.on('error', () => { clearTimeout(t); mirrorChild = null; resolve({ ok: false, msg: 'scrcpy 启动失败' }); });
    mirrorChild.on('close', (code) => {
      clearTimeout(t);
      mirrorChild = null;
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

function runScrcpy(args) {
  return new Promise((res) => {
    const c = spawn(SCRCPY, args, { windowsHide: true, cwd: path.dirname(SCRCPY) });
    let err = '';
    c.stderr.on('data', (d) => { err += d.toString(); });
    recordChildren.add(c);
    c.on('error', () => { recordChildren.delete(c); res({ code: -1, err: 'scrcpy 启动失败' }); });
    c.on('close', (code) => { recordChildren.delete(c); res({ code, err }); });
  });
}

const fileOk = (p, min = 20000) => fs.existsSync(p) && fs.statSync(p).size > min;
const lastErrLine = (s) => (String(s || '').split(/\r?\n/).filter((l) => /error/i.test(l)).pop() || String(s || '').trim().split(/\r?\n/).pop() || '').trim();

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

  const r = await runScrcpy(args);

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

ipcMain.handle('file:pull', async (_e, serial, remote) => {
  const dest = path.join(BASE_DIR, 'ApkExt', 'Files');
  fs.mkdirSync(dest, { recursive: true });
  const r = await adb(['pull', remote, dest], serial, 600000);
  return { ok: r.code === 0, msg: r.code === 0 ? `已保存到 ${dest}` : (r.err || r.out).trim() };
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
ipcMain.handle('script:run', (_e, name) => {
  if (!/^[^\\/]+\.(bat|cmd)$/i.test(name)) return { ok: false, msg: '非法脚本名' };
  const full = path.join(BASE_DIR, 'Script', name);
  if (!fs.existsSync(full)) return { ok: false, msg: '脚本不存在' };
  const child = spawn('cmd.exe', ['/c', full], { cwd: path.dirname(full), detached: true, windowsHide: false, stdio: 'ignore' });
  child.unref();
  log('运行脚本', name);
  return { ok: true, msg: `${name} 已在新窗口运行` };
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
  logcatChild.on('error', (err) => { logcatChild = null; e.sender.send('logcat:data', 'logcat 启动失败: ' + err.message); });
  return { ok: true, msg: '日志流已开启' };
});
ipcMain.handle('logcat:stop', () => {
  if (logcatChild) { logcatChild.kill(); logcatChild = null; }
  return { ok: true, msg: '日志流已停止' };
});

// ---------- 其他 ----------
ipcMain.handle('dialog:pickApk', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: '选择 APK 文件', filters: [{ name: 'APK', extensions: ['apk'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

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
      if (link && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('net:autoconnected', link);
    }).catch(() => {});
  }, 1000);
});

app.on('window-all-closed', () => {
  if (logcatChild) logcatChild.kill();
  if (mirrorChild) try { mirrorChild.kill(); } catch {}
  for (const c of [...recordChildren]) try { c.kill(); } catch {}
  app.quit();
});
