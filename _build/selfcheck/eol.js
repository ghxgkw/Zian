const fs = require('fs');
const files = ['main.js','renderer.js','preload.js','index.html','style.css','lib/util.js','lib/net.js','lib/adb.js'];
for (const f of files) {
  const b = fs.readFileSync('D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/' + f, 'utf8');
  const cr = (b.match(/\r/g) || []).length;
  const crlf = (b.match(/\r\n/g) || []).length;
  console.log(f.padEnd(14), 'CR=' + cr, 'CRLF=' + crlf, cr === crlf ? '(全部为 CRLF 行尾，可安全归一)' : '(含裸 CR！需人工确认)');
}