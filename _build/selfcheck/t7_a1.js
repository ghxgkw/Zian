const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const mainSrc = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
const netSrc = fs.readFileSync(path.join(APP, 'lib/net.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(APP, 'preload.js'), 'utf8');
const rendSrc = fs.readFileSync(path.join(APP, 'renderer.js'), 'utf8');
const net = require(path.join(APP, 'lib/net.js'));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n + (x ? '  | ' + x : '')); } else { fail++; console.log('FAIL  ' + n + (x ? '  | ' + x : '')); } };
function sliceBetween(src, a, b) {
  const i = src.indexOf(a); if (i < 0) throw new Error('miss-start: ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('miss-end: ' + b);
  return src.slice(i, j + b.length);
}
function runSandbox(text, sandbox) {
  const ctx = vm.createContext(Object.assign({ console, module: { exports: {} }, JSON, Object, Array, String, Number, Boolean, Promise, Buffer, Set, Date, require }, sandbox));
  vm.runInContext(text, ctx);
  return ctx.module.exports;
}
const GOOD = '0123456789abcdef0123456789abcdef';
const TOKEN_RE_LINE = mainSrc.match(/^const TOKEN_RE = .*$/m)[0];

(async function main() {
// ---------- net.js 单元 ----------
ok('A1 authHeaders 带令牌', JSON.stringify(net.authHeaders(GOOD)) === JSON.stringify({ 'X-Zian-Token': GOOD }));
ok('A1 authHeaders 无令牌时不加头', JSON.stringify(net.authHeaders('')) === '{}');
ok('A1 isUnauthorized 识别哨兵', net.isUnauthorized(net.UNAUTHORIZED) === true && net.isUnauthorized(null) === false && net.isUnauthorized({ ok: true }) === false);
ok('A1 net 仍只导出 3 个网络函数 + 3 个鉴权辅助', JSON.stringify(Object.keys(net).sort()) === JSON.stringify(['UNAUTHORIZED', 'authHeaders', 'httpGetJson', 'isUnauthorized', 'lanScan', 'pingDevice']));

// ---------- 本地服务器：401 不重试 / 头透传 ----------
let hits401 = 0, seenToken = null, hitOk = 0;
let pairMode = 'ok';
const srv = http.createServer((req, res) => {
  const tok = req.headers['x-zian-token'];
  if (req.url.indexOf('/pair') === 0) {
    if (pairMode === 'forbidden') { res.statusCode = 403; res.end(JSON.stringify({ ok: false, err: 'pair requires local connection' })); return; }
    if (pairMode === 'badtoken') { res.statusCode = 200; res.end(JSON.stringify({ ok: true, token: 'XYZ' })); return; }
    res.statusCode = 200; res.end(JSON.stringify({ ok: true, token: GOOD })); return;
  }
  if (req.url.indexOf('/always401') === 0) { hits401++; res.statusCode = 401; res.end(JSON.stringify({ ok: false, err: 'unauthorized' })); return; }
  if (req.url.indexOf('/clipboard') === 0) { seenToken = tok; if (tok !== GOOD) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, err: 'unauthorized' })); return; } res.statusCode = 200; res.end(JSON.stringify({ ok: true })); return; }
  if (req.url.indexOf('/secured') === 0) {
    seenToken = tok;
    if (tok !== GOOD) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, err: 'unauthorized' })); return; }
    hitOk++; res.statusCode = 200; res.end(JSON.stringify({ type: 'text', sig: 'txt:1:x', ok: true })); return;
  }
  res.statusCode = 200; res.end('{}');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const r401 = await net.httpGetJson('127.0.0.1', port, '/always401', 3000, 3, GOOD);
ok('A1 401 返回哨兵而不是 null', net.isUnauthorized(r401) === true);
ok('A1 401 不重试（只打了 1 次）', hits401 === 1, 'hits=' + hits401);
const rok = await net.httpGetJson('127.0.0.1', port, '/secured', 3000, 1, GOOD);
ok('A1 令牌随请求头送达', seenToken === GOOD && rok && rok.ok === true, 'seen=' + seenToken);
const rbad = await net.httpGetJson('127.0.0.1', port, '/secured', 3000, 1, '');
ok('A1 无令牌被 401 拦下', net.isUnauthorized(rbad) === true && hitOk === 1);

