const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t2_main.js';
let s = fs.readFileSync(F, 'utf8');
const bad = "  'const pairGetToken = async () => ({ ok: true, token: '0123456789abcdef0123456789abcdef' });',";
const good = '  "const pairGetToken = async () => ({ ok: true, token: ' + String.fromCharCode(39) + '0123456789abcdef0123456789abcdef' + String.fromCharCode(39) + ' });",';
if (s.split(bad).length - 1 !== 1) { console.log('FAIL anchor matches=' + (s.split(bad).length - 1)); process.exit(1); }
s = s.replace(bad, () => good);
fs.writeFileSync(F, s);
console.log('fixed');