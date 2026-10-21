const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/renderer.js';
let raw = fs.readFileSync(F, 'utf8');
const lines = raw.split('\n');

// ---- 1) esc() 也转义单引号 ----
const eIdx = lines.findIndex((l) => l.startsWith('function esc(s) {'));
if (eIdx < 0) throw new Error('esc-not-found');
lines.splice(eIdx, 1,
  '// 属性/文本转义：DOM 序列化只会处理 & < >，引号（含单引号）需自己转，否则单引号属性会被咬断',
  'function esc(s) {',
  '  const d = document.createElement(\'div\');',
  '  d.textContent = s == null ? \'\' : String(s);',
  '  return d.innerHTML.replace(/\"/g, \'&quot;\').replace(/\'/g, \'&#39;\');',
  '}'
);

// ---- 2) 剪贴板图片改为 DOM 赋值（不再 innerHTML 拼 mime） ----
const sIdx = lines.findIndex((l) => l === '  } else if (p.type === \'image\') {');
if (sIdx < 0) throw new Error('image-branch-not-found');
let tIdx = -1;
for (let k = sIdx + 1; k < lines.length; k++) {
  if (lines[k].startsWith('    if (fromPull) toast(')) { tIdx = k; break; }
}
if (tIdx < 0) throw new Error('toast-line-not-found');
const body = [
  '    // mime 来自手机端，不可信：拼进 innerHTML 能注入属性/事件处理器，这里改为 DOM 赋值。',
  '    // 畸形 mime 统一按 png 处理（原本也只会得到一张坏图）',
  '    const mime = /^image\\/[a-z0-9.+-]+$/i.test(p.mime || \'\') ? p.mime : \'image/png\';',
  '    const img = document.createElement(\'img\');',
  '    img.alt = \'剪贴板图片\';',
  '    img.src = \'data:\' + mime + \';base64,\' + (p.data || \'\');',
  '    prev.textContent = \'\';',
  '    prev.appendChild(img);'
];
lines.splice(sIdx + 1, tIdx - sIdx - 1, ...body);

fs.writeFileSync(F, lines.join('\n'));
console.log('patched: esc=' + eIdx + ', imageBranch=' + sIdx + ', replacedLines=' + (tIdx - sIdx - 1));