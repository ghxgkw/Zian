'use strict';
/**
 * 本轮两项修复的自验：
 *  任务 1 撤掉单实例锁（多开）：静态无残留 + usbConnect 多开容错行为
 *  任务 2 「从手机读剪贴板」：手动入口 + 自动借焦点（focusRequired → 自动 pull，带限流/退避）
 * 沿用 vm 抽取源码的方式：从 main.js / renderer.js 切出真实实现，注入桩后按行为断言。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const mainSrc = read('main.js');
const preloadSrc = read('preload.js');
const rendSrc = read('renderer.js');
const htmlSrc = read('index.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n + (x ? '  | ' + x : '')); } else { fail++; console.log('FAIL  ' + n + (x ? '  | ' + x : '')); } };
const done = () => { console.log('---- ' + pass + ' passed, ' + fail + ' failed ----'); process.exitCode = fail ? 1 : 0; };
const settle = () => new Promise((r) => setTimeout(r, 0));

function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error('anchor-miss-start: ' + a);
  const j = src.indexOf(b, i + a.length);
  if (j < 0) throw new Error('anchor-miss-end: ' + b);
  return src.slice(i, j + b.length);
}
function toFn(block, name) {
  const s = block.replace(/^ipcMain\.handle\('[^']+',\s*/, 'const ' + name + ' = ');
  return s.replace(/\);\s*$/, ';');
}
function runSandbox(scriptText, sandbox) {
  const ctx = vm.createContext(Object.assign({ console, module: { exports: {} }, Promise, JSON, Object, Array, String, Number, Buffer, setTimeout, clearTimeout, Math, Date, Error }, sandbox));
  vm.runInContext(scriptText, ctx);
  return ctx.module.exports;
}