// ---------- main.js 提取的真实 /pair 与探测函数 ----------
const pairGetTokenSrc = sliceBetween(mainSrc, 'function pairGetToken(ip, port) {', '\n}');
const probeTokenSrc = sliceBetween(mainSrc, 'function probeToken(ip, port, token) {', '\n}');
const pairApi = runSandbox([TOKEN_RE_LINE, probeTokenSrc, pairGetTokenSrc,
  'module.exports = { pairGetToken, probeToken };'].join('\n'), { http, authHeaders: net.authHeaders });
pairMode = 'ok';
const p1 = await pairApi.pairGetToken('127.0.0.1', port);
ok('A1 /pair 200 + 合法令牌 → 取到令牌', p1.ok === true && p1.token === GOOD, JSON.stringify(p1));
pairMode = 'badtoken';
const p2 = await pairApi.pairGetToken('127.0.0.1', port);
ok('A1 /pair 返回非法令牌 → 拒绝', p2.ok === false, JSON.stringify(p2));
pairMode = 'forbidden';
const p3 = await pairApi.pairGetToken('127.0.0.1', port);
ok('A1 /pair 403 → 判定为局域网需人工配对', p3.ok === false && String(p3.msg).indexOf('local') >= 0, JSON.stringify(p3));
ok('A1 probeToken 令牌正确 → ok', (await pairApi.probeToken('127.0.0.1', port, GOOD)) === 'ok');
ok('A1 probeToken 令牌错误 → bad（401）', (await pairApi.probeToken('127.0.0.1', port, 'ffffffffffffffffffffffffffffffff')) === 'bad');
ok('A1 probeToken 只取状态码（不下载正文）', probeTokenSrc.indexOf("path: '/clipboard'") > 0 && probeTokenSrc.indexOf('r.destroy()') > 0);

// ---------- tokenOf / publicLink / attachCachedToken ----------
const helperSandbox = [
  'let currentLink = { ip: "10.0.0.5", port: 35791, token: "" };',
  'let cache = [{ ip: "10.0.0.9", port: 35791, token: ' + JSON.stringify(GOOD) + ' }, { ip: "10.0.0.8", port: 35791 }];',
  'function loadLinksCache() { return cache.slice(); }',
  sliceBetween(mainSrc, 'function tokenOf(link) {', '\n}'),
  sliceBetween(mainSrc, 'function publicLink(link) {', '\n}'),
  sliceBetween(mainSrc, 'function attachCachedToken(link) {', '\n}'),
  'module.exports = { tokenOf, publicLink, attachCachedToken, setLink: (l) => { currentLink = l; }, cache: () => cache };'
].join('\n');
const help = runSandbox(helperSandbox, {});
ok('A1 tokenOf 优先用 link 自带令牌', help.tokenOf({ token: 'AAA' }) === 'AAA');
help.setLink({ ip: '10.0.0.5', port: 35791, token: GOOD });
ok('A1 tokenOf 回退当前连接令牌', help.tokenOf({}) === GOOD && help.tokenOf(null) === GOOD);
const pub = help.publicLink({ ip: '10.0.0.5', token: GOOD, name: 'P' });
ok('A1 publicLink 剥离令牌并标记已配对', JSON.stringify(pub) === JSON.stringify({ ip: '10.0.0.5', name: 'P', paired: true }), JSON.stringify(pub));
ok('A1 publicLink 未配对设备 paired=false', help.publicLink({ ip: '1.1.1.1' }).paired === false);
const filled = help.attachCachedToken({ ip: '10.0.0.9', port: 35791 });
ok('A1 旧缓存（有 token）能补到新对象', filled.token === GOOD && filled.paired === true);
const unfilled = help.attachCachedToken({ ip: '10.0.0.8', port: 35791 });
ok('A1 旧缓存无 token → 视为未配对', unfilled.token === undefined && unfilled.paired === false);

