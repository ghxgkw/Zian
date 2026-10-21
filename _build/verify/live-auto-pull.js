'use strict';
/** 真机联调：开着自动同步，验证 focusRequired → 自动 GET /clipboard/pull（限流生效），
 *  以及 pull 之后 GET /clipboard 转为 cached 内容（内容若与刚推送的相同则被防回环抑制）。
 *  通过包装 http 模块统计请求，不修改被测源码。 */
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
const UNPACKED = path.join(ROOT, 'resources', 'app.asar.unpacked');

const t0 = Date.now();
const reqs = [];
const realHttp = require('http');
const httpProxy = new Proxy(realHttp, {
  get(target, prop) {
    if (prop === 'get') return (opts, cb) => { const p = typeof opts === 'string' ? opts : opts.path; reqs.push({ dt: Date.now() - t0, p }); return realHttp.get(opts, cb); };
    if (prop === 'request') return (opts, cb) => { const p = typeof opts === 'string' ? opts : opts.path; reqs.push({ dt: Date.now() - t0, p, method: (opts && opts.method) || 'GET' }); return realHttp.request(opts, cb); };
    const v = Reflect.get(target, prop, target);
    return typeof v === 'function' ? v.bind(target) : v;
  }
});

const handlers = new Map();
class FakeWindow {
  constructor() { this.webContents = { on() {}, send() {}, openDevTools() {} }; }
  loadFile() {} on() {} once() {} show() {} destroy() {} minimize() {} close() {} isDestroyed() { return false; }
  static getAllWindows() { return []; }
}
const clipState = { text: '' };
const stub = {
  app: { isPackaged: false, whenReady: () => new Promise(() => {}), getPath: () => path.join(ROOT, '_build', 'verify'), getVersion: () => '1.0.0', quit() {}, on() {} },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox() {} },
  shell: { openPath: async () => '' },
  clipboard: { readImage: () => ({ isEmpty: () => true }), readText: () => clipState.text, writeText: (t) => { clipState.text = t; }, writeImage: () => {} },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => false }) },
  contextBridge: { exposeInMainWorld() {} },
  ipcRenderer: { invoke: async () => null, on() {} }
};
const orig = Module._load;
Module._load = function (req) {
  if (req === 'electron') return stub;
  if (req === 'http') return httpProxy;
  return orig.apply(this, arguments);
};
require(path.join(UNPACKED, 'main.js'));

const ev = { sender: { send: (ch, p) => console.log('  [' + (Date.now() - t0) + 'ms] EVENT ' + ch + ' ' + JSON.stringify({ type: p && p.type, cached: p && p.cached, msg: p && p.msg })) } };
const call = (ch, ...a) => { const fn = handlers.get(ch); if (!fn) throw new Error('缺 handler ' + ch); return fn(ev, ...a); };

(async () => {
  const link = await call('net:autoconnect', 'usb');
  console.log('LINK ' + (link ? link.ip + ':' + link.port + ' paired=' + link.paired : 'null'));
  if (!link) process.exit(0);
  clipState.text = 'zian-auto-' + Date.now();
  console.log('PC clipboard seeded: ' + clipState.text);
  await call('clipboard:watch:start');
  console.log('WATCH started, 观察 14 秒…');
  await new Promise((r) => setTimeout(r, 14000));
  await call('clipboard:watch:stop');
  const clips = reqs.filter((r) => r.p === '/clipboard' && (!r.method || r.method === 'GET'));
  const pulls = reqs.filter((r) => r.p === '/clipboard/pull');
  console.log('REQ /clipboard(GET) = ' + clips.length);
  console.log('REQ /clipboard/pull = ' + pulls.length + '  ' + JSON.stringify(pulls.map((r) => r.dt + 'ms')));
  console.log('PC clipboard now  = ' + JSON.stringify(clipState.text.slice(0, 40)));
  process.exit(0);
})().catch((e) => { console.error('FATAL ' + e.stack); process.exit(3); });
