const fs = require('fs');
const path = require('path');
const vm = require('vm');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const rendSrc = fs.readFileSync(path.join(APP, 'renderer.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n + (x ? '  | ' + x : '')); } else { fail++; console.log('FAIL  ' + n + (x ? '  | ' + x : '')); } };
function sliceBetween(src, a, b) {
  const i = src.indexOf(a); if (i < 0) throw new Error('miss-start: ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('miss-end: ' + b);
  return src.slice(i, j + b.length);
}
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function makeEl(tag) {
  const el = { tagName: String(tag || 'div').toUpperCase(), className: '', childNodes: [], _text: '', dataset: {} };
  Object.defineProperty(el, 'textContent', { configurable: true, get() { return el._text; }, set(v) { el.childNodes.length = 0; el._text = v == null ? '' : String(v); } });
  Object.defineProperty(el, 'innerHTML', { configurable: true, get() { return escapeHtml(el._text); }, set(v) { el._text = v == null ? '' : String(v); } });
  el.appendChild = (n) => { n.parentNode = el; el.childNodes.push(n); return n; };
  return el;
}
const escSrc = sliceBetween(rendSrc, 'function esc(s) {', '\n}');
const fillTipSrc = sliceBetween(rendSrc, 'function fillTip(tip, metaJson) {', '\n}');
const fmtSrc = sliceBetween(rendSrc, 'function fmtDate(ts, withTime = false) {', '\n}');
const sizeSrc = sliceBetween(rendSrc, 'function formatSize(bytes) {', '\n}');
const renderSrc = sliceBetween(rendSrc, 'function renderFiles(list, groupByDate) {', '\n}');
const loaderSrc = sliceBetween(rendSrc, 'async function loadThumbsViaIpc() {', '\n}');
const docShim = { createElement: (t) => makeEl(t), createTextNode: (d) => ({ nodeType: 3, data: String(d), textContent: String(d) }) };
const escFn = new Function('document', escSrc + '\nreturn esc;')(docShim);
const fillTipFn = new Function('document', fillTipSrc + '\nreturn fillTip;')(docShim);
const fmtFn = new Function(fmtSrc + '\nreturn fmtDate;')();
const sizeFn = new Function(sizeSrc + '\nreturn formatSize;')();

(async function main() {
// ================== A. 缩略图：paired 直接走 IPC，unpaired 走直连 ==================
function buildRender(link) {
  const box = makeEl('div');
  let captured = '';
  Object.defineProperty(box, 'innerHTML', { configurable: true, get() { return captured; }, set(v) { captured = v; } });
  const fn = new Function('document', 'esc', 'fillTip', 'fmtDate', 'formatSize', 'currentLink', 'fmView', 'fmSearchText', '$', '$$', 'loadThumbsViaIpc',
    renderSrc + '\nreturn renderFiles;')(docShim, escFn, fillTipFn, fmtFn, sizeFn, link, 'grid', '', () => box, () => [], () => {});
  return { fn, get: () => captured };
}
const IMG = [{ name: 'a.jpg', path: '/sdcard/a.jpg', size: 2048, modified: 1700000000, dir: false }];
const pairedRender = buildRender({ ip: '127.0.0.1', port: 35791, paired: true });
pairedRender.fn(IMG, true);
const pairedHtml = pairedRender.get();
ok('A1-paired 已配对设备不产生直连 <img src>', pairedHtml.indexOf('http://') < 0, pairedHtml.slice(0, 120));
ok('A1-paired 直接标记 data-ipc 走代理', pairedHtml.indexOf('data-ipc="1"') > 0 && pairedHtml.indexOf('data-path="/sdcard/a.jpg"') > 0);
const unpairedRender = buildRender({ ip: '127.0.0.1', port: 35791, paired: false });
unpairedRender.fn(IMG, true);
const unpairedHtml = unpairedRender.get();
ok('A1-unpaired 未配对仍走直连 thumb URL', unpairedHtml.indexOf('src="http://127.0.0.1:35791/thumb?path=') > 0, unpairedHtml.slice(0, 140));
ok('A1-unpaired 不带 data-ipc', unpairedHtml.indexOf('data-ipc') < 0);

function buildLoader(link, imgs, api) {
  const document = { querySelectorAll: () => imgs };
  const fn = new Function('document', 'currentLink', 'api', loaderSrc + '\nreturn loadThumbsViaIpc;')(document, link, api);
  return fn;
}
function fakeImg(p, fb) { const el = makeEl('img'); el.dataset.path = p; el.dataset.fb = fb; el.src = ''; el.parentNode = makeEl('div'); return el; }
const calls = [];
const imgA = fakeImg('/sdcard/a.jpg', '🖼️');
const imgB = fakeImg('/sdcard/b.jpg', '🖼️');
const apiStub = { filesThumb: async (link, p) => { calls.push(p); return { ok: true, dataUrl: 'data:image/jpeg;base64,' + p.length }; } };
await buildLoader({ ip: '127.0.0.1', port: 35791, paired: true }, [imgA, imgB], apiStub)();
ok('A1-paired 每张图只发 1 次 IPC（共 2 次）', calls.length === 2 && calls[0] === '/sdcard/a.jpg' && calls[1] === '/sdcard/b.jpg', JSON.stringify(calls));
ok('A1-paired IPC 结果写回 img.src', imgA.src.indexOf('data:image/jpeg;base64,') === 0 && imgB.src.indexOf('data:image/jpeg;base64,') === 0);
const calls2 = [];
await buildLoader({ ip: '127.0.0.1', port: 35791, paired: false }, [fakeImg('/x.jpg', '🖼️')], { filesThumb: async () => { calls2.push(1); return { ok: true }; } })();
ok('A1-unpaired 不发 IPC（继续直连）', calls2.length === 0);
const imgFail = fakeImg('/bad.jpg', '📦');
await buildLoader({ ip: '127.0.0.1', port: 35791, paired: true }, [imgFail], { filesThumb: async () => ({ ok: false, msg: '401' }) })();
ok('A1 代理失败退回图标', imgFail.parentNode.textContent === '📦');
ok('A1 渲染层仍有直连失败兜底监听（unpaired 场景）', rendSrc.indexOf("addEventListener('error'") > 0);

// ================== B. 内联脚本名输入（替换 prompt） ==================
ok('B 渲染层已无 prompt() 依赖', rendSrc.indexOf('prompt(') < 0, 'remaining=' + (rendSrc.match(/prompt\(/g) || []).length);
ok('B index.html 有内联输入行', ['script-name-row', 'script-name-input', 'btn-script-name-ok', 'btn-script-name-cancel', 'script-name-hint'].every((k) => htmlSrc.indexOf(k) > 0));
const askSrc = sliceBetween(rendSrc, 'function askScriptName(title) {', '\n}');
const closeSrc = sliceBetween(rendSrc, 'function closeScriptName(value) {', '\n}');
const initSrc = sliceBetween(rendSrc, 'function initScriptNameBar() {', '\n}');
const newArrow = sliceBetween(rendSrc, "$('#btn-script-new').onclick = async () => {", '\n};').replace("$('#btn-script-new').onclick = ", '').replace(/;$/, '');
const runArrow = sliceBetween(rendSrc, "$('#btn-script-run').onclick = async () => {", '\n};').replace("$('#btn-script-run').onclick = ", '').replace(/;$/, '');
function buildScripts() {
  const els = {};
  const mk = (id) => { els[id] = { id, value: '', textContent: '', style: { display: 'none' }, onclick: null, handlers: {}, focus() {}, addEventListener(ch, fn) { els[id].handlers[ch] = fn; } }; return els[id]; };
  ['script-name-row', 'script-name-input', 'script-name-hint', 'btn-script-name-ok', 'btn-script-name-cancel', 'script-editor', 'script-name-tag'].forEach(mk);
  const saves = []; const runs = []; const toasts = [];
  const sandbox = {
    console, module: { exports: {} }, Promise, JSON, String, Object, Array,
    els, saves, runs, toasts,
    $: (sel) => els[sel.replace('#', '')] || mk(sel.replace('#', '')),
    api: { scriptSave: async (n, c) => { saves.push([n, c]); return { ok: true, msg: n + ' 已保存' }; }, scriptList: async () => [] },
    loadScripts: async () => {},
    selectScript: (n) => runs.push(['select', n]),
    runScript: async (n, c) => { runs.push(['run', n, c]); },
    toast: (m) => toasts.push(m),
    let_curScript: null
  };
  const text = [
    'let curScript = null;',
    askSrc, closeSrc, initSrc,
    'initScriptNameBar();',
    'const newHandler = ' + newArrow + ';',
    'const runHandler = ' + runArrow + ';',
    'module.exports = { newHandler, runHandler, els, saves, runs, toasts, setCur: (v) => { curScript = v; } };'
  ].join('\n');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(text, ctx);
  return ctx.module.exports;
}
const s1 = buildScripts();
const pending = s1.newHandler();
ok('B 新建：打开输入行并聚焦', s1.els['script-name-row'].style.display === 'flex');
s1.els['script-name-input'].value = '  my_script  ';
s1.els['script-name-input'].handlers.keydown({ key: 'Enter', preventDefault() {} });
await pending;
ok('B 新建：回车提交后调用 script:save（自动补 .bat、去空格）', s1.saves.length === 1 && s1.saves[0][0] === 'my_script.bat' && s1.saves[0][1].indexOf('# 新脚本') === 0, JSON.stringify(s1.saves));
ok('B 新建：提交后收起输入行', s1.els['script-name-row'].style.display === 'none');
const s2 = buildScripts();
const pending2 = s2.newHandler();
s2.els['script-name-input'].value = 'discarded';
s2.els['script-name-input'].handlers.keydown({ key: 'Escape', preventDefault() {} });
await pending2;
ok('B 新建：Esc 取消不调用 script:save', s2.saves.length === 0 && s2.els['script-name-row'].style.display === 'none');
const s3 = buildScripts();
const pending3 = s3.newHandler();
s3.els['script-name-input'].value = '   ';
s3.els['script-name-input'].handlers.keydown({ key: 'Enter', preventDefault() {} });
await new Promise((r) => setTimeout(r, 10));
ok('B 空名字被拦住并提示', s3.saves.length === 0 && s3.els['script-name-hint'].textContent === '脚本名不能为空' && s3.els['script-name-row'].style.display === 'flex');
s3.els['btn-script-name-cancel'].onclick();
await pending3;
ok('B 点取消同样不调用 script:save', s3.saves.length === 0 && s3.els['script-name-row'].style.display === 'none');
const s4 = buildScripts();
s4.els['script-editor'].value = 'shell ls';
const pending4 = s4.runHandler();
s4.els['script-name-input'].value = 'runme';
s4.els['script-name-input'].handlers.keydown({ key: 'Enter', preventDefault() {} });
await pending4;
ok('B 保存并运行：无当前脚本时先问名字再保存', s4.saves.length === 1 && s4.saves[0][0] === 'runme.bat' && s4.saves[0][1] === 'shell ls', JSON.stringify(s4.saves));
ok('B 保存并运行：保存后确实执行脚本', s4.runs.length === 1 && s4.runs[0][0] === 'run' && s4.runs[0][1] === 'runme.bat');
const s5 = buildScripts();
s5.setCur('old.bat');
s5.els['script-editor'].value = 'shell id';
await s5.runHandler();
ok('B 已有当前脚本时不再弹输入', s5.saves.length === 1 && s5.saves[0][0] === 'old.bat' && s5.els['script-name-row'].style.display === 'none');

console.log('---- ' + pass + ' passed, ' + fail + ' failed ----');
process.exitCode = fail ? 1 : 0;
})();