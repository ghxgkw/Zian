const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t7_a1.js';
let s = fs.readFileSync(F, 'utf8');
const a = "ok('A1 401 分支覆盖各调用点（>=6 处）', (mainSrc.match(/isUnauthorized\\(/g) || []).length >= 6, 'count=' + (mainSrc.match(/isUnauthorized\\(/g) || []).length);";
const b = "const guards = (mainSrc.match(/isUnauthorized\\(/g) || []).length + (mainSrc.match(/statusCode === 401/g) || []).length;\nok('A1 401 分支覆盖各调用点（>=7 处：4 处 JSON + 3 处流式/POST）', guards >= 7, 'guards=' + guards);";
if (s.split(a).length - 1 !== 1) { console.log('FAIL anchor matches=' + (s.split(a).length - 1)); process.exit(1); }
s = s.replace(a, () => b);
fs.writeFileSync(F, s);
console.log('patched');