
const fs = require('fs');
const path = require('path');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const mainSrc = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
const rendSrc = fs.readFileSync(path.join(APP, 'renderer.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n + (x ? '  | ' + x : '')); } else { fail++; console.log('FAIL  ' + n + (x ? '  | ' + x : '')); } };
const done = () => { console.log('---- ' + pass + ' passed, ' + fail + ' failed ----'); process.exitCode = fail ? 1 : 0; };
function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error('anchor-miss-start: ' + a);
  const j = src.indexOf(b, i + a.length);
  if (j < 0) throw new Error('anchor-miss-end: ' + b);
  return src.slice(i, j + b.length);
}
const vm = require('vm');
function runSandbox(scriptText, sandbox) {
  const ctx = vm.createContext(Object.assign({ console, module: { exports: {} } }, sandbox));
  vm.runInContext(scriptText, ctx);
  return ctx.module.exports;
}

// ======================= A3 防回环 =======================
const locSrc = sliceBetween(mainSrc, 'function localClipSig() {', '\n}');
const remoteLine = mainSrc.match(/^ *const remoteSig = .*;$/m)[0].trim();
const condSrc = mainSrc.match(/\(remoteSig && remoteSig === echoGuard\)/)[0].slice(1, -1);
const crypto = require('crypto');

function localSigOf(text) {
  const clipboard = { readImage: () => ({ isEmpty: () => true }), readText: () => text };
  const fn = new Function('clipboard', 'crypto', 'Buffer', locSrc + '\nreturn localClipSig();');
  return fn(clipboard, crypto, Buffer);
}
function phoneSigOf(text) {            // HttpServer.java:213-215
  const raw = Buffer.from(text, 'utf8');
  const md5 = crypto.createHash('md5').update(raw).digest('hex');
  return 'txt:' + raw.length + ':' + md5.slice(0, 8);
}
function remoteSigOf(remote) {
  return new Function('remote', remoteLine + '\nreturn remoteSig;')(remote);
}
const echoHit = (r, g) => new Function('remoteSig', 'echoGuard', 'return (' + condSrc + ');')(r, g);

console.log('== A3 提取到的第670行取值表达式: ' + remoteLine);
console.log('== A3 提取到的比较表达式: ' + condSrc);
for (const text of ['hello', '\u4f60\u597d\uff0c\u6893\u5b89\u5de5\u5177\u7bb1']) {
  const local = localSigOf(text).sig;
  const phone = phoneSigOf(text);
  const oldRemote = 'txt:' + phone;                 // 修复前的拼接
  console.log('   text=' + JSON.stringify(text) + '  local=' + local + '  phone=' + phone);
  ok('A3 修复前 sig 不相等（回环失效）: ' + text.slice(0, 6), oldRemote !== local, 'oldRemote=' + oldRemote);
  ok('A3 修复后 sig 相等: ' + text.slice(0, 6), remoteSigOf({ type: 'text', sig: phone }) === local, 'remote=' + remoteSigOf({ type: 'text', sig: phone }));
  ok('A3 echoGuard 命中（不再回推）: ' + text.slice(0, 6), echoHit(remoteSigOf({ type: 'text', sig: phone }), local) === true);
}
const emptyRemote = remoteSigOf({ type: 'empty', sig: '' });
const intentRemote = remoteSigOf({ type: 'intent', data: '', sig: '' });
ok('A3 type=empty 不误判为回环', emptyRemote === '' && !echoHit(emptyRemote, ''), 'remoteSig=' + JSON.stringify(emptyRemote) + ' 判定结果=' + echoHit(emptyRemote, ''));
ok('A3 type=intent 不误判为回环', intentRemote === '' && !echoHit(intentRemote, localSigOf('x').sig), '判定结果=' + JSON.stringify(echoHit(intentRemote, localSigOf('x').sig)));
ok('A3 手机端新内容仍会写回（sig 不同则不同步标志为回环）', echoHit(phoneSigOf('other'), phoneSigOf('hello')) === false);

// ======================= A4 默认启动页 TDZ =======================
function oldShape() {
  const startBtn = { click() { initInterconnect(); } };
  startBtn.click();
  function initInterconnect() { if (!initedInter) { initedInter = true; } }
  let initedInter = false;
  return 'no-throw';
}
function newShape() {
  let initedInter = false;
  function initInterconnect() { if (!initedInter) { initedInter = true; } }
  const startBtn = { click() { initInterconnect(); } };
  startBtn.click();
  return 'no-throw';
}
let oldErr = null;
try { oldShape(); } catch (e) { oldErr = e; }
ok('A4 旧顺序复现 TDZ 报错', oldErr instanceof ReferenceError, String(oldErr && oldErr.message));
ok('A4 新顺序不报错', newShape() === 'no-throw');

const clickIdx = rendSrc.lastIndexOf('startBtn.click();');
const declIdx = rendSrc.indexOf('let initedInter');
const tail = rendSrc.slice(clickIdx + 'startBtn.click();'.length).trim();
ok('A4 真实文件：点击语句位于 let initedInter 之后', clickIdx > declIdx && declIdx > 0, 'click@' + clickIdx + ' decl@' + declIdx);
ok('A4 真实文件：点击语句是模块最后一条语句', tail === '', 'tail=' + JSON.stringify(tail.slice(0, 40)));
ok('A4 真实文件：原位置（loadScripts() 之后）已无点击语句',
  !/loadScripts\(\);\s*\n\/\/ 默认启动页/.test(rendSrc));

// ======================= A7 XSS =======================
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function makeEl(tag) {
  const el = { tagName: String(tag || 'div').toUpperCase(), className: '', childNodes: [], _text: '' };
  Object.defineProperty(el, 'textContent', {
    get() { return el.childNodes.length ? el.childNodes.map((n) => (n.nodeType === 3 ? n.data : n.textContent)).join('') : el._text; },
    set(v) { el.childNodes.length = 0; el._text = v == null ? '' : String(v); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return escapeHtml(el._text); },
    set() { throw new Error('innerHTML used'); }
  });
  el.appendChild = (n) => { n.parentNode = el; el.childNodes.push(n); return n; };
  return el;
}
const documentShim = { createElement: (t) => makeEl(t), createTextNode: (d) => ({ nodeType: 3, data: String(d), textContent: String(d) }) };
const escSrc = sliceBetween(rendSrc, 'function esc(s) {', '\n}');
const fillTipSrc = sliceBetween(rendSrc, 'function fillTip(tip, metaJson) {', '\n}');
const escFn = new Function('document', escSrc + '\nreturn esc;')(documentShim);
const fillTip = new Function('document', fillTipSrc + '\nreturn fillTip;')(documentShim);

ok('C-2 esc 转义单引号', escFn("o'brien").indexOf('&#39;') > 0 && escFn("o'brien").indexOf("'") < 0, escFn("o'brien"));
ok('C-2 esc 仍转义双引号/尖括号/与号', escFn('a"b<c>d&e') === 'a&quot;b&lt;c&gt;d&amp;e', escFn('a"b<c>d&e'));
const decodeAttr = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const buildMeta = (it) => escFn(JSON.stringify({ n: it.name, s: it.size, m: it.mtime, p: it.path }));
const evil = [
  { name: '<img src=x onerror=1>', size: '1 KB', mtime: 'today', path: '/sdcard/<img src=x onerror=1>' },
  { name: 'a" onmouseover="alert(1)', size: '2 KB', mtime: 'today', path: '/sdcard/a"b' },
  { name: "o'brien' onmouseover='alert(1)", size: '3 KB', mtime: 'today', path: "/sdcard/o'brien" }
];
for (const it of evil) {
  const metaStr = buildMeta(it);
  ok('A7 属性值不含 < > " (' + it.name.slice(0, 12) + ')', !/[<>"]/.test(metaStr));
  ok('A7 属性往返无损 (' + it.name.slice(0, 12) + ')', decodeAttr(metaStr) === JSON.stringify({ n: it.name, s: it.size, m: it.mtime, p: it.path }));
  const tip = makeEl('div');
  let threw = null;
  let ret = false;
  try { ret = fillTip(tip, decodeAttr(metaStr)); } catch (e) { threw = e; }
  ok('A7 fillTip 未使用 innerHTML (' + it.name.slice(0, 12) + ')', threw === null && ret === true, threw ? String(threw.message) : 'ok');
  const all = [];
  (function walk(n) { if (!n) return; if (n.tagName) all.push(n); (n.childNodes || []).forEach(walk); })(tip);
  const tags = all.map((n) => n.tagName);
  const nameNode = all.find((n) => n.className === 't-name');
  ok('A7 恶意文件名未生成元素节点 (' + it.name.slice(0, 12) + ')', tags.indexOf('IMG') < 0 && tags.indexOf('SCRIPT') < 0, 'tags=' + JSON.stringify(tags));
  ok('A7 恶意文件名以纯文本进入 DOM (' + it.name.slice(0, 12) + ')', !!nameNode && nameNode.textContent === it.name);
}
ok('A7 非法 meta 不再抛错而是隐藏浮层', fillTip(makeEl('div'), 'not-json') === false);
ok('A7 模板已无内联 onerror', rendSrc.indexOf('onerror=') < 0);
ok('A7 内联 onerror 改为 data-fb 事件委托', rendSrc.indexOf('img.dataset.fb') > 0 && rendSrc.indexOf("addEventListener('error'") > 0);
ok('A7 已无 tip.innerHTML 注入点', rendSrc.indexOf('tip.innerHTML') < 0);
done();
