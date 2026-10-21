const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t2_main.js';
let s = fs.readFileSync(F, 'utf8');
const oldBlock = [
  '  ' + String.fromCharCode(34) + 'const startUsbWatch = () => {};' + String.fromCharCode(34) + ',',
].join('');
// 在 startUsbWatch 之后注入 A1 需要的真实辅助函数与 /pair 桩
const anchor = '  ' + "'const startUsbWatch = () => {};',";
if (s.split(anchor).length - 1 !== 1) { console.log('FAIL anchor'); process.exit(1); }
const inject = [
  '  ' + "'const log = () => {};',",
  '  ' + "'const pairGetToken = async () => ({ ok: true, token: \'0123456789abcdef0123456789abcdef\' });',",
  '  ' + 'tokenOfSrc,',
  '  ' + 'publicLinkSrc,',
  '  ' + 'attachCachedTokenSrc,',
].join('\n');
s = s.replace(anchor, anchor + '\n' + inject);
// 在 pinUsbLine 之前提取三个辅助函数源码
const pre = 'const pinUsbLine = mainSrc.match(/^const pinUsb = .*$/m)[0];';
if (s.split(pre).length - 1 !== 1) { console.log('FAIL pre'); process.exit(1); }
s = s.replace(pre, [
  pre,
  "const tokenOfSrc = sliceBetween(mainSrc, 'function tokenOf(link) {', '\\n}');",
  "const publicLinkSrc = sliceBetween(mainSrc, 'function publicLink(link) {', '\\n}');",
  "const attachCachedTokenSrc = sliceBetween(mainSrc, 'function attachCachedToken(link) {', '\\n}');",
].join('\n'));
fs.writeFileSync(F, s);
console.log('t2 patched');