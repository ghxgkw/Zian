const fs = require('fs');
const src = fs.readFileSync('D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/main.js', 'utf8');
const i = src.indexOf('  return list;');
console.log('ctx:', JSON.stringify(src.slice(i - 40, i + 40)));
const j = src.indexOf('saveLinksCache(arr)');
console.log('save ctx:', JSON.stringify(src.slice(j, j + 200)));