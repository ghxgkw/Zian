const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t3_c_misc.js';
let s = fs.readFileSync(F, 'utf8');
function repAll(name, a, b, expect) {
  const n = s.split(a).length - 1;
  if (n !== expect) { console.log('FAIL ' + name + ' matches=' + n + ' expect=' + expect); process.exitCode = 1; return; }
  s = s.split(a).join(b); console.log('OK   ' + name + ' x' + n);
}
repAll('param', "'fmSearchText', '$', '$$',", "'fmSearchText', '$', '$$', 'loadThumbsViaIpc',", 2);
repAll('arg1', ', () => box, () => []);', ', () => box, () => [], () => {});', 1);
repAll('arg2', ', () => box2, () => []);', ', () => box2, () => [], () => {});', 1);
fs.writeFileSync(F, s);