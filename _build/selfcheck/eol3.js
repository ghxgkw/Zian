const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/main.js';
const b = fs.readFileSync(F, 'utf8');
const crlf = b.split('\n').join('\r\n');
fs.writeFileSync(F, crlf);
console.log('restored CRLF, bytes=' + crlf.length);