(async function main() {
// ===================== 任务 1：单实例锁已撤掉 =====================
for (const tok of ['requestSingleInstanceLock', 'second-instance', 'isPrimary']) {
  const hits = ['main.js', 'preload.js', 'renderer.js', 'lib/net.js', 'lib/util.js', 'lib/adb.js', 'index.html']
    .filter((f) => read(f).indexOf(tok) >= 0);
  ok('T1 源码中已无 ' + tok + ' 引用', hits.length === 0, hits.length ? '残留于 ' + hits.join(',') : '7 个源文件全清');
}
ok('T1 whenReady 无条件进入建窗流程', /app\.whenReady\(\)\.then\(\(\) => \{\s*\n\s*if \(!fs\.existsSync\(ADB\)\)/.test(mainSrc));
ok('T1 已无 second-instance 里的聚焦/还原调用', mainSrc.indexOf('mainWin.focus()') < 0 && mainSrc.indexOf('mainWin.restore()') < 0);
ok('T1 多开容错：forward 失败但通道可达时不算失败', /if \(\(f1\.code !== 0 \|\| f2\.code !== 0\) && !info\) return \{ ok: false, msg: 'adb forward 失败' \};/.test(mainSrc));

const pinUsbLine = mainSrc.match(/^const pinUsb = .*$/m)[0];
const usbSrc = sliceBetween(mainSrc, 'async function usbConnect() {', '\n}');
function makeUsb() {
  const script = [
    'let currentLink = null;',
    'let forwardCode = 0;',
    'let pingOk = true;',
    'const adb = async () => ({ code: 0, out: "List of devices attached", err: "" });',
    'const onlineSerials = () => ["USB-SERIAL-1"];',
    'const tryForward = async () => ({ code: forwardCode, out: "", err: "" });',
    'const pingDevice = async () => (pingOk ? ({ ok: true, name: "Phone", ip: "192.168.1.9", port: 35791, fg: true }) : null);',
    'const delay = async () => {};',
    'const startUsbWatch = () => {};',
    'const log = () => {};',
    'const pairGetToken = async () => ({ ok: true, token: "0123456789abcdef0123456789abcdef" });',
    'function loadLinksCache() { return []; }',
    'function saveLinksCache() {}',
    'function tokenOf(l) { return (l && l.token) || ""; }',
    'function publicLink(l) { return l; }',
    'function attachCachedToken(l) { l.paired = !!l.token; return l; }',
    pinUsbLine,
    usbSrc,
    'module.exports = { usbConnect, getLink: () => currentLink, set: (o) => { if (o.forwardCode !== undefined) forwardCode = o.forwardCode; if (o.pingOk !== undefined) pingOk = o.pingOk; } };'
  ].join('\n');
  return runSandbox(script, {});
}
const u1 = makeUsb();
const a1 = await u1.usbConnect();
ok('T1 首个实例：forward 正常即连上', a1.ok === true && u1.getLink().ip === '127.0.0.1' && u1.getLink().port === 35791);
const u2 = makeUsb();
u2.set({ forwardCode: 1, pingOk: true });      // 第二个实例：本地端口已被占用，forward 报错但通道活着
const a2 = await u2.usbConnect();
ok('T1 第二个实例 forward 报错仍能连设备（多开可用）', a2.ok === true && u2.getLink().ip === '127.0.0.1', 'msg=' + (a2.msg || ''));
const u3 = makeUsb();
u3.set({ forwardCode: 1, pingOk: false });
const a3 = await u3.usbConnect();
ok('T1 对照·forward 失败且通道不可达仍报错', a3.ok === false && /adb forward 失败/.test(a3.msg), a3.msg);

// ===================== 任务 2：通道与暴露 =====================
let exposed = null;
const onChannels = [];
const preloadApi = runSandbox(preloadSrc, {
  require: () => ({
    contextBridge: { exposeInMainWorld: (_n, api) => { exposed = api; } },
    ipcRenderer: { invoke: (ch) => ch, on: (ch) => { onChannels.push(ch); } }
  })
});
ok('P1 main 注册 clipboard:pull', mainSrc.indexOf("ipcMain.handle('clipboard:pull'") > 0);
ok('P1 main 注册 clipboard:apply-remote', mainSrc.indexOf("ipcMain.handle('clipboard:apply-remote'") > 0);
ok('P1 preload 暴露 clipboardPull → clipboard:pull', typeof exposed.clipboardPull === 'function' && exposed.clipboardPull({}) === 'clipboard:pull');
ok('P1 preload 暴露 clipboardApplyRemote → clipboard:apply-remote', typeof exposed.clipboardApplyRemote === 'function' && exposed.clipboardApplyRemote({}) === 'clipboard:apply-remote');
exposed.onClipboardFocusRequired(() => {});
exposed.onClipboardTapRequired(() => {});
ok('P1 preload 暴露 focusRequired / tapRequired 事件', onChannels.indexOf('clipboard:focus-required') >= 0 && onChannels.indexOf('clipboard:tap-required') >= 0, 'channels=' + onChannels.join(','));
ok('P2 index.html 有「📥 从手机读剪贴板」按钮', /id="btn-clip-pull-focus"/.test(htmlSrc) && htmlSrc.indexOf('📥 从手机读剪贴板') > 0);
ok('P2 新按钮无内联事件处理器（CSP 不受影响）', !/id="btn-clip-pull-focus"[^>]*\son\w+=/.test(htmlSrc));
ok('P2 CSP 头仍在', /Content-Security-Policy/.test(htmlSrc));
ok('P2 renderer 绑定新按钮', rendSrc.indexOf("$('#btn-clip-pull-focus').onclick = pullClipFromPhone;") > 0);
ok('P2 renderer 订阅 focusRequired / tapRequired', rendSrc.indexOf('api.onClipboardFocusRequired(() => showFocusRequiredHint());') > 0 && rendSrc.indexOf('api.onClipboardTapRequired(() => showTapRequiredHint());') > 0);

// ===================== 主进程：pull / apply / watch =====================
const stateBlock = sliceBetween(mainSrc, 'let clipboardTimer = null;', 'let lastTapHint = 0;');
const pullReqSrc = sliceBetween(mainSrc, 'async function requestPhonePull(link) {', '\n}');
const writeBlock = sliceBetween(mainSrc, 'function writeRemoteToLocal(send, remote) {', '\n}');
const notifyBlock = sliceBetween(mainSrc, 'function notifyFocusRequired(send) {', '\n}');
const notifyTapSrc = sliceBetween(mainSrc, 'function notifyTapRequired(send) {', '\n}');
const autoPullSrc = sliceBetween(mainSrc, 'function maybeAutoPull(send) {', '\n}');
const pullFnSrc = toFn(sliceBetween(mainSrc, "ipcMain.handle('clipboard:pull', async (_e, link) => {", '\n});'), 'pullFn');
const applyFnSrc = toFn(sliceBetween(mainSrc, "ipcMain.handle('clipboard:apply-remote', (e, remote) => {", '\n});'), 'applyFn');
const watchFnSrc = toFn(sliceBetween(mainSrc, "ipcMain.handle('clipboard:watch:start', (e) => {", '\n});'), 'watchFn');

function makeMain() {
  const script = [
    stateBlock,
    'let now = 1700000000000;',
    'const Date = { now: () => now };',
    'let interval = null;',
    'const setInterval = (fn, ms) => { interval = { fn, ms }; return 1; };',
    'const clearInterval = () => { interval = null; };',
    'let currentText = "";',
    'const writes = { text: [], image: [] };',
    'const clipboard = { readImage: () => ({ isEmpty: () => true }), readText: () => currentText, writeText: (t) => { currentText = t; writes.text.push(t); }, writeImage: (i) => { writes.image.push(i); } };',
    'const nativeImage = { createFromBuffer: () => ({ isEmpty: () => false }) };',
    'const localClipSig = () => ({ sig: "txt:" + Buffer.byteLength(currentText, "utf8") + ":LOCAL", payload: { type: "text", data: currentText } });',
    writeBlock,
    notifyBlock,
    notifyTapSrc,
    'let currentLink = { ip: "10.0.0.2", port: 35791, token: "0123456789abcdef0123456789abcdef" };',
    'let clipAuthFailed = false;',
    'const requestLog = [];',
    'const clipQueue = [];',
    'const pullQueue = [];',
    'const httpGetJson = async (ip, port, p, timeoutMs, retries, token) => {',
    '  requestLog.push({ ip, port, p, timeoutMs, retries, token });',
    '  if (p === "/clipboard/pull") return pullQueue.length ? pullQueue.shift() : { ok: true, launched: true };',
    '  return clipQueue.length ? clipQueue.shift() : null;',
    '};',
    'const pushClipToPhone = async () => ({ ok: true });',
    'const isUnauthorized = (r) => !!r && r.__unauthorized === true;',
    'let authWarn = 0;',
    'const warnUnauthorized = () => { authWarn++; };',
    'const endpointOf = () => (currentLink ? { ip: currentLink.ip, port: currentLink.port } : null);',
    'const tokenOf = (l) => (l && l.token) || (currentLink && currentLink.token) || "";',
    pullReqSrc,
    autoPullSrc,
    pullFnSrc,
    applyFnSrc,
    watchFnSrc,
    'module.exports = { pullFn, applyFn, watchFn, requestLog, clipQueue, pullQueue, events: [], writes, setNow: (v) => { now = v; }, getNow: () => now, getInterval: () => interval, authWarnCount: () => authWarn, getText: () => currentText, pulls: () => requestLog.filter((r) => r.p === "/clipboard/pull").length };'
  ].join('\n');
  const api = runSandbox(script, {});
  api.fakeEvent = { sender: { send: (ch, p) => api.events.push({ ch, p }) } };
  return api;
}

// M1 请求形状
{
  const m = makeMain();
  m.pullQueue.push({ ok: true, focusRequired: true, launched: true });
  const r = await m.pullFn(m.fakeEvent, { ip: '10.0.0.2', port: 35791, token: 'T'.repeat(32) });
  ok('M1 clipboard:pull 命中 GET /clipboard/pull', m.requestLog.length === 1 && m.requestLog[0].p === '/clipboard/pull', JSON.stringify(m.requestLog[0]));
  ok('M1 带 X-Zian-Token（走 authHeaders/tokenOf 机制）', m.requestLog[0].token === 'T'.repeat(32));
  ok('M1 不静默重试（retries=0）', m.requestLog[0].retries === 0 && m.requestLog.length === 1);
  ok('M1 返回 ok + focusRequired + launched', r.ok === true && r.focusRequired === true && r.launched === true, JSON.stringify(r));
}
// M2 401
{
  const m = makeMain();
  m.pullQueue.push({ __unauthorized: true });
  const r = await m.pullFn(m.fakeEvent, null);
  ok('M2 401 → 统一出口提示配对且只请求一次', r.ok === false && r.err === 'unauthorized' && m.authWarnCount() === 1 && m.requestLog.length === 1);
}
// M3 无响应 / 手机端拒绝
{
  const m = makeMain();
  m.pullQueue.push(null);
  const r1 = await m.pullFn(m.fakeEvent, null);
  ok('M3 设备无响应有明确失败返回', r1.ok === false && /无响应/.test(r1.msg), r1.msg);
  m.pullQueue.push({ ok: false, err: 'busy' });
  const r2 = await m.pullFn(m.fakeEvent, null);
  ok('M3 手机端拒绝时透出错误', r2.ok === false && /busy/.test(r2.msg), r2.msg);
}
// M4 focusRequired 提示限流
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  ok('M4 自动同步仍是 1s 间隔', m.getInterval().ms === 1000);
  await tick();   // 热身：首轮只推送本地剪贴板（既有设计）
  for (let i = 0; i < 3; i++) { m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true }); await tick(); await settle(); }
  const hints = m.events.filter((e) => e.ch === 'clipboard:focus-required');
  ok('M4 focusRequired 三连 tick 只提示一次（限流生效）', hints.length === 1, 'n=' + hints.length);
  ok('M4 提示指向人工入口', hints.length === 1 && /从手机读剪贴板/.test(hints[0].p.msg), hints.length ? hints[0].p.msg : '');
  ok('M4 focusRequired 不写本机剪贴板', m.writes.text.length === 0);
}
// M5 cached:true 内容写回
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  await tick();   // 热身
  const text = 'zian-缓存内容';
  const payload = { type: 'text', sig: 'txt:' + Buffer.byteLength(text, 'utf8') + ':deadbeef', data: Buffer.from(text, 'utf8').toString('base64'), cached: true };
  m.clipQueue.push(payload); await tick();
  ok('M5 cached:true 内容写入本机剪贴板', m.getText() === text, JSON.stringify(m.getText()));
  const ev = m.events.filter((e) => e.ch === 'clipboard:remote');
  ok('M5 写回事件带 cached 标记（供提示标注）', ev.length === 1 && ev[0].p.cached === true && ev[0].p.data === text, JSON.stringify(ev[0] && ev[0].p));
  m.clipQueue.push(payload); await tick();
  ok('M5 同一内容不重复写回', m.writes.text.length === 1, 'writes=' + m.writes.text.length);
}
// M6 apply-remote 共用写回路径
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  await tick();   // 热身
  const text = 'zian-手动';
  const payload = { type: 'text', sig: 'txt:' + Buffer.byteLength(text, 'utf8') + ':cafebabe', data: Buffer.from(text, 'utf8').toString('base64'), cached: true };
  const r = m.applyFn(m.fakeEvent, payload);
  ok('M6 clipboard:apply-remote 写入本机剪贴板', r.ok === true && m.getText() === text, JSON.stringify(r));
  ok('M6 回传 cached 标记', r.cached === true && r.type === 'text');
  m.clipQueue.push(payload); await tick();
  ok('M6 手动写回后不会被自动同步二次写回（共用防回环记账）', m.writes.text.length === 1, 'writes=' + m.writes.text.length);
}

