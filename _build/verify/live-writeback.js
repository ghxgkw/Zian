'use strict';
/**
 * Live device test: content that exists on the PHONE must reach the PC clipboard automatically
 * (PC polls GET /clipboard, auto-pulls GET /clipboard/pull when the bridge app is backgrounded,
 * then writes the decoded payload into the local clipboard).
 *
 * Why the previous version never exited (hang attribution, measured):
 *   main.js usbConnect() -> startUsbWatch() creates a 5s setInterval(usbHealthCheck) that this
 *   harness never clears, so node keeps the event loop alive forever. The old script also had no
 *   process.exit() (compare _build/verify/live-auto-pull.js line 66), so "300s without exit" was
 *   a process-lifetime hang, NOT a stuck request: every step below had already resolved and
 *   RESULT was already printed at ~13.6s.
 * Fixes: http instrumentation, full event payloads, wait window covering the 60s phone snap TTL /
 *   10s auto-pull gap / 30s backoff, net:disconnect cleanup, active-handle dump, hard watchdog and
 *   an explicit exit code.
 */
const path = require('path');
const Module = require('module');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const UNPACKED = path.join(ROOT, 'resources', 'app.asar.unpacked');
const PORT = 35791;
const WAIT_MS = Number(process.env.WAIT_MS || 95000);   // covers 60s TTL + 30s backoff + margin
const t0 = Date.now();
const ts = () => '[' + (Date.now() - t0) + 'ms]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- record every http call main.js makes (read-only observer, source untouched) ----
const reqLog = [];
const realHttp = http;
const note = (opts, method) => {
  const p = typeof opts === 'string' ? opts : opts && opts.path;
  reqLog.push({ dt: Date.now() - t0, p, method: method || (opts && opts.method) || 'GET' });
  return p;
};
const httpProxy = new Proxy(realHttp, {
  get(target, prop) {
    if (prop === 'request') return (opts, cb) => { note(opts); return realHttp.request(opts, cb); };
    if (prop === 'get') return (opts, cb) => { note(opts, 'GET'); return realHttp.get(opts, cb); };
    const v = Reflect.get(target, prop, target);
    return typeof v === 'function' ? v.bind(target) : v;
  }
});

const handlers = new Map();
class FakeWindow { constructor() { this.webContents = { on() {}, send() {}, openDevTools() {} }; } loadFile() {} on() {} once() {} show() {} destroy() {} minimize() {} close() {} isDestroyed() { return false; } static getAllWindows() { return []; } }
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

// full payload logging: which channel, which content, whether it came from the phone snap cache
const ev = {
  sender: {
    send: (ch, p) => {
      if (ch === 'clipboard:remote' && p) {
        // main.js send() already ships decoded text (only /clipboard wire data is base64)
        const text = p.type === 'text' ? String(p.data || '') : '<' + (p.mime || 'image') + '>';
        console.log(ts() + ' EVENT ' + ch + ' type=' + p.type + ' cached=' + !!p.cached + ' data=' + JSON.stringify(text.slice(0, 48)));
      } else {
        console.log(ts() + ' EVENT ' + ch + ' ' + JSON.stringify(p || {}).slice(0, 160));
      }
    }
  }
};
const call = (ch, ...a) => { const fn = handlers.get(ch); if (!fn) throw new Error('missing handler ' + ch); return fn(ev, ...a); };

// our own probe requests (bypass the desktop logic entirely, exactly like a phone-local copy)
const req = (p, method, body, token) => new Promise((res) => {
  const data = body ? Buffer.from(body, 'utf8') : null;
  const h = {};
  if (data) { h['Content-Type'] = 'text/plain; charset=utf-8'; h['Content-Length'] = data.length; }
  if (token) h['X-Zian-Token'] = token;
  const r = realHttp.request({ host: '127.0.0.1', port: PORT, path: p, method: method || 'GET', headers: h, timeout: 8000 }, (rs) => {
    let b = ''; rs.on('data', (c) => b += c); rs.on('end', () => res({ code: rs.statusCode, body: b }));
  });
  r.on('timeout', () => { r.destroy(); res({ code: 0, body: 'TIMEOUT' }); });
  r.on('error', (e) => res({ code: 0, body: 'ERR ' + e.message }));
  if (data) r.write(data);
  r.end();
});
const probePhone = async (token) => {
  const r = await req('/clipboard', 'GET', null, token);
  let o = null; try { o = JSON.parse(r.body); } catch {}
  return o ? ('type=' + o.type + ' cached=' + !!o.cached + ' focusRequired=' + !!o.focusRequired + ' sig=' + (o.sig || '')) : ('http=' + r.code + ' ' + String(r.body).slice(0, 60));
};

