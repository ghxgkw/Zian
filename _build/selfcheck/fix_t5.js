const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t5_c1_c2.js';
let s = fs.readFileSync(F, 'utf8');
const marker = "console.log('---- ' + pass + ' passed, ' + fail + ' failed ----');";
if (s.split(marker).length - 1 !== 1) { console.log('FAIL marker'); process.exit(1); }
const add = ["ok('C-1 缩略图回退监听器仍是可执行代码（未被压平成注释）', rendSrc.indexOf(\"$('#files-list').addEventListener('error'\") > 0);","ok('C-1 源码没有超长压平行（<=400 字符）', rendSrc.split('\\n').every((l) => l.length <= 400), 'maxLen=' + Math.max.apply(null, rendSrc.split('\\n').map((l) => l.length)));"];
s = s.replace(marker, () => add.join('\n') + '\n' + marker);
fs.writeFileSync(F, s);
console.log('t5 assertions added');