// ===================== A：自动借焦点（focusRequired → 自动 pull） =====================
// A1 focusRequired 触发一次自动 pull
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  await tick();   // 热身
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  ok('A1 focusRequired 自动调用一次 clipboard:pull', m.pulls() === 1, 'pulls=' + m.pulls());
  ok('A1 自动 pull 与手动共用同一请求（带令牌、不重试）', m.requestLog.filter((r) => r.p === '/clipboard/pull').every((r) => r.retries === 0 && r.token === '0123456789abcdef0123456789abcdef'));
}
// A2 10s 内第二次 focusRequired 不再 pull
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  await tick();
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  m.setNow(m.getNow() + 1000);
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  ok('A2 10 秒内第二次 focusRequired 不重复 pull（限流生效）', m.pulls() === 1, 'pulls=' + m.pulls());
  m.setNow(m.getNow() + 9000);   // 距上次 pull 满 10s
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  ok('A2 满 10 秒后允许再次自动 pull', m.pulls() === 2, 'pulls=' + m.pulls());
}
// A3 连续 2 次仍 focusRequired → 退避 30s + 提示人工点通知
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  await tick();
  const focusTick = async (advanceMs) => { if (advanceMs) m.setNow(m.getNow() + advanceMs); m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true }); await tick(); await settle(); };
  await focusTick(0);        // t0  → pull #1
  await focusTick(1000);     // 无果 → streak=1，10s 内不 pull
  await focusTick(9000);     // t10 → 满 10s，pull #2
  await focusTick(1000);     // 仍 focusRequired → streak=2，退避 30s + 提示
  const taps = m.events.filter((e) => e.ch === 'clipboard:tap-required');
  ok('A3 连续 2 次无果后切到「请在手机上点一下通知」提示', taps.length === 1 && /请在手机上点一下通知/.test(taps[0].p.msg), taps.length ? taps[0].p.msg : '');
  ok('A3 此时 pulls=2（不是每秒重试）', m.pulls() === 2, 'pulls=' + m.pulls());
  await focusTick(11000);    // t21 → 距上次 pull 11s，但已退避 30s
  ok('A3 退避期（30s）内不再自动 pull', m.pulls() === 2, 'pulls=' + m.pulls());
  await focusTick(20000);    // t41 → 距上次 pull 31s，退避已满
  ok('A3 退避期满后恢复自动 pull', m.pulls() === 3, 'pulls=' + m.pulls());
  ok('A3 人工提示仍限流（60s 内只一条）', m.events.filter((e) => e.ch === 'clipboard:tap-required').length === 1);
}
// A4 launched:false：不进入重试风暴
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  await tick();
  m.pullQueue.push({ ok: true, launched: false });
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  ok('A4 launched:false 时提示人工点通知', m.events.filter((e) => e.ch === 'clipboard:tap-required').length === 1);
  for (const adv of [1000, 10000, 10000, 10000, 10000]) {
    m.setNow(m.getNow() + adv);
    m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
    await tick(); await settle();
  }
  ok('A4 launched:false 后 41 秒内不再自动 pull（静默 60s）', m.pulls() === 1, 'pulls=' + m.pulls());
  m.setNow(m.getNow() + 20000);   // 超过 60s 静默
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  ok('A4 静默期满才允许再试一次', m.pulls() === 2, 'pulls=' + m.pulls());
}
// A5 拿到内容后不再提示人工点通知
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  await tick();
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  const text = 'zian-借焦点';
  m.clipQueue.push({ type: 'text', sig: 'txt:6:abcd', data: Buffer.from(text, 'utf8').toString('base64'), cached: true });
  await tick();
  ok('A5 pull 后下一轮拿到 cached 内容即写回', m.getText() === text, JSON.stringify(m.getText()));
  m.setNow(m.getNow() + 1000);
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  ok('A5 内容到达后再 focusRequired 不弹人工点通知提示', m.events.filter((e) => e.ch === 'clipboard:tap-required').length === 0);
}
// A6 用户点按钮重置退避
{
  const m = makeMain();
  await m.watchFn(m.fakeEvent);
  const tick = m.getInterval().fn;
  await tick();
  m.pullQueue.push({ ok: true, launched: false });
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();      // 自动 pull 被拦 → 静默 60s
  m.setNow(m.getNow() + 1000);
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  const before = m.pulls();
  m.pullQueue.push({ ok: true, launched: true });
  await m.pullFn(m.fakeEvent, null);  // 用户点按钮
  m.clipQueue.push({ type: 'empty', sig: '', focusRequired: true });
  await tick(); await settle();
  ok('A6 用户点按钮后自动 pull 的退避被重置（下一次轮询即可再拉）', m.pulls() === before + 2, 'before=' + before + ' after=' + m.pulls());
}

