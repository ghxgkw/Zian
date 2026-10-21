const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t7_a1.js';
let s = fs.readFileSync(F, 'utf8');
const a = "  'module.exports = { pairGetToken, probeToken };'].join('\\n'), { http });";
const b = "  'module.exports = { pairGetToken, probeToken };'].join('\\n'), { http, authHeaders: net.authHeaders });";
if (s.split(a).length - 1 !== 1) { console.log('FAIL anchor matches=' + (s.split(a).length - 1)); process.exit(1); }
s = s.replace(a, () => b);
fs.writeFileSync(F, s);
console.log('patched');