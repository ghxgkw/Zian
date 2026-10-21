const fs = require('fs');
const path = require('path');
const vm = require('vm');
const APP = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked';
const R = fs.readFileSync(path.join(APP, 'renderer.js'), 'utf8');
const H = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n + (x ? '  | ' + x : '')); } else { fail++; console.log('FAIL  ' + n + (x ? '  | ' + x : '')); } };
function sliceBetween(src, a, b) {
  const i = src.indexOf(a); if (i < 0) throw new Error('miss-start: ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('miss-end: ' + b);
  return src.slice(i, j + b.length);
}
const srcLoad = sliceBetween(R, 'function loadDisabledGapps() {', '\n}');
const srcSave = sliceBetween(R, 'function saveDisabledGapps(arr) {', '\n}');
const srcBtn = sliceBetween(R, 'function setRestoreBtn() {', '\n}');
const srcConf = sliceBetween(R, 'function gappsDisableConfirm(pkgs) {', '\n}');
const srcBatch = sliceBetween(R, 'async function gappsBatch(disable) {', '\n}');
const restAssign = sliceBetween(R, "$('#btn-gapps-restore').onclick = async () => {", '\n};');
const srcRestore = 'const restoreHandler = ' + restAssign.replace("$('#btn-gapps-restore').onclick = ", '') + ';';

const script = [
  'const store = {};',
  "const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };",
  'const toasts = []; const logs = [];',
  'const toast = (m) => toasts.push(m);',
  'const appLog = (m) => logs.push(m);',
  'let confirmAnswer = true; const confirmTexts = [];',
  'const confirm = (t) => { confirmTexts.push(t); return confirmAnswer; };',
  'const needDevice = () => true;',
  "const currentSerial = 'S1';",
  "const btn = { disabled: false, textContent: '' };",
  "const $ = (sel) => (sel === '#btn-gapps-restore' ? btn : { value: '' });",
  'let checkedPkgs = [];',
  'const $$ = () => checkedPkgs.map((p) => ({ dataset: { gapp: p } }));',
  'const cmdCalls = []; const restoreCalls = [];',
  'let restoreResult = { ok: true, results: [] };',
  'const api = { cmdRun: async (s, c) => { cmdCalls.push(c); return { code: 0, out: String(), err: String() }; }, gappsRestore: async (s, list) => { restoreCalls.push(list.slice()); return restoreResult; } };',
  "const GAPPS_DISABLED_KEY = String.fromCharCode(122) + 'ian_disabled_gapps';",
  srcLoad, srcSave, srcBtn, srcConf, srcBatch, srcRestore,
  'module.exports = { gappsBatch, restoreHandler, gappsDisableConfirm, loadDisabledGapps, saveDisabledGapps, setRestoreBtn, store, cmdCalls, restoreCalls, toasts, logs, confirmTexts, btn, setChecked: (a) => { checkedPkgs = a; }, setConfirm: (v) => { confirmAnswer = v; }, setRestore: (r) => { restoreResult = r; } };'
].join('\n');
const ctx = vm.createContext({ console, module: { exports: {} }, JSON, Array, Object, Set });
vm.runInContext(script, ctx);
const api = ctx.module.exports;
const PKGS = ['com.android.vending', 'com.google.android.gms', 'com.google.android.gsf'];

(async function main() {
const txt = api.gappsDisableConfirm(PKGS);
const txtLines = txt.split('\n');
ok('A5 确认框含全部包名（每行一个）', PKGS.every((p) => txtLines.indexOf(p) >= 0), 'lines=' + JSON.stringify(txtLines.filter((l) => l)));
ok('A5 确认框标明数量与影响', txt.indexOf('3 个') >= 0 && txt.indexOf('影响') >= 0);
api.setChecked(PKGS);
api.setConfirm(false);
await api.gappsBatch(true);
ok('A5 取消时不发送任何命令', api.cmdCalls.length === 0, 'calls=' + JSON.stringify(api.cmdCalls));
ok('A5 取消时提示并保留空清单', api.toasts.some((t) => t.indexOf('已取消') >= 0) && api.loadDisabledGapps().length === 0);
api.setConfirm(true);
await api.gappsBatch(true);
ok('A5 确认后逐条禁用', JSON.stringify(api.cmdCalls) === JSON.stringify(PKGS.map((p) => 'pm disable-user --user 0 ' + p)), api.cmdCalls.join(' | '));
ok('A5 禁用清单已记录', JSON.stringify(api.loadDisabledGapps()) === JSON.stringify(PKGS), JSON.stringify(api.loadDisabledGapps()));
ok('A5 恢复按钮显示数量', api.btn.disabled === false && api.btn.textContent.indexOf('3') >= 0, api.btn.textContent);

api.setRestore({ ok: false, results: [{ pkg: PKGS[0], ok: true, msg: '已启用' }, { pkg: PKGS[1], ok: false, msg: '仍处于禁用状态' }, { pkg: PKGS[2], ok: true, msg: '已启用' }] });
await api.restoreHandler();
ok('A5 恢复只对记录的包执行', JSON.stringify(api.restoreCalls[0]) === JSON.stringify(PKGS), JSON.stringify(api.restoreCalls[0]));
ok('A5 恢复结果逐个可区分', api.logs.some((l) => l.indexOf('仍处于禁用状态') >= 0 && l.indexOf('已启用') >= 0));
ok('A5 恢复后清掉成功的、保留失败的', JSON.stringify(api.loadDisabledGapps()) === JSON.stringify([PKGS[1]]), JSON.stringify(api.loadDisabledGapps()));
api.setRestore({ ok: true, results: PKGS.map((p) => ({ pkg: p, ok: true, msg: '已启用' })) });
api.saveDisabledGapps([PKGS[1]]);
await api.restoreHandler();
ok('A5 全部成功时清单清空（键被移除）', api.loadDisabledGapps().length === 0 && !('zian_disabled_gapps' in api.store));
ok('A5 清单为空时按钮禁用且不再调 IPC', api.btn.disabled === true && api.restoreCalls.length === 2, 'restoreCalls=' + api.restoreCalls.length);
const before = api.restoreCalls.length;
await api.restoreHandler();
ok('A5 空清单恢复不产生调用', api.restoreCalls.length === before && api.toasts.some((t) => t.indexOf('没有本应用禁用过') >= 0));
ok('A5 恢复走 IPC（preload 有 gappsRestore / main 有 gapps:restore）', fs.readFileSync(path.join(APP, 'preload.js'), 'utf8').indexOf('gappsRestore') > 0 && fs.readFileSync(path.join(APP, 'main.js'), 'utf8').indexOf("ipcMain.handle('gapps:restore'") > 0);
ok('A5 index.html 有批量恢复按钮', H.indexOf('id="btn-gapps-restore"') > 0);
ok('A5 恢复只走 IPC（恢复代码里没有任何 adb/pm 拼接）', restAssign.indexOf('pm ') < 0 && restAssign.indexOf('api.gappsRestore') > 0 && restAssign.indexOf('cmdRun') < 0);
console.log('---- ' + pass + ' passed, ' + fail + ' failed ----');
process.exitCode = fail ? 1 : 0;
})();
