const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/index.html';
const raw = fs.readFileSync(F, 'utf8');
const eol = raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
const lines = raw.split('\r\n').join('\n').split('\n');
const marker = 'id="script-name-tag"';
const hits = lines.map((l, i) => (l.indexOf(marker) >= 0 ? i : -1)).filter((i) => i >= 0);
if (hits.length !== 1) { console.log('FAIL anchor hits=' + hits.length); process.exit(1); }
lines.splice(hits[0] + 1, 0, ...["            <div class=\"row-like\" id=\"script-name-row\" style=\"display:none\">","              <input id=\"script-name-input\" class=\"line-input\" maxlength=\"60\" placeholder=\"脚本名（自动补 .bat）\">","              <span class=\"hint\" id=\"script-name-hint\"></span>","              <button class=\"btn\" id=\"btn-script-name-ok\"><i>✓</i>确定</button>","              <button class=\"btn ghost\" id=\"btn-script-name-cancel\"><i>✕</i>取消</button>","            </div>"]);
fs.writeFileSync(F, lines.join('\n').split('\n').join(eol));
console.log('inserted after line ' + (hits[0] + 1));