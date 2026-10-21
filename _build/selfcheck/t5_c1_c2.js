const fs = require('fs');
const path = require('path');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const rendSrc = fs.readFileSync(path.join(APP, 'renderer.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n + (x ? '  | ' + x : '')); } else { fail++; console.log('FAIL  ' + n + (x ? '  | ' + x : '')); } };
function sliceBetween(src, a, b) {
  const i = src.indexOf(a); if (i < 0) throw new Error('miss-start: ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('miss-end: ' + b);
  return src.slice(i, j + b.length);
}
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function makeEl(tag) {
  const el = { tagName: String(tag || 'div').toUpperCase(), className: '', childNodes: [], _text: '' };
  Object.defineProperty(el, 'textContent', { configurable: true,
    get() { return el.childNodes.length ? el.childNodes.map((n) => (n.nodeType === 3 ? n.data : n.textContent)).join('') : el._text; },
    set(v) { el.childNodes.length = 0; el._text = v == null ? '' : String(v); } });
  Object.defineProperty(el, 'innerHTML', { configurable: true,
    get() { return escapeHtml(el._text); },
    set() { throw new Error('innerHTML was used'); } });
  el.appendChild = (n) => { n.parentNode = el; el.childNodes.push(n); return n; };
  return el;
}
const doc = { createElement: (t) => makeEl(t), createTextNode: (d) => ({ nodeType: 3, data: String(d), textContent: String(d) }) };
const srcFn = sliceBetween(rendSrc, 'function applyRemoteClipboard(p, fromPull) {', '\n}');
function build() {
  const preview = makeEl('div');
  const fn = new Function('document', '$', 'toast', 'esc', srcFn + '\nreturn applyRemoteClipboard;')(doc, () => preview, () => {}, (s) => String(s));
  return { preview, fn };
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const handlers = (el) => ['onerror', 'onload', 'onclick', 'onmouseover'].filter((k) => own(el, k));

const a = build();
let thrown = null;
try { a.fn({ type: 'image', mime: 'image/png" onerror="x', data: 'AAAA' }, false); } catch (e) { thrown = e; }
ok('C-1 恶意 mime 不再走 innerHTML', thrown === null, thrown ? thrown.message : 'no-throw');
ok('C-1 只生成 1 个元素（无外元素）', a.preview.childNodes.length === 1, 'children=' + a.preview.childNodes.length);
const img = a.preview.childNodes[0];
ok('C-1 生成的是 img 元素', !!img && img.tagName === 'IMG');
ok('C-1 元素上没有任何事件处理器', handlers(img).length === 0, 'handlers=' + JSON.stringify(handlers(img)));
ok('C-1 畸形 mime 回退为 image/png', img.src === 'data:image/png;base64,AAAA', img.src);
ok('C-1 src 里不存在裸双引号（无法咬断属性）', img.src.indexOf('"') < 0, img.src);

const b = build();
b.fn({ type: 'image', mime: 'image/jpeg', data: 'BBBB' }, false);
ok('C-1 正常 mime 行为不变', b.preview.childNodes[0].src === 'data:image/jpeg;base64,BBBB', b.preview.childNodes[0].src);
const c = build();
c.fn({ type: 'image', data: 'CCCC' }, false);
ok('C-1 缺省 mime 仍为 image/png', c.preview.childNodes[0].src === 'data:image/png;base64,CCCC');
const d = build();
d.fn({ type: 'image', mime: 'image/png', data: 'DDDD" onerror="y' }, false);
ok('C-1 恶意 data 也不产生处理器/外元素', d.preview.childNodes.length === 1 && handlers(d.preview.childNodes[0]).length === 0 && d.preview.childNodes[0].tagName === 'IMG');
ok('C-1 源码已无 innerHTML 拼接 mime', rendSrc.indexOf('alt="剪贴板图片">') < 0 && rendSrc.indexOf("img.src = 'data:' + mime") > 0);
ok('C-1 源码保留 mime 白名单', rendSrc.indexOf('/^image\\/[a-z0-9.+-]+$/i') > 0);
ok('C-1 缩略图回退监听器仍是可执行代码（未被压平成注释）', rendSrc.indexOf("$('#files-list').addEventListener('error'") > 0);
ok('C-1 源码没有超长压平行（<=400 字符）', rendSrc.split('\n').every((l) => l.length <= 400), 'maxLen=' + Math.max.apply(null, rendSrc.split('\n').map((l) => l.length)));
console.log('---- ' + pass + ' passed, ' + fail + ' failed ----');
process.exitCode = fail ? 1 : 0;