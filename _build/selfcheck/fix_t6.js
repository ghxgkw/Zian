const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t6_a5.js';
let s = fs.readFileSync(F, 'utf8');
const marker = "const txt = api.gappsDisableConfirm(PKGS);";
if (s.split(marker).length - 1 !== 1) { console.log('FAIL'); process.exit(1); }
s = s.replace(marker, '(async function main() {\n' + marker);
s = s + '\n})();\n';
fs.writeFileSync(F, s);
console.log('wrapped in async IIFE');