const watchdog = setTimeout(() => {
  console.error('[watchdog] no result after 180000ms, active handles=' + JSON.stringify(handleCounts()));
  process.exit(5);
}, 180000);

function handleCounts() {
  // _getActiveHandles() never lists timers; getActiveResourcesInfo() does (that is where the
  // 5s usb-health setInterval shows up as 'Timeout').
  const names = process.getActiveResourcesInfo().filter((n) => n !== 'PipeWrap' && n !== 'TTYWrap');
  return names.reduce((m, n) => { m[n] = (m[n] || 0) + 1; return m; }, {});
}

(async () => {
  const ping = await req('/ping');
  let p = null; try { p = JSON.parse(ping.body); } catch {}
  console.log(ts() + ' PHONE /ping -> ver=' + (p && p.ver) + ' fg=' + (p && p.fg) + ' (fg=false means bridge is backgrounded: the hard case)');

  const link = await call('net:autoconnect', 'usb');
  console.log(ts() + ' LINK ' + (link ? link.ip + ':' + link.port + ' paired=' + link.paired : 'null'));
  if (!link) { console.log('RESULT: FAIL (no device link)'); process.exit(1); }

  let token = '';
  try { token = JSON.parse((await req('/pair')).body).token || ''; } catch {}
  console.log(ts() + ' token len=' + token.length);

  const pcSeed = 'PC-SEED-' + Date.now();
  clipState.text = pcSeed;
  await call('clipboard:watch:start');
  console.log(ts() + ' WATCH on, PC clipboard seed = ' + pcSeed);
  await sleep(5000);
  console.log(ts() + ' PHONE /clipboard before copy -> ' + (await probePhone(token)));

  // simulate "user copied on the phone": write straight into the phone clipboard, never through
  // the desktop path, so a later change of the PC clipboard can only have come from the phone.
  const phoneVal = 'PHONE-COPY-' + Date.now();
  const wr = await req('/clipboard', 'POST', phoneVal, token);
  console.log(ts() + ' POST /clipboard -> http=' + wr.code + ' body=' + wr.body.slice(0, 60) + '  value=' + phoneVal);

  const started = Date.now();
  let nextProbe = Date.now() + 5000;
  let matched = 0;
  while (Date.now() - started < WAIT_MS) {
    await sleep(500);
    if (Date.now() >= nextProbe) { nextProbe = Date.now() + 5000; console.log(ts() + ' PHONE /clipboard -> ' + (await probePhone(token))); }
    if (clipState.text === phoneVal) { matched = Date.now() - started; break; }
  }

  await call('clipboard:watch:stop');
  const final = clipState.text;
  const pulls = reqLog.filter((r) => r.p === '/clipboard/pull');
  const polls = reqLog.filter((r) => r.p === '/clipboard' && r.method === 'GET');
  console.log(ts() + ' desktop REQ /clipboard(GET)=' + polls.length + ' /clipboard/pull=' + pulls.length + ' pullAt=' + JSON.stringify(pulls.map((r) => r.dt)));
  console.log(ts() + ' PC clipboard final = ' + JSON.stringify(final.slice(0, 60)));
  const pass = final === phoneVal;
  console.log(pass ? 'RESULT: PASS (phone content landed on the PC clipboard ' + matched + 'ms after the phone-side copy)' : 'RESULT: FAIL (phone content never reached the PC clipboard within ' + WAIT_MS + 'ms)');

  // why the old version hung: the 5s usb-health interval is still armed here.
  console.log(ts() + ' active handles before cleanup = ' + JSON.stringify(handleCounts()));
  try { await call('net:disconnect'); } catch {}
  await sleep(300);
  console.log(ts() + ' active handles after net:disconnect = ' + JSON.stringify(handleCounts()));
  clearTimeout(watchdog);
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FATAL ' + (e && e.stack || e));
  process.exit(3);
});