// ===================== 渲染层：拉取流程 =====================
const hintRendSrc = sliceBetween(rendSrc, 'function showFocusRequiredHint() {', '\n}');
const tapHintRendSrc = sliceBetween(rendSrc, 'function showTapRequiredHint() {', '\n}');
const pullRendSrc = sliceBetween(rendSrc, 'async function pullClipFromPhone() {', '\n}');
function makeRend() {
  const script = [
    'let clipPulling = false;',
    'let focusHintShownAt = 0;',
    'let tapHintShownAt = 0;',
    'const CLIP_POLL_MS = 1000;',
    'const CLIP_POLL_TIMEOUT_MS = 15000;',
    "const CLIP_FOCUS_HINT = '手机端后台读不到剪贴板，点「从手机读剪贴板」或让互联桥在前台';",
    "const CLIP_TAP_HINT = '手机端拦下了后台读取，请在手机上点一下通知';",
    'let now = 1700000000000;',
    'const Date = { now: () => now };',
    'const setTimeout = (fn, ms) => { now += ms; fn(); return 0; };',
    'const els = { "#clip-state": { textContent: "未开启 · 点击开启" }, "#btn-clip-pull-focus": { disabled: false, textContent: "📥 从手机读剪贴板" } };',
    'const $ = (s) => els[s] || null;',
    'const toasts = [];',
    'const toast = (m, e) => toasts.push({ m, err: !!e });',
    'const needLink = () => true;',
    'const previews = [];',
    'const applyRemoteClipboard = (p, f) => previews.push(p);',
    'let pullResp = { ok: true };',
    'let clipResps = [];',
    'let getCount = 0;',
    'let disabledSeen = null;',
    'let labelsSeen = [];',
    'const applyArgs = [];',
    'const api = {',
    '  clipboardPull: async () => pullResp,',
    '  clipboardGet: async () => { getCount++; if (disabledSeen === null) disabledSeen = els["#btn-clip-pull-focus"].disabled; labelsSeen.push(els["#btn-clip-pull-focus"].textContent); return clipResps.length ? clipResps.shift() : { type: "empty", sig: "" }; },',
    '  clipboardApplyRemote: async (r) => { applyArgs.push(r); return { ok: true, type: r.type, cached: !!r.cached }; }',
    '};',
    'const currentLink = { ip: "10.0.0.2", port: 35791 };',
    hintRendSrc,
    tapHintRendSrc,
    pullRendSrc,
    'module.exports = { pull: pullClipFromPhone, hint: showFocusRequiredHint, tapHint: showTapRequiredHint, els, toasts, previews, applyArgs, getCount: () => getCount, setResps: (a) => { clipResps = a; }, setPull: (v) => { pullResp = v; }, disabledSeen: () => disabledSeen, labelsSeen: () => labelsSeen, advance: (ms) => { now += ms; }, now: () => now };'
  ].join('\n');
  return runSandbox(script, {});
}

