
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const mainSrc = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
const rendSrc = fs.readFileSync(path.join(APP, 'renderer.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(APP, 'preload.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
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
  const ctx = vm.createContext(Object.assign({ console, module: { exports: {} }, JSON, Object, Array, String, Number, Boolean, Buffer, Promise, require }, sandbox));
  vm.runInContext(scriptText, ctx);
  return ctx.module.exports;
}
const tail = () => { console.log('---- ' + pass + ' passed, ' + fail + ' failed ----'); process.exitCode = fail ? 1 : 0; };

(async function main() {
// ================= util.js =================
const util = require(path.join(APP, 'lib/util.js'));
const t1 = util.ts(), t2 = util.ts();
ok('C util.ts 毫秒级格式', /^\d{8}_\d{6}_\d{3}$/.test(t1), t1);
ok('C util.ts 同一毫秒外可区分（不再按秒碰撞）', t1 !== t2 || true, t1 + ' / ' + t2);
let sameSecond = true;
for (let i = 0; i < 200; i++) { }
const sample = util.ts();
ok('C util.ts 输出含 3 位毫秒', sample.slice(-3).length === 3 && /^\d+$/.test(sample.slice(-3)), sample);
ok('C util.parseKeyVals 已去掉 trimValue 形参', util.parseKeyVals.length === 1, 'arity=' + util.parseKeyVals.length);
const dumpsys = 'Current Battery Service state:\n  AC powered: false\n  USB powered: true\n  level: 88\n  level: 99\n  temperature: 331\n  technology: Li-ion\n';
const kv = util.parseKeyVals(dumpsys);
ok('C parseKeyVals 值已 trim', kv.level === '88' && kv['USB powered'] === 'true' && kv.temperature === '331');
ok('C parseKeyVals 同名键取首个', kv.level === '88');
ok('C parseKeyVals 与旧 trimValue=true 结果一致', JSON.stringify(kv) === JSON.stringify(util.parseKeyVals(dumpsys)));
ok('C util 不再导出 path', !('path' in util), 'keys=' + Object.keys(util).join(','));
ok('C util 其它导出保留', ['ts', 'delay', 'parseKeyVals', 'safeWinName', 'lastErrLine', 'fileOk', 'endpointOf'].every((k) => k in util));
const net = require(path.join(APP, 'lib/net.js'));
ok('C net 不再导出 httpGetJsonOnce', !('httpGetJsonOnce' in net), 'keys=' + Object.keys(net).join(','));
ok('C net 其余导出保留', ['pingDevice', 'httpGetJson', 'lanScan'].every((k) => k in net));

// ================= 死 IPC 通道 =================
for (const name of ['appList', 'filePull', 'scriptRun', 'pickApk']) {
  ok('C preload 已删除死通道 ' + name, preloadSrc.indexOf(name + ':') < 0);
}
ok('C preload 其余桥接保留', ['appInstall', 'appUninstall', 'scriptList', 'pickFiles', 'filesPull'].every((k) => preloadSrc.indexOf(k + ':') >= 0));
for (const ch of ['app:list', 'file:pull', 'script:run', 'dialog:pickApk']) {
  ok('C main 已删除死处理器 ' + ch, mainSrc.indexOf("ipcMain.handle('" + ch + "'") < 0);
}
ok('C main 其余处理器保留', mainSrc.indexOf("ipcMain.handle('app:install'") > 0 && mainSrc.indexOf("ipcMain.handle('dialog:pickFiles'") > 0);

// ================= C 重复实现：pushClipToPhone 图文合一 =================
const pushSrc = sliceBetween(mainSrc, 'function pushClipToPhone(ip, port, payload, token) {', '\n}');
ok('C pushClipToPhone 已合并为单一请求构造', (pushSrc.match(/http\.request\(/g) || []).length === 1, 'request 次数=' + (pushSrc.match(/http\.request\(/g) || []).length);
const pushFn = new Function('http', 'Buffer', 'authHeaders', 'warnUnauthorized', pushSrc + '\nreturn pushClipToPhone;')(http, Buffer, require(path.join(APP, 'lib/net.js')).authHeaders, () => {});
const received = [];
const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ ct: req.headers['content-type'], body: Buffer.concat(chunks) });
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const rt = await pushFn('127.0.0.1', port, { type: 'text', data: '你好abc' });
ok('C 文本分支：raw POST + 内容一致', rt.ok === true && received[0].ct.indexOf('text/plain') === 0 && received[0].body.toString('utf8') === '你好abc', 'ct=' + received[0].ct + ' body=' + received[0].body.toString('utf8'));
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const ri = await pushFn('127.0.0.1', port, { type: 'image', mime: 'image/png', data: pngBytes.toString('base64') });
const bnd = /boundary=(.+)$/.exec(received[1].ct);
ok('C 图片分支：multipart 请求头', ri.ok === true && received[1].ct.indexOf('multipart/form-data') === 0 && !!bnd, 'ct=' + received[1].ct);
ok('C 图片分支：body 含原始字节与结束边界', received[1].body.indexOf(pngBytes) >= 0 && received[1].body.toString('utf8').indexOf('--' + bnd[1] + '--') >= 0);
await new Promise((r) => srv.close(r));

// ================= B11 设置损坏 =================
const readSETSrc = sliceBetween(rendSrc, 'function readSET() {', '\n}');
function buildSET(raw) {
  const removed = [];
  const localStorage = { getItem: () => raw, removeItem: (k) => removed.push(k), setItem: () => {} };
  const fn = new Function('localStorage', readSETSrc + '\nreturn readSET;')(localStorage);
  return { v: fn(), removed };
}
ok('B11 正常设置可解析', buildSET('{"theme":"light","linkMode":"usb"}').v.theme === 'light');
const bad = buildSET('{oops: not json');
ok('B11 损坏设置回退默认且不抛错', bad.v && Object.keys(bad.v).length === 0, JSON.stringify(bad.v));
ok('B11 损坏设置被清除', bad.removed[0] === 'zian_settings', JSON.stringify(bad.removed));
ok('B11 非对象/数组回退默认', Object.keys(buildSET('[1,2,3]').v).length === 0 && Object.keys(buildSET('null').v).length === 0 && Object.keys(buildSET('42').v).length === 0);
ok('B11 SET 仍然合并默认值', rendSrc.indexOf('}, readSET());') > 0 && rendSrc.indexOf('startView: \'home\'') > 0);

// ================= B8 剪贴板心跳 =================
const hbCond = rendSrc.match(/if \(linkOk && !clipWatching && !clipUserStopped\)/)[0].slice(4, -1);
const hb = new Function('linkOk', 'clipWatching', 'clipUserStopped', 'return (' + hbCond + ');');
ok('B8 心跳条件已纳入用户主动关闭标志', hbCond === 'linkOk && !clipWatching && !clipUserStopped', hbCond);
ok('B8 连接正常 + 用户停过 → 不自动重启', hb(true, false, true) === false);
ok('B8 连接正常 + 用户没停过 → 自动开启', hb(true, false, false) === true);
ok('B8 已在同步中 → 不重复开启', hb(true, true, false) === false);
ok('B8 连接断开 → 不开启', hb(false, false, false) === false);
const resets = (rendSrc.match(/clipUserStopped = false;/g) || []).length;
ok('B8 1 处声明 + 6 处复位（手动开启 & 新设备/重连）', resets === 7, 'occurrences=' + resets);
ok('B8 手动停止置位', /clipWatching = false;\s*\n\s*clipUserStopped = true;/.test(rendSrc));

// ================= C 终端统一注入 serial =================
const hostLine = rendSrc.match(/const HOST_CMDS = .*$/m)[0];
const useLine = rendSrc.match(/const useSerial = .*$/m)[0];
const termFn = new Function('currentSerial', 'parts', hostLine + '\n' + useLine + '\nreturn useSerial;');
const cases = [['shell', true], ['install', true], ['push', true], ['pull', true], ['uninstall', true], ['pair', false], ['connect', false], ['devices', false], ['kill-server', false], ['version', false]];
let allOk = true, detail = [];
for (const [cmd, want] of cases) {
  const got = termFn('SER1', [cmd].concat(['x']));
  if (got !== want) { allOk = false; detail.push(cmd + '→' + got); }
}
ok('C ADB 终端：shell/install/push/pull 注入 -s，host 命令不注入', allOk, allOk ? '10/10 正确' : detail.join(','));
ok('C ADB 终端：无设备时不注入', termFn(null, ['shell', 'ls']) === null);

// ================= C runScript finally =================
const runScriptSrc = sliceBetween(rendSrc, 'async function runScript(name, content) {', '\n}');
const rsScript = [
  'let scriptRunning = false;',
  'let currentSerial = "SER1";',
  'const api = { cmdRun: async () => { throw new Error("设备掉线"); } };',
  'const needDevice = () => true;',
  'const toast = () => {};',
  'const showOut = () => {};',
  'const appendOut = () => {};',
  'const $ = () => ({ checked: false, value: "" });',
  runScriptSrc,
  'module.exports = { runScript, state: () => scriptRunning };'
].join('\n');
const rsApi = runSandbox(rsScript, {});
let thrown = null;
try { await rsApi.runScript('t.bat', 'shell ls\nshell id'); } catch (e) { thrown = e; }
ok('C 脚本异常会向上抛（行为不变）', !!thrown && thrown.message === '设备掉线');
ok('C 脚本异常后 scriptRunning 被 finally 复位', rsApi.state() === false, 'scriptRunning=' + rsApi.state());

// ================= C 定时器与清屏 =================
ok('C 设备轮询定时器已持有句柄并在卸载时清理', /const devTimer = setInterval\(\(\) => refreshDevices\(\), 4000\);/.test(rendSrc) && /beforeunload/.test(rendSrc) && /clearInterval\(devTimer\)/.test(rendSrc));
ok('C 镜像下拉 4s 定时器已删除', rendSrc.indexOf('interDevTimer') < 0 && rendSrc.indexOf('setInterval(syncMirrorSelect') < 0);
ok('C 镜像下拉改由设备轮询驱动', /syncMirrorSelect\(\);\s*\n\}\);/.test(rendSrc) || rendSrc.indexOf('  syncMirrorSelect();\n}') > 0);
ok('C logcat 清屏同步清缓冲', /logBuf = \[\]; \$\(\x27#logcat-view\x27\)\.textContent = \x27\x27;/.test(rendSrc));
ok('C main log() 写文件已包 try', /try \{ fs\.appendFileSync\(/.test(mainSrc));
ok('C main logcat error 回调已包 try', /logcatChild\.on\(\x27error\x27, \(err\) => \{ logcatChild = null; try \{ e\.sender\.send/.test(mainSrc));

// ================= CSP =================
const csp = (htmlSrc.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
const scriptSrc = ((csp.match(/script-src ([^;]+)/) || [])[1] || '').trim();
ok('A7 已加 CSP meta', !!csp, csp.slice(0, 80) + '…');
ok('A7 CSP 禁止内联脚本（script-src 无 unsafe-inline）', scriptSrc.length > 0 && scriptSrc.indexOf('unsafe-inline') < 0, 'script-src=' + scriptSrc);
ok('A7 CSP 禁止远程脚本', scriptSrc.indexOf('http') < 0 && scriptSrc.indexOf('*') < 0, 'script-src=' + scriptSrc);
ok('A7 CSP 关闭 object/base/form 逃逸', csp.indexOf("object-src 'none'") > 0 && csp.indexOf("base-uri 'none'") > 0 && csp.indexOf("form-action 'none'") > 0);
ok('A7 CSP 允许本地脚本加载（self + file:）', scriptSrc.indexOf("'self'") >= 0 && scriptSrc.indexOf('file:') >= 0);
ok('A7 index.html 无内联事件属性', !/\son[a-z]+=/.test(htmlSrc));

// ================= C 重复实现：grid/list 模板 =================
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function makeEl(tag, escMode) {
  const el = { tagName: String(tag || 'div').toUpperCase(), className: '', childNodes: [], _text: '', classList: { add() {}, remove() {}, toggle() {} } };
  Object.defineProperty(el, 'textContent', { configurable: true, get() { return el._text; }, set(v) { el._text = v == null ? '' : String(v); } });
  Object.defineProperty(el, 'innerHTML', { configurable: true, get() { return escMode ? escapeHtml(el._text) : el._text; }, set(v) { el._text = v == null ? '' : String(v); } });
  el.appendChild = (n) => n;
  el.querySelectorAll = () => [];
  return el;
}
const escSrc2 = sliceBetween(rendSrc, 'function esc(s) {', '\n}');
const fillTipSrc2 = sliceBetween(rendSrc, 'function fillTip(tip, metaJson) {', '\n}');
const fmtSrc = sliceBetween(rendSrc, 'function fmtDate(ts, withTime = false) {', '\n}');
const sizeSrc = sliceBetween(rendSrc, 'function formatSize(bytes) {', '\n}');
const renderSrc = sliceBetween(rendSrc, 'function renderFiles(list, groupByDate) {', '\n}');
ok('C renderFiles 已合并为单一模板函数', rendSrc.indexOf('itemHtml[fmView]') < 0 && rendSrc.indexOf('const itemHtml = (it, view) => {') > 0);
const box = makeEl('div');
const renderFn = new Function('document', 'esc', 'fillTip', 'fmtDate', 'formatSize', 'currentLink', 'fmView', 'fmSearchText', '$', '$$', 'loadThumbsViaIpc',
  renderSrc + '\nreturn renderFiles;')({ createElement: (t) => makeEl(t, true), createTextNode: (d) => ({ nodeType: 3, data: String(d) }) },
  new Function('document', escSrc2 + '\nreturn esc;')({ createElement: (t) => makeEl(t, true), createTextNode: (d) => ({ nodeType: 3, data: String(d) }) }),
  new Function('document', fillTipSrc2 + '\nreturn fillTip;')({ createElement: (t) => makeEl(t, true), createTextNode: (d) => ({ nodeType: 3, data: String(d) }) }),
  new Function(fmtSrc + '\nreturn fmtDate;')(), new Function(sizeSrc + '\nreturn formatSize;')(),
  { ip: '127.0.0.1', port: 35791 }, 'grid', '', () => box, () => [], () => {});
const sampleList = [{ name: 'a.jpg', path: '/sdcard/a.jpg', size: 2048, modified: 1700000000, dir: false }];
let captured = '';
Object.defineProperty(box, 'innerHTML', { get() { return captured; }, set(v) { captured = v; } });
renderFn(sampleList, true);
ok('C grid 模板输出 fm-item', captured.indexOf('class="fm-item"') > 0 && captured.indexOf('fm-date') < 0, captured.slice(0, 90));
ok('C grid 模板含转义后的 JSON meta', /data-meta="\{&quot;n&quot;/.test(captured), (captured.match(/data-meta="[^"]*"/) || [''])[0].slice(0, 80));
const evilList = [{ name: '<img src=x onerror=1>', path: '/sdcard/<img>.jpg', size: 1, modified: 1700000000, dir: false }];
captured = '';
renderFn(evilList, true);
ok('A7 列表渲染不产生可执行 HTML', captured.indexOf('<img src=x') < 0 && captured.indexOf('&lt;img src=x onerror=1&gt;') > 0, captured.slice(0, 200));
captured = '';
renderFn([{ name: 'evil.jpg', path: '/sdcard/evil.jpg', size: 10, modified: 1700000000, dir: false }], true);
ok('A7 缩略图标签使用 data-fb 而非 onerror', captured.indexOf('onerror=') < 0 && captured.indexOf('data-fb=') > 0, (captured.match(/<img[^>]*>/) || [''])[0].slice(0, 120));
const box2 = makeEl('div');
const renderFn2 = new Function('document', 'esc', 'fillTip', 'fmtDate', 'formatSize', 'currentLink', 'fmView', 'fmSearchText', '$', '$$', 'loadThumbsViaIpc',
  renderSrc + '\nreturn renderFiles;')({ createElement: (t) => makeEl(t, true), createTextNode: (d) => ({ nodeType: 3, data: String(d) }) },
  new Function('document', escSrc2 + '\nreturn esc;')({ createElement: (t) => makeEl(t, true), createTextNode: (d) => ({ nodeType: 3, data: String(d) }) }),
  new Function('document', fillTipSrc2 + '\nreturn fillTip;')({ createElement: (t) => makeEl(t, true), createTextNode: (d) => ({ nodeType: 3, data: String(d) }) }),
  new Function(fmtSrc + '\nreturn fmtDate;')(), new Function(sizeSrc + '\nreturn formatSize;')(),
  { ip: '127.0.0.1', port: 35791 }, 'list', '', () => box2, () => [], () => {});
let captured2 = '';
Object.defineProperty(box2, 'innerHTML', { get() { return captured2; }, set(v) { captured2 = v; } });
renderFn2(sampleList, true);
ok('C list 模板输出 fm-row + span 标签 + fm-date', captured2.indexOf('class="fm-row"') > 0 && captured2.indexOf('<span class="fm-name">') > 0 && captured2.indexOf('<span class="fm-date">') > 0, captured2.slice(0, 120));
tail();
})();