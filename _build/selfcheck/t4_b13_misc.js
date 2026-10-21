
const fs = require('fs');
const path = require('path');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const mainSrc = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
const rendSrc = fs.readFileSync(path.join(APP, 'renderer.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n + (x ? '  | ' + x : '')); } else { fail++; console.log('FAIL  ' + n + (x ? '  | ' + x : '')); } };

// B13：下载 URL 的 '+' 编码
const q = mainSrc.match(/path: '\/file\?path=' \+ encodeURIComponent\(remotePath\)\.replace\(\/\\\+\/g, '%2B'\)/)[0].trim();
console.log('== B13 提取: ' + q);
const builder = new Function('remotePath', 'return ' + q.replace("path: ", '') + ';');
for (const p of ['/sdcard/a+b.txt', '/sdcard/中文+plus 空格.txt', '/sdcard/plain.txt']) {
  const built = builder(p);
  const query = built.replace('/file?path=', '');
  const nanoRead = decodeURIComponent(query.replace(/\+/g, ' '));   // NanoHTTPD: '+' 视为空格
  ok('B13 文件名 ' + JSON.stringify(p) + ' 经 NanoHTTPD 解码后一致', nanoRead === p, 'query=' + query);
}
const naiveRaw = '/sdcard/a+b.txt';
const badQuery = '/file?path=' + encodeURIComponent(naiveRaw).replace(/%2B/g, '+');   // 假设未编码
ok('B13 对照·若 + 未被编码会被 NanoHTTPD 解成空格', decodeURIComponent(badQuery.replace('/file?path=', '').replace(/\+/g, ' ')) === '/sdcard/a b.txt', badQuery);
ok('B13 说明·encodeURIComponent 本身已编码 +，新增 replace 为幂等保险', encodeURIComponent(naiveRaw).indexOf('%2B') > 0);

// 残留引用
ok('C 全局 paths 变量已删除', rendSrc.indexOf('let paths = null;') < 0 && !/^let paths\b/m.test(rendSrc));
ok('C paths 仅剩文件推送回调内的同名局部变量', (rendSrc.match(/\bpaths\b/g) || []).length === 4, JSON.stringify((rendSrc.match(/.*\bpaths\b.*/g) || []).map((s) => s.trim())));
ok('B5 不再有无条件 mirrorChild = null（除自身进程清理）', (mainSrc.match(/^\s+mirrorChild = null;/gm) || []).length === 0, 'unguarded=' + (mainSrc.match(/^\s+mirrorChild = null;/gm) || []).length);
ok('B9 runScrcpy 已带 timeout 形参', /function runScrcpy\(args, timeoutMs\) \{/.test(mainSrc));
ok('B9 调用点传入秒数+90s 余量', mainSrc.indexOf('runScrcpy(args, seconds * 1000 + 90000)') > 0);
ok('B16 最终回退到 os.tmpdir', /return mk\(path\.join\(os\.tmpdir\(\), '梓安工具箱'\)\);/.test(mainSrc));
ok('A3 手机端长度单位对齐（UTF-8 字节）', mainSrc.indexOf("Buffer.byteLength(t, 'utf8')") > 0);
ok('A3 不再拼接类型前缀', mainSrc.indexOf("remote.type === 'text' ? 'txt:'") < 0);
ok('A4 默认启动页点击仍只在末尾出现一次', (rendSrc.match(/startBtn\.click\(\)/g) || []).length === 1);
console.log('---- ' + pass + ' passed, ' + fail + ' failed ----');
process.exitCode = fail ? 1 : 0;
