const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/main.js';
const b = fs.readFileSync(F, 'utf8');
const n = b.replace(/\r\n/g, '\n');
fs.writeFileSync(F, n);
console.log('normalized: bytes ' + b.length + ' -> ' + n.length + ', CR now=' + (n.match(/\r/g) || []).length);