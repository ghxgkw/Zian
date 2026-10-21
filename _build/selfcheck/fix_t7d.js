const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t7_a1.js';
let s = fs.readFileSync(F, 'utf8');
const marker = "await new Promise((r) => srv.close(r));";
if (s.split(marker).length - 1 !== 1) { console.log('FAIL marker'); process.exit(1); }
const add = "ok('A1 main.js/preload.js 没有超长压平行', [mainSrc, preloadSrc].every((x) => x.split('\\n').every((l) => l.length <= 400)));";
s = s.replace(marker, () => add + '\n' + marker);
fs.writeFileSync(F, s);
console.log('t7 guard added');