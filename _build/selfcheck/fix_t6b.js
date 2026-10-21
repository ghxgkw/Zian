const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/tmp/selfcheck/t6_a5.js';
let s = fs.readFileSync(F, 'utf8');
function rep(name, a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.log('FAIL ' + name + ' matches=' + n); process.exitCode = 1; return; }
  s = s.replace(a, () => b); console.log('OK   ' + name);
}
rep('inject-key', '  srcLoad, srcSave, srcBtn, srcConf, srcBatch, srcRestore,',
  '  "const GAPPS_DISABLED_KEY = String.fromCharCode(122) + \'ian_disabled_gapps\';",\n  srcLoad, srcSave, srcBtn, srcConf, srcBatch, srcRestore,');
rep('fix-assert', "ok('A5 渲染层不再直接拼 pm enable（恢复只走 IPC）', R.indexOf(\"'pm enable'\") < 0);",
  "ok('A5 恢复只走 IPC（恢复代码里没有任何 adb/pm 拼接）', restAssign.indexOf('pm ') < 0 && restAssign.indexOf('api.gappsRestore') > 0 && restAssign.indexOf('cmdRun') < 0);");
fs.writeFileSync(F, s);