const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t8_thumb_scripts.js';
let s = fs.readFileSync(F, 'utf8');
const a = '    console, module: { exports: {} }, Promise, JSON, String, Object, Array,';
const b = a + '\n    els, saves, runs, toasts,';
if (s.split(a).length - 1 !== 1) { console.log('FAIL anchor'); process.exit(1); }
s = s.replace(a, () => b);
fs.writeFileSync(F, s);
console.log('patched sandbox globals');