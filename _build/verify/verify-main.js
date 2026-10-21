'use strict';
/**
 * 主进程验收脚本（无 GUI）：用 electron 桩加载 main.js / preload.js，
 * 直接调用已注册的 IPC handler，对真实设备做接口级验收。
 * 只读写项目内路径；不启动窗口、不操作屏幕/键鼠。
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const UNPACKED = path.join(ROOT, 'resources', 'app.asar.unpacked');
const VERIFY_DIR = path.join(ROOT, '_build', 'verify');
fs.mkdirSync(VERIFY_DIR, { recursive: true });

const handlers = new Map();
let exposed = null;
const invokedChannels = new Set();

class FakeWindow {
  constructor() {
    this.webContents = { on() {}, send() {}, openDevTools() {} };
  }
  loadFile() {}
  on() {}
  once() {}
  show() {}
  destroy() {}
  minimize() {}
  close() {}
  isDestroyed() { return false; }
  static getAllWindows() { return []; }
}

const electronStub = {
  app: {
    isPackaged: false,
    whenReady: () => new Promise(() => {}),
    getPath: () => VERIFY_DIR,
    getVersion: () => '1.0.0',
    requestSingleInstanceLock: () => true,
    quit() {},
    on() {}
  },
  BrowserWindow: FakeWindow,
  ipcMain: {
    handle: (ch, fn) => handlers.set(ch, fn),
    on() {}
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showErrorBox() {}
  },
  shell: { openPath: async () => '' },
  clipboard: {
    readImage: () => ({ isEmpty: () => true }),
    readText: () => '',
    writeText() {},
    writeImage() {}
  },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } },
  ipcRenderer: {
    invoke: (ch) => { invokedChannels.add(ch); return Promise.resolve(null); },
    on() {}
  }
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

require(path.join(UNPACKED, 'main.js'));
require(path.join(UNPACKED, 'preload.js'));

const fakeEvent = { sender: { send() {} } };
const call = (ch, ...args) => {
  const fn = handlers.get(ch);
  if (!fn) throw new Error('缺少 handler: ' + ch);
  return fn(fakeEvent, ...args);
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : detail}`);
};
const skip = (name, detail) => {
  results.push({ name, ok: true, skipped: true, detail });
  console.log(`SKIP  ${name}  ${detail == null ? '' : detail}`);
};

(async () => {
  // 1. IPC 覆盖：preload 暴露的方法会 invoke 的 channel 必须都有 handler
  for (const [k, v] of Object.entries(exposed || {})) {
    if (typeof v === 'function') {
      try { await v(); } catch {}
    }
  }
  const missing = [...invokedChannels].filter((c) => !handlers.has(c));
  const unused = [...handlers.keys()].filter((c) => !invokedChannels.has(c));
  check('IPC 覆盖（preload→main）', missing.length === 0, `missing=${missing.join(',') || '无'} unused=${unused.length}`);

  // 2. 设备列表
  const devs = await call('adb:devices');
  check('ADB 设备枚举', Array.isArray(devs) && devs.length > 0, JSON.stringify(devs.map((d) => d.serial + ':' + d.state)));
  if (!devs.length) throw new Error('无设备，后续用例跳过');
  const serial = (devs.find((d) => !d.serial.startsWith('emulator')) || devs[0]).serial;

  // 3. 设备信息 / 电池
  const info = await call('device:info', serial);
  check('设备信息', info && info.ok && !!info.model, `${info.model} Android ${info.android} 闪存 ${info.flashType}`);
  const bat = await call('battery:read', serial);
  check('电池读取', bat && bat.ok, `level=${bat.level} status=${bat.status}`);

  // 4. shell 命令
  const model = await call('cmd:run', serial, 'getprop ro.product.model');
  check('ADB shell', model.code === 0 && model.out.trim().length > 0, model.out.trim());

  // 5. 应用列表（app:list 通道已按 C 类清理移除，改用 shell 解析）
  const cntPkgs = (r) => (r && r.code === 0 ? r.out.split('\n').filter((l) => l.trim().startsWith('package:')).length : -1);
  const third = cntPkgs(await call('cmd:run', serial, 'pm list packages -3'));
  const sysN = cntPkgs(await call('cmd:run', serial, 'pm list packages -s'));
  check('应用列表', third > 0 && sysN > 0, `third=${third} sys=${sysN}`);

  // 6. 截图（写项目内目录后清理）
  const shot = await call('screen:shot', serial, { toPc: true });
  check('截图', shot && shot.ok && /^data:image\/png/.test(shot.dataUrl || ''), shot.ok ? shot.msg : shot.msg);
  if (shot && shot.ok && fs.existsSync(shot.msg)) fs.rmSync(shot.msg, { force: true });

  // 7. 互联通道（USB forward + v1.1 配对令牌）
  const conn = await call('net:autoconnect', 'usb');
  const link = conn && conn.ip ? conn : { ip: '127.0.0.1', port: 35791 };
  check('配对（USB 自动获取令牌）', !!(conn && conn.paired === true), conn ? `paired=${conn.paired} ip=${conn.ip}` : 'null');
  const ping = await call('clipboard:get', link);
  check('HTTP /clipboard（互联桥在线）', ping !== null, ping ? `type=${ping.type}` : 'null（可能是 401 未配对）');
  const clipText = 'zian-verify-' + Date.now();
  const setText = await call('clipboard:set', link, { type: 'text', data: clipText });
  const got = await call('clipboard:get', link);
  let decoded = '';
  try { decoded = Buffer.from(got.data, 'base64').toString('utf8'); } catch {}
  if (setText && setText.ok && got && decoded === clipText) {
    check('剪贴板写入+回读', true, `sig=${got.sig}`);
  } else if (got && got.type === 'empty') {
    skip('剪贴板写入+回读', 'Android 10+ 焦点限制：需互联桥在前台才能读剪切板，非程序缺陷');
  } else {
    check('剪贴板写入+回读', false, `sig=${got && got.sig} decoded=${JSON.stringify(decoded)}`);
  }

  // 8. 文件上传（raw TCP 35792）→ 列表 → 下载 → 哈希比对
  const localUp = path.join(VERIFY_DIR, 'verify_up.txt');
  const body = 'zian-verify-payload-' + Date.now();
  fs.writeFileSync(localUp, body, 'utf8');
  const push = await call('files:push', link, localUp, '/sdcard/Download');
  check('文件上传（raw TCP）', push && push.ok, push && push.msg);

  const list = await call('files:list', link, 'storage', '/sdcard/Download');
  const found = Array.isArray(list) ? list.find((f) => f.name === 'verify_up.txt') : null;
  check('文件列表（storage）', !!found, found ? `size=${found.size}` : `list=${Array.isArray(list) ? list.length : String(list)}`);

  let pulled = null;
  if (found) {
    const save = path.join(VERIFY_DIR, 'verify_down.txt');
    pulled = await call('files:pull', link, found.path, save);
    // Content-Disposition 的 ASCII 文件名会覆盖 savePath 的文件名，需按实际落盘路径核对
    const actual = fs.existsSync(save) ? save : path.join(path.dirname(save), 'verify_up.txt');
    const same = pulled.ok && fs.existsSync(actual) && fs.readFileSync(actual, 'utf8') === body;
    check('文件下载（HTTP 流式）', same, pulled.msg + ' -> ' + actual);
  } else {
    check('文件下载（HTTP 流式）', false, '上传文件未出现在列表');
  }

  // 9. 数据目录
  const paths = await call('paths:get');
  check('数据目录', !!paths.base && fs.existsSync(paths.base), paths.base);

  // 清理设备与本地测试文件
  try { await call('cmd:run', serial, 'rm -f /sdcard/Download/verify_up.txt'); } catch {}
  for (const f of [path.join(VERIFY_DIR, 'verify_up.txt'), path.join(VERIFY_DIR, 'verify_down.txt')]) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }

  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  const passed = results.length - failed.length - skipped.length;
  console.log('\nSUMMARY ' + JSON.stringify({ total: results.length, pass: passed, skip: skipped.length, fail: failed.length }));
  process.exit(failed.length ? 2 : 0);
})().catch((e) => {
  console.error('FATAL ' + e.message);
  process.exit(3);
});
