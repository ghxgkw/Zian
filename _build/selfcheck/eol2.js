const fs = require('fs');
const files = ['main.js','renderer.js','preload.js','index.html','lib/util.js','lib/net.js'];
for (const f of files) {
  const b = fs.readFileSync('D:/tool/梓安搞机工具箱-win32-x64/_backup/2026-10-22-full/unpacked/' + f, 'utf8');
  console.log('backup ' + f.padEnd(12), 'CRLF=' + (b.match(/\r\n/g) || []).length, 'bareCR=' + ((b.match(/\r/g) || []).length - (b.match(/\r\n/g) || []).length), 'lines=' + b.split('\n').length);
}