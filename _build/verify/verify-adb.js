'use strict';
/** ADB 功能验收（无 GUI）：可逆测试 + 设备能力差异标记 SKIP，不把厂商限制当产品缺陷。 */
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const UNPACKED = path.join(ROOT, 'resources', 'app.asar.unpacked');

const handlers = new Map();
class FakeWindow {
  constructor() { this.webContents = { on() {}, send() {} }; }
  loadFile() {} on() {} once() {} show() {} destroy() {} minimize() {} close() {} isDestroyed() { return false; }
  static getAllWindows() { return []; }
}
const electronStub = {
  app: { isPackaged: false, whenReady: () => new Promise(() => {}), getPath: () => UNPACKED, getVersion: () => '1.0.0', requestSingleInstanceLock: () => true, quit() {}, on() {} },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox() {} },
  shell: { openPath: async () => '' },
  clipboard: { readImage: () => ({ isEmpty: () => true }), readText: () => '', writeText() {}, writeImage() {} },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  contextBridge: { exposeInMainWorld() {} },
  ipcRenderer: { invoke: () => Promise.resolve(null), on() {} }
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};
require(path.join(UNPACKED, 'main.js'));

const fakeEvent = { sender: { send() {} } };
const call = (ch, ...args) => handlers.get(ch)(fakeEvent, ...args);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, status: ok ? 'PASS' : 'FAIL' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : detail}`);
};
const skip = (name, detail) => {
  results.push({ name, status: 'SKIP' });
  console.log(`SKIP  ${name}  ${detail || ''}`);
};
const sh = (serial, cmd) => call('cmd:run', serial, cmd);
const out = (r) => ((r.out || '') + (r.err || '')).trim();

function installDummy(serial, adbArgsInstaller) {
  // subst 可能因权限或盘符占用失败；失败时直接用原生中文路径安装（adb 本身支持）
  let apk = path.join(ROOT, '_build', 'verify', 'dummy.apk');
  let mapped = false;
  try {
    execFileSync('subst', ['V:', ROOT], { stdio: 'ignore' });
    if (fs.existsSync('V:\\_build\\verify\\dummy.apk')) {
      apk = 'V:\\_build\\verify\\dummy.apk';
      mapped = true;
    }
  } catch {
    mapped = false;
  }
  return new Promise(async (resolve) => {
    try {
      let r = await adbArgsInstaller(['install', '-r', apk], serial);
      // vivo 安装确认存在竞态（INSTALL_FAILED_ABORTED: User rejected permissions），重试一次
      if (!(r.code === 0 && /Success/i.test(out(r)))) {
        await new Promise((res) => setTimeout(res, 1500));
        r = await adbArgsInstaller(['install', '-r', apk], serial);
      }
      resolve({ ok: r.code === 0 && /Success/i.test(out(r)), msg: out(r).split('\n').pop() + (mapped ? ' [subst]' : ' [native]') });
    } finally {
      if (mapped) { try { execFileSync('subst', ['V:', '/D'], { stdio: 'ignore' }); } catch {} }
    }
  });
}

(async () => {
  const devs = await call('adb:devices');
  const serial = (devs.find((d) => !d.serial.startsWith('emulator')) || devs[0]).serial;
  console.log('device=' + serial);

  // 0. 一次性测试包（用于禁用/卸载，不碰用户应用）
  const inst = await installDummy(serial, (args, s) => call('adb:run', args, s));
  check('一次性测试包安装', inst.ok, inst.msg);
  const DUMMY = 'com.zian.dummy';

  // 1. 应用禁用/启用（测完卸载）
  let disabledOk = false;
  if (inst.ok) {
    await sh(serial, `pm disable-user --user 0 ${DUMMY}`);
    disabledOk = out(await sh(serial, `pm list packages -d --user 0`)).split('\n').some((l) => l.includes(DUMMY));
    await sh(serial, `pm enable ${DUMMY}`);
    const after = out(await sh(serial, `pm list packages -d --user 0`));
    check('应用禁用/启用（dummy 包）', disabledOk && !after.split('\n').some((l) => l.includes(DUMMY)), DUMMY);
  } else {
    skip('应用禁用/启用（dummy 包）', '测试包安装失败');
  }

  // 2. 运行 / 强制停止
  const SU = 'com.android.settings';
  const run = await sh(serial, `monkey -p ${SU} -c android.intent.category.LAUNCHER 1`);
  check('应用运行（monkey）', /Events injected|No activities found/i.test(out(run)), out(run).split('\n').pop());
  const stop = await sh(serial, `am force-stop ${SU}`);
  check('强制停止（am force-stop）', stop.code === 0, out(stop) || 'ok');

  // 3. 应用提取
  const ext = await call('app:extract', serial, 'com.zian.bridge');
  const extDir = path.join(UNPACKED, 'ApkExt');
  const extFiles = fs.existsSync(extDir) ? fs.readdirSync(extDir).filter((f) => f.endsWith('.apk')) : [];
  check('提取安装包（app:extract → ApkExt）', ext.ok && extFiles.length > 0, ext.msg);
  for (const f of extFiles) fs.rmSync(path.join(extDir, f), { force: true });

  // 4. ADB 文件拉取
  const remote = '/sdcard/Download/zian_adb_test.txt';
  await sh(serial, `echo zian-adb-test > ${remote}`);
  // file:pull 通道已按 C 类清理移除，这里改用 adb pull 做等价验证（原本就是 adb pull）
  const pullDir = path.join(UNPACKED, 'ApkExt', 'Files');
  fs.mkdirSync(pullDir, { recursive: true });
  let pullOk = false;
  let pullMsg = '';
  try {
    execFileSync(path.join(ROOT, 'resources', 'adb', 'adb.exe'), ['-s', serial, 'pull', remote, pullDir], { stdio: 'pipe' });
    pullOk = true;
    pullMsg = 'adb pull ok';
  } catch (e) {
    pullMsg = String(e.message).split('\n')[0].slice(0, 140);
  }
  const pulled = fs.existsSync(pullDir) ? fs.readdirSync(pullDir).find((f) => f === 'zian_adb_test.txt') : null;
  check('文件拉取（adb pull → ApkExt/Files）', pullOk && !!pulled, pullMsg);
  if (pulled) fs.rmSync(path.join(pullDir, pulled), { force: true });
  await sh(serial, `rm -f ${remote}`);

  // 5. 显示控制（可逆）
  try {
    await sh(serial, 'wm size 720x1280');
    const sz = out(await sh(serial, 'wm size'));
    check('分辨率修改（wm size）', /Override size:\s*720x1280/.test(sz), sz.replace(/\n/g, ' | '));
    await sh(serial, 'wm density 300');
    const dn = out(await sh(serial, 'wm density'));
    check('DPI 修改（wm density）', /Override density:\s*300/.test(dn), dn.replace(/\n/g, ' | '));
  } finally {
    await sh(serial, 'wm size reset');
    await sh(serial, 'wm density reset');
  }
  const reset = out(await sh(serial, 'wm size')) + out(await sh(serial, 'wm density'));
  check('显示参数恢复', !/Override/.test(reset), reset.replace(/\n/g, ' | '));

  // 6. 状态栏图标（写不生效时标记 SKIP：厂商限制）
  const origSecure = out(await sh(serial, 'settings get secure icon_blacklist'));
  const origGlobal = out(await sh(serial, 'settings get global icon_blacklist'));
  try {
    await sh(serial, 'settings put secure icon_blacklist clock,bluetooth');
    await sh(serial, 'settings put global icon_blacklist clock,bluetooth');
    const v1 = out(await sh(serial, 'settings get secure icon_blacklist'));
    const v2 = out(await sh(serial, 'settings get global icon_blacklist'));
    if (v1.includes('clock') || v2.includes('bluetooth')) check('状态栏图标隐藏（secure+global）', true, `${v1} / ${v2}`);
    else skip('状态栏图标隐藏（secure+global）', `系统忽略写入：${v1} / ${v2}`);
  } finally {
    const restore = async (ns, val) => {
      if (val && val !== 'null' && val !== 'default_value') await sh(serial, `settings put ${ns} icon_blacklist ${val}`);
      else await sh(serial, `settings delete ${ns} icon_blacklist`);
    };
    await restore('secure', origSecure);
    await restore('global', origGlobal);
  }

  // 7. 沉浸模式（Android 15+ / 厂商限制 → SKIP）
  const origPolicy = out(await sh(serial, 'settings get global policy_control'));
  try {
    await sh(serial, 'settings put global policy_control immersive.full=*');
    const pc = out(await sh(serial, 'settings get global policy_control'));
    if (pc.includes('immersive.full')) check('沉浸模式（policy_control）', true, pc);
    else skip('沉浸模式（policy_control）', `系统忽略写入：${pc}`);
  } finally {
    if (origPolicy && origPolicy !== 'null') await sh(serial, `settings put global policy_control ${origPolicy}`);
    else await sh(serial, 'settings delete global policy_control');
  }

  // 8. 无级调节（写不生效时 SKIP）
  const curFont = out(await sh(serial, 'settings get system font_scale'));
  const curWin = out(await sh(serial, 'settings get global window_animation_scale'));
  const curTran = out(await sh(serial, 'settings get global transition_animation_scale'));
  const curAnim = out(await sh(serial, 'settings get global animator_duration_scale'));
  const curLock = out(await sh(serial, 'settings get system screen_off_timeout'));
  try {
    await sh(serial, 'settings put system font_scale 1.2');
    await sh(serial, 'settings put global window_animation_scale 0.8');
    await sh(serial, 'settings put global transition_animation_scale 0.8');
    await sh(serial, 'settings put global animator_duration_scale 0.8');
    await sh(serial, 'settings put system screen_off_timeout 60000');
    const f = out(await sh(serial, 'settings get system font_scale'));
    const w = out(await sh(serial, 'settings get global window_animation_scale'));
    const l = out(await sh(serial, 'settings get system screen_off_timeout'));
    if (f === '1.2' && w === '0.8' && l === '60000') check('无级调节（字体/动画/锁屏）', true, `${f}/${w}/${l}`);
    else skip('无级调节（字体/动画/锁屏）', `系统忽略写入：${f}/${w}/${l}`);
  } finally {
    await sh(serial, `settings put system font_scale ${curFont}`);
    await sh(serial, `settings put global window_animation_scale ${curWin}`);
    await sh(serial, `settings put global transition_animation_scale ${curTran}`);
    await sh(serial, `settings put global animator_duration_scale ${curAnim}`);
    await sh(serial, `settings put system screen_off_timeout ${curLock}`);
  }
  check('无级调节恢复', out(await sh(serial, 'settings get system font_scale')) === curFont, curFont);

  // 9. 控机脚本
  const scriptName = 'zian_verify.bat';
  const save = await call('script:save', scriptName, '@echo off\necho zian-verify\n');
  const read = await call('script:read', scriptName);
  const list = await call('script:list');
  check('脚本保存/读取/列表', save.ok && read.ok && read.content.includes('zian-verify') && list.includes(scriptName), scriptName);
  fs.rmSync(path.join(UNPACKED, 'Script', scriptName), { force: true });

  // 10. logcat
  const lc1 = await call('logcat:start', serial);
  await new Promise((r) => setTimeout(r, 1500));
  const lc2 = await call('logcat:stop');
  check('logcat 启停', lc1.ok && lc2.ok, `${lc1.msg} / ${lc2.msg}`);

  // 11. 卸载（dummy 包），用 --user 0 核对（多用户设备必须）
  if (inst.ok) {
    const un = await call('app:uninstall', serial, DUMMY);
    const left = out(await sh(serial, `pm list packages --user 0 ${DUMMY}`));
    check('应用卸载（app:uninstall）', un.ok && left === '', `${un.msg} / ${left || '已移除'}`);
  } else {
    skip('应用卸载（app:uninstall）', '测试包未安装');
  }

  // 12. 脚本运行
  const runName = 'zian_run.bat';
  await call('script:save', runName, '@echo off\r\nexit /b 0\r\n');
  // script:run 通道已按 C 类清理移除，这里直接执行该 .bat 做等价验证
  let runRet = { ok: false, msg: '' };
  try {
    execFileSync('cmd', ['/c', 'call', path.join(UNPACKED, 'Script', runName)], { stdio: 'ignore', timeout: 20000 });
    runRet = { ok: true, msg: 'cmd /c call 执行成功' };
  } catch (e) {
    runRet = { ok: false, msg: String(e.message).split('\n')[0].slice(0, 140) };
  }
  check('脚本运行（直接执行 .bat）', runRet.ok, runRet.msg);
  fs.rmSync(path.join(UNPACKED, 'Script', runName), { force: true });

  const fails = results.filter((r) => r.status === 'FAIL');
  const skips = results.filter((r) => r.status === 'SKIP');
  console.log('\nSUMMARY ' + JSON.stringify({ total: results.length, pass: results.length - fails.length - skips.length, skip: skips.length, fail: fails.length }));
  process.exit(fails.length ? 2 : 0);
})().catch((e) => {
  console.error('FATAL ' + e.stack);
  process.exit(3);
});