// R1 轮询成功
{
  const r = makeRend();
  const payload = { type: 'text', sig: 'txt:5:aa', data: Buffer.from('hello', 'utf8').toString('base64') };
  r.setResps([{ type: 'empty', sig: '' }, payload]);
  await r.pull();
  ok('R1 pull 后轮询成功即写回本机剪贴板（交主进程共用写回）', r.applyArgs.length === 1 && r.applyArgs[0] === payload, 'apply=' + r.applyArgs.length);
  ok('R1 只轮询到第一次有内容为止', r.getCount() === 2, 'polls=' + r.getCount());
  ok('R1 成功提示', /已从手机读回剪贴板/.test(r.toasts[0].m) && r.toasts[0].err === false, r.toasts[0].m);
  ok('R1 非缓存内容不加缓存标注', r.toasts[0].m.indexOf('来自手机缓存') < 0);
  ok('R1 预览同步更新', r.previews.length === 1);
  ok('R1 轮询期间按钮禁用', r.disabledSeen() === true);
  ok('R1 结束后按钮恢复可用且文案复原', r.els['#btn-clip-pull-focus'].disabled === false && r.els['#btn-clip-pull-focus'].textContent === '📥 从手机读剪贴板', r.els['#btn-clip-pull-focus'].textContent);
  ok('R1 轮询期间显示进度文案', r.labelsSeen().some((l) => /等待手机/.test(l)), JSON.stringify(r.labelsSeen()));
}
// R2 15s 超时
{
  const r = makeRend();
  r.setResps([]);
  await r.pull();
  ok('R2 1s × 15 次轮询后超时', r.getCount() === 15, 'polls=' + r.getCount());
  ok('R2 超时提示「请在手机上点一下通知」', r.toasts[r.toasts.length - 1].m === '请在手机上点一下通知', r.toasts[r.toasts.length - 1].m);
  ok('R2 超时后不写剪贴板', r.applyArgs.length === 0);
  ok('R2 超时后按钮恢复', r.els['#btn-clip-pull-focus'].disabled === false && r.els['#btn-clip-pull-focus'].textContent === '📥 从手机读剪贴板');
  ok('R2 等待总时长不超过 15s', r.now() - 1700000000000 <= 15000, 'elapsed=' + (r.now() - 1700000000000));
}
// R3 cached:true
{
  const r = makeRend();
  const payload = { type: 'text', sig: 'txt:5:bb', data: Buffer.from('cache', 'utf8').toString('base64'), cached: true };
  r.setResps([payload]);
  await r.pull();
  ok('R3 cached:true 仍正常写回', r.applyArgs.length === 1 && r.applyArgs[0].cached === true);
  ok('R3 提示标注「（来自手机缓存）」', r.toasts[0].m.indexOf('（来自手机缓存）') > 0, r.toasts[0].m);
  ok('R3 cached 不改变成功提示主体', /已从手机读回剪贴板/.test(r.toasts[0].m));
}
// R4 pull 失败：不轮询
{
  const r = makeRend();
  r.setPull({ ok: false, msg: '设备无响应，请确认手机「梓安互联桥」仍在前台' });
  await r.pull();
  ok('R4 pull 失败直接提示且不轮询', r.getCount() === 0 && r.toasts[0].err === true && /无响应/.test(r.toasts[0].m), r.toasts[0].m);
  ok('R4 失败后按钮恢复', r.els['#btn-clip-pull-focus'].disabled === false);
  const r2 = makeRend();
  r2.setPull({ ok: false, err: 'unauthorized', msg: '需要重新配对（401）' });
  await r2.pull();
  ok('R4 401 时不静默重试（无轮询、直接提示配对）', r2.getCount() === 0 && /401|配对/.test(r2.toasts[0].m), r2.toasts[0].m);
}
// R5 focusRequired 提示限流
{
  const r = makeRend();
  const a = r.hint();
  const b = r.hint();
  const c = r.hint();
  ok('R5 focusRequired 提示只显示一次（限流生效）', a === true && b === false && c === false, 'a=' + a + ' b=' + b + ' c=' + c);
  ok('R5 状态行写入提示文案', r.els['#clip-state'].textContent === '手机端后台读不到剪贴板，点「从手机读剪贴板」或让互联桥在前台', r.els['#clip-state'].textContent);
  r.advance(60000);
  ok('R5 60s 后允许再提示', r.hint() === true);
}
// R6 tapRequired 提示限流
{
  const r = makeRend();
  ok('R6 tapRequired 状态行提示只显示一次', r.tapHint() === true && r.tapHint() === false, r.els['#clip-state'].textContent);
  ok('R6 提示文案为「请在手机上点一下通知」', r.els['#clip-state'].textContent === '手机端拦下了后台读取，请在手机上点一下通知', r.els['#clip-state'].textContent);
}
// R7 launched:false
{
  const r = makeRend();
  r.setPull({ ok: true, launched: false });
  r.setResps([]);
  await r.pull();
  ok('R7 launched:false 时立即提示「请在手机上点一下通知」', r.toasts[0].m === '请在手机上点一下通知' && r.toasts[0].err === true, r.toasts[0].m);
  ok('R7 launched:false 仍继续轮询等待用户点通知', r.getCount() === 15, 'polls=' + r.getCount());
  ok('R7 结束后按钮恢复', r.els['#btn-clip-pull-focus'].disabled === false && r.els['#btn-clip-pull-focus'].textContent === '📥 从手机读剪贴板');
}
// R8 连点保护
{
  const r = makeRend();
  r.setResps([]);
  const p1 = r.pull();
  const p2 = r.pull();
  await Promise.all([p1, p2]);
  ok('R8 连点按钮不会并发开两个轮询', r.getCount() === 15, 'polls=' + r.getCount());
}

done();
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(3); });