// ---------- 35792 上传首行加令牌 ----------
const headerLine = mainSrc.match(/const header = Buffer\.from\(tokenOf\(link\)[^;]+;/)[0];
const headerBuf = new Function('tokenOf', 'link', 'remoteDir', 'name', 'stat', 'Buffer', headerLine.replace('const header = ', 'return ') + '')(() => GOOD, {}, '/sdcard', 'a+b.txt', { size: 42 }, Buffer);
ok('A1 35792 首行为 <token>\\n<dir>\\n<name>\\n<len>\\n', headerBuf.toString('utf8') === GOOD + '\n/sdcard\na+b.txt\n42\n', JSON.stringify(headerBuf.toString('utf8')));
ok('A1 旧的无令牌首行已不存在', mainSrc.indexOf("Buffer.from(remoteDir + '") < 0);

// ---------- net:pair handler ----------
const pairBlock = sliceBetween(mainSrc, "ipcMain.handle('net:pair', async (_e, link, code) => {", '\n});');
const pairArrow = pairBlock.replace(/^ipcMain\.handle\('net:pair', /, '').replace(/\);$/, '');
const pairSandbox = [
  TOKEN_RE_LINE,
  'let currentLink = { ip: "10.0.0.5", port: 35791, token: "" };',
  'let cache = [];',
  'let probeResult = "ok";',
  'const probeToken = async () => probeResult;',
  'const endpointOf = (link, cur) => { const l = link || cur; return l && l.ip ? { ip: l.ip, port: l.port || 35791 } : null; };',
  'let clipAuthFailed = true;',
  'function loadLinksCache() { return cache.slice(); }',
  'function saveLinksCache(a) { cache = a.slice(); }',
  'const logs = []; function log() { logs.push(Array.prototype.slice.call(arguments).join(" ")); }',
  'const handler = ' + pairArrow + ';',
  'module.exports = { call: (l, c) => handler(null, l, c), link: () => currentLink, cache: () => cache, logs, setProbe: (v) => { probeResult = v; }, authFailed: () => clipAuthFailed };'
].join('\n');
const pair = runSandbox(pairSandbox, {});
const rFmt = await pair.call(null, 'NOTHEX');
ok('A1 配对码格式不对被拒', rFmt.ok === false && rFmt.msg.indexOf('格式') >= 0, rFmt.msg);
pair.setProbe('bad');
const rBad = await pair.call(null, GOOD);
ok('A1 配对码不正确被拒且不落盘', rBad.ok === false && rBad.msg.indexOf('不正确') >= 0 && pair.cache().length === 0, rBad.msg);
pair.setProbe('timeout');
const rTo = await pair.call(null, GOOD);
ok('A1 无法校验时明确报错', rTo.ok === false && rTo.msg.indexOf('无响应') >= 0, rTo.msg);
pair.setProbe('ok');
const rOk = await pair.call({ ip: '10.0.0.5', port: 35791, name: 'Phone' }, GOOD.toUpperCase());
ok('A1 配对成功：令牌写入当前连接并标记已配对', rOk.ok === true && pair.link().token === GOOD && pair.link().paired === true, JSON.stringify(rOk));
ok('A1 配对成功：令牌写入 links.json 缓存', pair.cache().length === 1 && pair.cache()[0].token === GOOD && pair.cache()[0].paired === undefined, JSON.stringify(pair.cache()));
ok('A1 配对成功会解除 401 锁', pair.authFailed() === false);

// ---------- 源码级：受保护端点都带令牌 + 401 不静默 ----------
ok('A1 受保护调用点都传令牌（>=8 处）', (mainSrc.match(/tokenOf\(/g) || []).length >= 8, 'count=' + (mainSrc.match(/tokenOf\(/g) || []).length);
const guards = (mainSrc.match(/isUnauthorized\(/g) || []).length + (mainSrc.match(/statusCode === 401/g) || []).length;
ok('A1 401 分支覆盖各调用点（>=7 处：4 处 JSON + 3 处流式/POST）', guards >= 7, 'guards=' + guards);
ok('A1 剪贴板心跳 401 后停止拉取', mainSrc.indexOf('if (clipAuthFailed) return;') > 0);
ok('A1 401 会向渲染层广播 net:unauthorized', mainSrc.indexOf("notifyLink('net:unauthorized'") > 0);
ok('A1 preload 暴露配对/缩略图/401 事件', ['netPair', 'filesThumb', 'onNetUnauthorized', 'gappsRestore'].every((k) => preloadSrc.indexOf(k + ':') >= 0));
ok('A1 渲染层有配对入口与 401 提示', rendSrc.indexOf('pairWithCode') > 0 && rendSrc.indexOf('onNetUnauthorized') > 0 && rendSrc.indexOf('ic-pair-row') > 0);
ok('A1 links.json 旧数据（无 token）仍可读', mainSrc.indexOf('links.json') > 0 && helperSandbox.indexOf('paired') > 0);
ok('A1 端口/多播/协议串未改', netSrc.indexOf('35791') > 0 && netSrc.indexOf("'239.0.0.1'") > 0 && mainSrc.indexOf('tcp:35792') > 0);
ok('A1 main.js/preload.js 没有超长压平行', [mainSrc, preloadSrc].every((x) => x.split('\n').every((l) => l.length <= 400)));
await new Promise((r) => srv.close(r));
console.log('---- ' + pass + ' passed, ' + fail + ' failed ----');
process.exitCode = fail ? 1 : 0;
})();