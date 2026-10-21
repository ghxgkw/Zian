'use strict';
/** 真机联调（一次性）：走真实 IPC 处理器打手机端 /clipboard/pull，再按 1s 轮询 3 次 GET /clipboard。
 *  只读接口 + 触发一次通知，不改设备数据。 */
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
const UNPACKED = path.join(ROOT, 'resources', 'app.asar.unpacked');

const handlers = new Map();
class FakeWindow {
  constructor() { this.webContents = { on() {}, send() {}, openDevTools() {} }; }
  loadFile() {} on() {} once() {} show() {} destroy() {} minimize() {} close() {} isDestroyed() { return false; }
  static getAllWindows() { return []; }
}
const stub = {
  app: { isPackaged: false, whenReady: () => new Promise(() => {}), getPath: () => path.join(ROOT, '_build', 'verify'), getVersion: () => '1.0.0', quit() {}, on() {} },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox() {} },
  shell: { openPath: async () => '' },
  clipboard: { readImage: () => ({ isEmpty: () => true }), readText: () => '', writeText() {}, writeImage() {} },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  contextBridge: { exposeInMainWorld() {} },
  ipcRenderer: { invoke: async () => null, on() {} }
};
const orig = Module._load;
Module._load = function (req) { if (req === 'electron') return stub; return orig.apply(this, arguments); };
require(path.join(UNPACKED, 'main.js'));

const ev = { sender: { send: (ch, p) => console.log('  [event] ' + ch + ' ' + JSON.stringify(p)) } };
const call = (ch, ...a) => { const fn = handlers.get(ch); if (!fn) throw new Error('缺 handler ' + ch); return fn(ev, ...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const link = await call('net:autoconnect', 'usb');
  console.log('LINK  ' + (link ? 'usb paired=' + link.paired + ' ' + link.ip + ':' + link.port : 'null'));
  if (!link) { console.log('SKIP  无 USB 通道'); process.exit(0); }
  const t0 = Date.now();
  const pull = await call('clipboard:pull', link);
  console.log('PULL  ' + JSON.stringify(pull) + '  (' + (Date.now() - t0) + 'ms)');
  for (let i = 1; i <= 3; i++) {
    await sleep(1000);
    const r = await call('clipboard:get', link);
    console.log('POLL' + i + '  ' + JSON.stringify(r && { type: r.type, sig: r.sig, cached: r.cached, focusRequired: r.focusRequired, len: (r.data || '').length }));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(3); });
