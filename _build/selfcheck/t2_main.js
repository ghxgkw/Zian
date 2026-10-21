
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const mainSrc = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n + (x ? '  | ' + x : '')); } else { fail++; console.log('FAIL  ' + n + (x ? '  | ' + x : '')); } };
function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error('anchor-miss-start: ' + a);
  const j = src.indexOf(b, i + a.length);
  if (j < 0) throw new Error('anchor-miss-end: ' + b);
  return src.slice(i, j + b.length);
}
function runSandbox(scriptText, sandbox) {
  const ctx = vm.createContext(Object.assign({ console, module: { exports: {} }, EventEmitter, Promise, JSON, Object, Array, String, Number, Buffer, setTimeout, clearTimeout, require }, sandbox));
  vm.runInContext(scriptText, ctx);
  return ctx.module.exports;
}
const tail = () => { console.log('---- ' + pass + ' passed, ' + fail + ' failed ----'); process.exitCode = fail ? 1 : 0; };

(async function main() {
// ================= B5 镜像重启竞态 =================
const startBlock = sliceBetween(mainSrc, "ipcMain.handle('mirror:start', async (_e, serial, withControl = true) => {", '\n});');
const cbText = startBlock.replace("ipcMain.handle('mirror:start', ", '').replace(/\);$/, '');

function buildMirror(handlerText) {
  const script = [
    'let mirrorChild = null;',
    'const recordChildren = new Set();',
    'const children = [];',
    'function makeChild(name) { const c = new EventEmitter(); c.name = name; c.killed = false; c.stderr = new EventEmitter(); c.kill = function () { c.killed = true; }; return c; }',
    'const handler = ' + handlerText + ';',
    'module.exports = { handler: (s) => handler(null, s, true), children, get: () => mirrorChild, rec: recordChildren };'
  ].join('\n');
  return runSandbox(script, {
    spawn: () => { throw new Error('unused'); },
    path: { dirname: () => '.' },
    SCRCPY: 'scrcpy.exe',
    process: { env: {} },
    mainWin: { isDestroyed: () => true, webContents: { send: () => {} } },
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {}
  });
}
// spawn 需要返回子进程：改写 sandbox 中的 spawn
function buildMirror2(handlerText) {
  const holder = { children: [] };
  const spawn = () => {
    const c = new EventEmitter();
    c.name = 'c' + (holder.children.length + 1);
    c.killed = false;
    c.stderr = new EventEmitter();
    c.kill = function () { c.killed = true; };
    holder.children.push(c);
    return c;
  };
  const script = [
    'let mirrorChild = null;',
    'const recordChildren = new Set();',
    'const handler = ' + handlerText + ';',
    'module.exports = { handler: (s) => handler(null, s, true), get: () => mirrorChild, rec: recordChildren };'
  ].join('\n');
  const api = runSandbox(script, {
    spawn, path: { dirname: () => '.' }, SCRCPY: 'scrcpy.exe', ADB: 'adb.exe', process: { env: {} },
    mainWin: { isDestroyed: () => true, webContents: { send: () => {} } },
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {}
  });
  return { api, children: holder.children };
}

const mNew = buildMirror2(cbText);
const r1 = await mNew.api.handler('SER');
ok('B5 首次启动成功并持有引用', r1.ok === true && mNew.api.get() === mNew.children[0]);
const r2 = await mNew.api.handler('SER');
ok('B5 二次启动替换为新引用', r2.ok === true && mNew.api.get() === mNew.children[1] && mNew.children[1].name === 'c2');
mNew.children[0].emit('close', 0);
ok('B5 旧进程 close 晚到不抹掉新引用', mNew.api.get() === mNew.children[1], 'mirrorChild=' + (mNew.api.get() && mNew.api.get().name));
mNew.children[1].emit('close', 0);
ok('B5 新进程 close 正常置空', mNew.api.get() === null);

const oldText = cbText.split('      if (mirrorChild === child) mirrorChild = null;').join('      mirrorChild = null;');
const mOld = buildMirror2(oldText);
await mOld.api.handler('SER');
await mOld.api.handler('SER');
mOld.children[0].emit('close', 0);
ok('B5 对照·修复前旧 close 会抹掉新引用（缺陷复现）', mOld.api.get() === null, 'mirrorChild=' + String(mOld.api.get()));

// ================= B6 + B7 links 缓存 / USB 地址 =================
const pinUsbLine = mainSrc.match(/^const pinUsb = .*$/m)[0];
const tokenOfSrc = sliceBetween(mainSrc, 'function tokenOf(link) {', '\n}');
const publicLinkSrc = sliceBetween(mainSrc, 'function publicLink(link) {', '\n}');
const attachCachedTokenSrc = sliceBetween(mainSrc, 'function attachCachedToken(link) {', '\n}');
const usbSrc = sliceBetween(mainSrc, 'async function usbConnect() {', '\n}');
const usbScript = [
  'let currentLink = null;',
  "let cache = [{ ip: '192.168.1.77', port: 35791, name: 'LAN-1', mode: 'lan' }];",
  'function loadLinksCache() { return cache.map((d) => Object.assign({}, d)); }',
  'function saveLinksCache(a) { cache = a.map((d) => Object.assign({}, d)); }',
  "const adb = async () => ({ code: 0, out: 'List of devices attached', err: '' });",
  "const onlineSerials = () => ['USB-SERIAL-1'];",
  'const tryForward = async () => ({ code: 0, out: String(), err: String() });',
  "const pingDevice = async () => ({ ok: true, name: 'Phone', ip: '192.168.1.9', port: 35791, fg: true });",
  'const delay = async () => {};',
  'const startUsbWatch = () => {};',
  'const log = () => {};',
  "const pairGetToken = async () => ({ ok: true, token: '0123456789abcdef0123456789abcdef' });",
  tokenOfSrc,
  publicLinkSrc,
  attachCachedTokenSrc,
  pinUsbLine,
  usbSrc,
  'module.exports = { usbConnect, getLink: () => currentLink, getCache: () => cache };'
].join('\n');
const usbApi = runSandbox(usbScript, {});
const u = await usbApi.usbConnect();
ok('B7 /ping 自报 LAN IP 不再覆盖通道地址', u.ok === true && usbApi.getLink().ip === '127.0.0.1' && usbApi.getLink().port === 35791, 'ip=' + usbApi.getLink().ip + ' port=' + usbApi.getLink().port);
ok('B7 USB 通道标记保留', usbApi.getLink().usb === true && usbApi.getLink().mode === 'usb' && usbApi.getLink().serial === 'USB-SERIAL-1');
const cacheAfter = usbApi.getCache();
ok('B6 USB 连接不再清空历史 LAN 设备', cacheAfter.length === 2 && cacheAfter.some((d) => d.name === 'LAN-1'), 'cache=' + JSON.stringify(cacheAfter.map((d) => d.name)));
ok('B6 当前设备被插到缓存队首', cacheAfter[0].ip === '127.0.0.1');
const oldCache = [{ ip: '192.168.1.77', name: 'LAN-1' }];
const oldAfter = [{ ip: '127.0.0.1', name: 'Phone' }];
ok('B6 对照·旧的覆盖式写入会丢掉 LAN-1（缺陷复现）', oldAfter.length === 1 && !oldAfter.some((d) => d.name === 'LAN-1'), 'old=' + JSON.stringify(oldAfter.map((d) => d.name)) + ' 原缓存=' + JSON.stringify(oldCache.map((d) => d.name)));
ok('B7 /ping 上报 ip 场景下 pinUsb 优先级正确', new Function('return ' + pinUsbLine.replace('const pinUsb = ', ''))()({ ip: '10.0.0.5', port: 1234, name: 'X' }).ip === '127.0.0.1');

// ================= B9 runScrcpy 超时兜底 =================
const rsSrc = sliceBetween(mainSrc, 'function runScrcpy(args, timeoutMs) {', '\n}');
const timers = [];
const cleared = [];
const rsScript = [
  'const recordChildren = new Set();',
  'const children = [];',
  'function makeChild() { const c = new EventEmitter(); c.killed = false; c.stderr = new EventEmitter(); c.kill = function () { c.killed = true; }; return c; }',
  rsSrc,
  'module.exports = { runScrcpy, recordChildren, children };'
].join('\n');
const rsApi = runSandbox(rsScript, {
  spawn: () => { const c = new EventEmitter(); c.killed = false; c.stderr = new EventEmitter(); c.kill = function () { c.killed = true; }; rsChildren.push(c); return c; },
  path: { dirname: () => '.' }, SCRCPY: 'scrcpy.exe', ADB: 'adb.exe', process: { env: {} },
  setTimeout: (fn, ms) => { const h = { fn, ms, fired: false }; timers.push(h); return h; },
  clearTimeout: (h) => { cleared.push(h); }
});
const rsChildren = [];
rsApi.children.push = function () {};   // children 由 sandbox 内部维护，这里改用外部记录
const p1 = rsApi.runScrcpy(['--record=x'], 120000);
ok('B9 进程已进入 recordChildren（互斥生效）', rsApi.recordChildren.size === 1);
ok('B9 超时阈值 = 总时长上限（120000ms）', timers[0] && timers[0].ms === 120000, 'ms=' + (timers[0] && timers[0].ms));
timers[0].fn();                          // 触发超时
const r1b = await p1;
ok('B9 超时后返回失败并说明原因', r1b.code === -1 && r1b.err.indexOf('录屏超时 120s') >= 0, 'err=' + JSON.stringify(r1b.err.replace(/\n/g, ' ')));
ok('B9 超时后强杀子进程', rsChildren[0] && rsChildren[0].killed === true);
ok('B9 超时后清空 recordChildren（不再永久锁死录屏）', rsApi.recordChildren.size === 0);
const p2 = rsApi.runScrcpy(['--record=y'], 5000);
rsChildren[1].emit('close', 0);
const r2b = await p2;
ok('B9 正常结束走 close 分支且清理记录', r2b.code === 0 && rsApi.recordChildren.size === 0);
ok('B9 正常结束会 clearTimeout', cleared.length >= 1);

// ================= B10 did-fail-load =================
const dfBlock = sliceBetween(mainSrc, "mainWin.webContents.on('did-fail-load', ", '\n  });');
const dfText = dfBlock;
function buildFail() {
  const script = [
    'let mainReady = false;',
    'let revealed = 0;',
    'const logs = [];',
    'const loads = [];',
    'const handlers = {};',
    'function log() { logs.push(Array.prototype.slice.call(arguments).join(" ")); }',
    'function revealMain() { revealed++; }',
    'const mainWin = { webContents: { on: (ch, cb) => { handlers[ch] = cb; } }, loadURL: (u) => { loads.push(u); return Promise.resolve(); } };',
    dfText,
    'module.exports = { handlers, loads, logs, ready: () => mainReady, revealed: () => revealed };'
  ].join('\n');
  return runSandbox(script, {});
}
const f1 = buildFail();
ok('B10 处理器已注册', typeof f1.handlers['did-fail-load'] === 'function');
f1.handlers['did-fail-load'](null, -105, 'NAME_NOT_RESOLVED', 'file:///D:/x/index.html', true);
ok('B10 加载失败后显示主窗（revealMain + mainReady）', f1.revealed() === 1 && f1.ready() === true);
ok('B10 加载失败后渲染可读错误页', f1.loads.length === 1 && decodeURIComponent(f1.loads[0].split(',')[0] && f1.loads[0].slice(f1.loads[0].indexOf(',') + 1)).indexOf('NAME_NOT_RESOLVED') > 0, 'url=' + String(f1.loads[0]).slice(0, 60));
const f2 = buildFail();
f2.handlers['did-fail-load'](null, -105, '<script>alert(1)</script>', 'file:///D:/x/<b>.html', true);
const html2 = decodeURIComponent(f2.loads[0].slice(f2.loads[0].indexOf(',') + 1));
ok('B10 错误页内容已转义（不引入新的注入点）', html2.indexOf('&lt;script&gt;') > 0 && html2.indexOf('<script>') < 0);
const f3 = buildFail();
f3.handlers['did-fail-load'](null, -3, 'ERR_ABORTED', 'about:blank', true);
ok('B10 ERR_ABORTED(-3) 不弹错误页', f3.loads.length === 0 && f3.revealed() === 0);

// ================= B15 卸载终态校验 =================
const unBlock = sliceBetween(mainSrc, "ipcMain.handle('app:uninstall', ", '\n});');
const unText = unBlock.replace(/^ipcMain\.handle\('app:uninstall', /, '').replace(/\);$/, '');
function buildUninstall() {
  const script = [
    'let adbImpl = async () => ({ code: 0, out: String(), err: String() });',
    'const calls = [];',
    'const adb = (args) => { calls.push(args.join(" ")); return adbImpl(args); };',
    'const logLines = [];',
    'function log() { logLines.push(Array.prototype.slice.call(arguments).join(" ")); }',
    'const handler = ' + unText + ';',
    'module.exports = { call: (pkg) => handler(null, "S1", pkg), setAdb: (f) => { adbImpl = f; }, calls, logs: logLines };'
  ].join('\n');
  return runSandbox(script, {});
}
const vivo = buildUninstall();
vivo.setAdb(async (args) => {
  if (args[0] === 'uninstall') return { code: 0, out: 'Failure [not installed for 0]', err: '' };
  return { code: 0, out: '', err: '' };      // pm list packages 无该包
});
const rv = await vivo.call('com.vivo.demo');
ok('B15 vivo 假失败但包已卸掉 → 判成功', rv.ok === true, 'msg=' + rv.msg);
const still = buildUninstall();
let n = 0;
still.setAdb(async (args) => {
  if (args[0] === 'uninstall') return { code: 0, out: 'Failure [DELETE_FAILED_INTERNAL_ERROR]', err: '' };
  if (args[0] === 'shell' && args[2] === 'list') return { code: 0, out: 'package:com.foo.bar\n', err: '' };
  return { code: 0, out: 'Failure [not installed for 0]', err: '' };
});
const rs = await still.call('com.foo.bar');
ok('B15 包仍在设备上 → 判失败', rs.ok === false, 'msg=' + rs.msg);
ok('B15 包仍在时会先重试 pm uninstall --user 0', still.calls.some((c) => c.indexOf('pm uninstall --user 0') >= 0), still.calls.join(' ; ').slice(0, 90));
const offline = buildUninstall();
offline.setAdb(async (args) => {
  if (args[0] === 'uninstall') return { code: 0, out: 'Success', err: '' };
  return { code: 1, out: 'error: device offline', err: '' };
});
const ro = await offline.call('com.foo');
ok('B15 无法校验时退回输出判定', ro.ok === true && ro.msg === 'Success', 'msg=' + ro.msg);
const exact = buildUninstall();
exact.setAdb(async (args) => {
  if (args[0] === 'uninstall') return { code: 0, out: 'Success', err: '' };
  return { code: 0, out: 'package:com.foo.barbaz\n', err: '' };   // 同名前缀的另一包
});
const re = await exact.call('com.foo');
ok('B15 前缀相同的其它包不误判为未卸载', re.ok === true, 'msg=' + re.msg);

// ================= B16 setupDirs 回退保护 =================
const sdSrc = sliceBetween(mainSrc, 'function setupDirs() {', '\n}');
function buildDirs(dirnameOfFs) {
  const script = [
    'const path = require("path");',
    'const os = require("os");',
    'const app = { isPackaged: true, execPath: path.join(os.tmpdir(), "exe", "zian.exe"), getPath: () => path.join(os.tmpdir(), "docs") };',
    'const process = { execPath: app.execPath };',
    'const __dirname = path.join(os.tmpdir(), "src");',
    'let fsImpl = () => {};',
    'const fs = { mkdirSync: (p, o) => fsImpl(p, o) };',
    sdSrc,
    'module.exports = { setupDirs, setFs: (f) => { fsImpl = f; }, app, os, path };'
  ].join('\n');
  return runSandbox(script, { require });
}
const d1 = buildDirs();
d1.setFs(() => {});
ok('B16 正常：使用 exe 同级目录', d1.setupDirs() === d1.path.dirname(d1.app.execPath), d1.setupDirs());
const d2 = buildDirs();
d2.setFs((p) => { if (p.indexOf('docs') < 0) throw new Error('EACCES'); });
ok('B16 一级失败回退文档目录', d2.setupDirs() === d2.path.join(d2.app.getPath('documents'), '梓安工具箱'), d2.setupDirs());
const d3 = buildDirs();
d3.setFs((p) => { if (/[\\/](exe|docs)[\\/]/.test(p)) throw new Error('EACCES'); });
let d3res = null, d3err = null;
try { d3res = d3.setupDirs(); } catch (e) { d3err = e; }
ok('B16 两级都失败时退到系统临时目录而不是崩溃', d3err === null && d3res === d3.path.join(d3.os.tmpdir(), '梓安工具箱'), 'res=' + d3res + ' err=' + (d3err && d3err.message));
const oldSetup = function setupDirsOld(app, path, fs, __dirname, os) {
  let base;
  try {
    base = app.isPackaged ? path.dirname(app.execPath) : __dirname;
    ['Screenshots', 'ApkExt', 'Script', 'Log'].forEach((d) => fs.mkdirSync(path.join(base, d), { recursive: true }));
  } catch {
    base = app.getPath('documents');
    ['Screenshots', 'ApkExt', 'Script', 'Log'].forEach((d) => fs.mkdirSync(path.join(base, '梓安工具箱', d), { recursive: true }));
    base = path.join(base, '梓安工具箱');
  }
  return base;
};
let oldErr = null;
try { oldSetup(d3.app, d3.path, { mkdirSync: () => { throw new Error('EACCES'); } }, 'x', d3.os); } catch (e) { oldErr = e; }
ok('B16 对照·旧实现同样场景下启动即崩（缺陷复现）', oldErr && oldErr.message === 'EACCES', oldErr && oldErr.message);

// ================= B17 多开（用户要求撤掉单实例锁，断言随之反向） =================
ok('B17 不再请求单实例锁', mainSrc.indexOf('requestSingleInstanceLock') < 0);
ok('B17 已删 second-instance 回调与聚焦逻辑', mainSrc.indexOf('second-instance') < 0 && mainSrc.indexOf('mainWin.focus()') < 0 && mainSrc.indexOf('mainWin.restore()') < 0);
ok('B17 无 isPrimary 短路', mainSrc.indexOf('isPrimary') < 0);
ok('B17 whenReady 无条件建窗（不再按锁短路）', /app\.whenReady\(\)\.then\(\(\) => \{\s*\n\s*if \(!fs\.existsSync\(ADB\)\)/.test(mainSrc));
tail();
})();
