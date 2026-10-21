const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t3_c_misc.js';
let s = fs.readFileSync(F, 'utf8');
const a = "sliceBetween(mainSrc, 'function pushClipToPhone(ip, port, payload) {', '\\n}')";
const b = "sliceBetween(mainSrc, 'function pushClipToPhone(ip, port, payload, token) {', '\\n}')";
if (s.split(a).length - 1 !== 1) { console.log('FAIL matches=' + (s.split(a).length - 1)); process.exit(1); }
s = s.replace(a, () => b);
fs.writeFileSync(F, s);
console.log('patched t3 anchor');