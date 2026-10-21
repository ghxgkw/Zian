const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t7_a1.js';
let s = fs.readFileSync(F, 'utf8');
function rep(name, a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.log('FAIL ' + name + ' matches=' + n); process.exitCode = 1; return; }
  s = s.replace(a, () => b); console.log('OK   ' + name);
}
rep('server-clipboard',
  "  if (req.url.indexOf('/secured') === 0) {",
  "  if (req.url.indexOf('/clipboard') === 0) { seenToken = tok; if (tok !== GOOD) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, err: 'unauthorized' })); return; } res.statusCode = 200; res.end(JSON.stringify({ ok: true })); return; }\n  if (req.url.indexOf('/secured') === 0) {");
rep('probe-assert',
  "ok('A1 probeToken 只取状态码（不下载正文）', netSrc.indexOf(\"path: '/clipboard'\") === 0 && probeTokenSrc.indexOf('r.destroy()') > 0);",
  "ok('A1 probeToken 只取状态码（不下载正文）', probeTokenSrc.indexOf(\"path: '/clipboard'\") > 0 && probeTokenSrc.indexOf('r.destroy()') > 0);");
rep('header-args',
  "const headerBuf = new Function('tokenOf', 'remoteDir', 'name', 'stat', 'Buffer', headerLine.replace('const header = ', 'return ') + '')(() => GOOD, '/sdcard', 'a+b.txt', { size: 42 }, Buffer);",
  "const headerBuf = new Function('tokenOf', 'link', 'remoteDir', 'name', 'stat', 'Buffer', headerLine.replace('const header = ', 'return ') + '')(() => GOOD, {}, '/sdcard', 'a+b.txt', { size: 42 }, Buffer);");
fs.writeFileSync(F, s);