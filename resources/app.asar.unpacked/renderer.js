/* ============ 梓安搞机工具箱 · 页面逻辑 ============ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const api = window.zian;

let currentSerial = null;
let currentLink = null;   // 局域网设备 {ip, port, name, model, brand, ver}
let devList = [];

// ---------- 本地设置 ----------
// 设置损坏时回退默认值并清掉坏数据：JSON.parse 在模块求值阶段抛错会让整个渲染层停摆
function readSET() {
  try {
    const v = JSON.parse(localStorage.getItem('zian_settings') || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    try { localStorage.removeItem('zian_settings'); } catch {}
    return {};
  }
}
const SET = Object.assign({
  startView: 'home', cpuInterval: 1000, pushPath: '/sdcard/', allowDowngrade: false,
  termClearInput: false, termClearOutput: false, shotPush: true, theme: 'dark',
  viewAnim: true, viewAnimDur: 240, linkMode: 'auto'
}, readSET());
// 旧版设置迁移：默认改为深邃蓝黑主题（仅一次，之后尊重用户切换）
if (!localStorage.getItem('zian_theme_migrated_v2')) {
  SET.theme = 'dark';
  localStorage.setItem('zian_theme_migrated_v2', '1');
  saveSET();
}
function saveSET() { localStorage.setItem('zian_settings', JSON.stringify(SET)); }

// 应用切换动画设置（关于页可调）
function applyAnimSetting() {
  document.body.classList.toggle('no-anim', !SET.viewAnim);
  document.documentElement.style.setProperty('--zian-anim-dur', (SET.viewAnim ? SET.viewAnimDur : 0) + 'ms');
}
applyAnimSetting();

// ---------- 通用 ----------
function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3100);
}
function needDevice() {
  if (!currentSerial) { toast('请先连接并选择设备', true); return false; }
  return true;
}
function showOut(sel, text) {
  const el = $(sel);
  el.classList.remove('hidden');
  el.textContent = text || '（无输出）';
  el.scrollTop = 0;
}
function appendOut(sel, text) {
  const el = $(sel);
  el.classList.remove('hidden');
  el.textContent = (el.textContent + '\n' + text).split('\n').slice(-300).join('\n');
  el.scrollTop = el.scrollHeight;
}
// 属性/文本转义：DOM 序列化只会处理 & < >，引号（含单引号）需自己转，否则单引号属性会被咬断
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// 悬停浮层内容：全程 textContent / createTextNode 拼装，任何输入都只能变成文本节点
function fillTip(tip, metaJson) {
  let d = null;
  try { d = JSON.parse(metaJson || ''); } catch { d = null; }
  tip.textContent = '';
  if (!d) return false;
  const name = document.createElement('div');
  name.className = 't-name';
  name.textContent = d.n || '';
  tip.appendChild(name);
  [['大小', d.s], ['修改', d.m], ['路径', d.p]].forEach(([k, v]) => {
    const b = document.createElement('b');
    b.textContent = k;
    tip.appendChild(b);
    tip.appendChild(document.createTextNode(' ' + (v || '—')));
    tip.appendChild(document.createElement('br'));
  });
  return true;
}

// ---------- 导航 ----------
$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.view').forEach((v) => v.classList.remove('active'));
    $('#view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'scripts') loadScripts();
    if (btn.dataset.view === 'battery') refreshBattery();
    if (btn.dataset.view === 'display') refreshDisplay();
    if (btn.dataset.view === 'adjust') readAdjust();
    if (btn.dataset.view === 'interconnect') initInterconnect();
  });
});

// ---------- 窗口 ----------
$('#btn-min').onclick = () => api.winMin();
$('#btn-close').onclick = () => api.winClose();

// ---------- 关于页 · 动画设置 ----------
$('#set-anim-enable').checked = !!SET.viewAnim;
$('#set-anim-speed').value = SET.viewAnimDur;
$('#anim-speed-val').textContent = SET.viewAnimDur + 'ms';
$('#set-anim-enable').addEventListener('change', (e) => {
  SET.viewAnim = e.target.checked;
  saveSET();
  applyAnimSetting();
  toast(SET.viewAnim ? '切换动画已开启' : '切换动画已关闭');
});
$('#set-anim-speed').addEventListener('input', (e) => {
  SET.viewAnimDur = parseInt(e.target.value, 10) || 240;
  $('#anim-speed-val').textContent = SET.viewAnimDur + 'ms';
  saveSET();
  applyAnimSetting();
});

// ---------- 设备轮询 ----------
function stateText(st) {
  return { device: '在线', unauthorized: '未授权', offline: '离线', recovery: 'Recovery', sideload: 'Sideload' }[st] || st;
}
async function refreshDevices(silent = true) {
  devList = await api.adbDevices();
  // 标题栏状态
  const dot = $('#nav-status .dot');
  const txt = $('#nav-status-txt');
  const active = devList.find((d) => d.serial === currentSerial) || devList.find((d) => d.state === 'device');
  if (active) {
    currentSerial = active.serial;
    dot.className = 'dot ' + (active.state === 'device' ? 'on' : 'warn');
    txt.textContent = `${active.model || ''} ${stateText(active.state)}`.trim();
  } else {
    currentSerial = null;
    dot.className = 'dot off';
    txt.textContent = '未连接设备';
  }
  // 主页下拉
  const sel = $('#dev-select');
  sel.innerHTML = devList.length
    ? devList.map((d) => `<option value="${esc(d.serial)}" ${d.serial === currentSerial ? 'selected' : ''}>${esc((d.model ? d.model + ' · ' : '') + d.serial)}</option>`).join('')
    : '<option value="">无设备</option>';
  syncMirrorSelect();
}
$('#dev-select').addEventListener('change', (e) => { currentSerial = e.target.value || null; refreshDevices(); });
$('#btn-dev-refresh').onclick = async () => { await refreshDevices(false); toast(devList.length ? `发现 ${devList.length} 台设备` : '未发现设备', !devList.length); };

// ============ 主页 ============
function infoCell(k, v) { return `<span><b>${k}：</b>${esc(String(v ?? '—'))}</span>`; }

$('#btn-readinfo').onclick = async () => {
  if (!needDevice()) return;
  $('#info-main').innerHTML = '<span class="hint" style="grid-column:1/-1">读取中…</span>';
  const d = await api.deviceInfo(currentSerial);
  if (!d.ok) { $('#info-main').innerHTML = '<span class="hint">读取失败，请检查设备连接与授权</span>'; return; }
  $('#home-title').textContent = `设备信息：${d.model}`;
  const temp = d.batteryTemp ? (d.batteryTemp.slice(0, -1) + '.' + d.batteryTemp.slice(-1) + '℃') : 'N/A';
  let coreHtml = d.cpuFreqs.length
    ? d.cpuFreqs.map((f, i) => `CPU ${i}: ${f}`).join('<br>')
    : 'CPU: —';
  $('#info-main').innerHTML =
    infoCell('品牌', d.brand) + infoCell('CPU架构', d.abi || '—') + `<span id="cpu-cells">${coreHtml}</span>` +
    infoCell('型号', d.model) + infoCell('闪存类型', d.flashType) +
    infoCell('系统', `Android ${d.android} (API${d.sdk})`) +
    infoCell('代号', d.device) + infoCell('显示信息', d.resolution ? `${d.resolution}(${d.density}dpi)` : '—') +
    infoCell('已开机', d.uptime || '—') +
    infoCell('主板id', d.board) + infoCell('电池信息', d.battery !== '' ? `${d.battery}% / ${temp}` : 'N/A') + '<span></span>';
  $('#info-extra').innerHTML =
    `<div><b>系统架构：</b>${esc(d.arch || '—')}</div>` +
    `<div><b>编译版本：</b>${esc(d.fingerprint || d.build || '—')}</div>` +
    `<div><b>内核版本：</b>${esc(d.kernel || '—')}</div>`;
};

$$('[data-reboot]').forEach((b) => {
  b.onclick = async () => {
    if (!needDevice()) return;
    const names = { system: '重启', shutdown: '关机', recovery: '进入 Recovery', bootloader: '进入 Fastboot (Bootloader)', fastbootd: '进入 Fastbootd', edl: '进入 EDL (9008)' };
    if (!confirm(`确定执行「${names[b.dataset.reboot]}」？设备将立即${b.dataset.reboot === 'shutdown' ? '关机' : '重启'}。`)) return;
    const r = await api.reboot(currentSerial, b.dataset.reboot);
    showOut('#home-out', r.msg);
    toast(r.msg, !r.ok);
  };
});

// ---------- 网络调试弹窗 ----------
$('#btn-net-debug').onclick = () => $('#modal-mask').classList.remove('hidden');
$('#btn-net-close').onclick = () => $('#modal-mask').classList.add('hidden');
$('#modal-mask').addEventListener('click', (e) => { if (e.target.id === 'modal-mask') $('#modal-mask').classList.add('hidden'); });
$('#btn-pair').onclick = async () => {
  const ip = $('#pair-ip').value.trim(), port = $('#pair-port').value.trim(), code = $('#pair-code').value.trim();
  if (!ip || !port || !code) return toast('请填写完整的配对信息', true);
  $('#net-out').textContent = '配对中… 请留意手机端提示';
  const r = await api.adbRun(['pair', `${ip}:${port}`, code]);
  const res = ((r.out || '') + (r.err || '')).trim();
  const ok = /Successfully/i.test(res);
  $('#net-out').textContent = res;
  toast(ok ? '配对成功！请进行第②步连接' : '配对失败：' + res.split('\n')[0], !ok);
  if (ok) $('#conn-ip').value = ip;
};
$('#btn-connect-wifi').onclick = async () => {
  const ip = $('#conn-ip').value.trim(), port = $('#conn-port').value.trim();
  if (!ip || !port) return toast('请填写连接 IP 和端口', true);
  $('#net-out').textContent = `连接 ${ip}:${port} 中…`;
  const r = await api.adbRun(['connect', `${ip}:${port}`]);
  const res = ((r.out || '') + (r.err || '')).trim();
  $('#net-out').textContent = res;
  const ok = /connected to|already connected/i.test(res);
  toast(ok ? '无线连接成功' : '连接失败：' + res, !ok);
  if (ok) { refreshDevices(); setTimeout(() => $('#modal-mask').classList.add('hidden'), 800); }
};

// ============ 软件管理 ============
function appLog(text) { appendOut('#app-log', text); }

const APP_ACTIONS = {
  disable: (p) => `pm disable-user --user 0 ${p}`,
  enable: (p) => `pm enable ${p}`,
  run: (p) => `monkey -p ${p} -c android.intent.category.LAUNCHER 1`,
  forcestop: (p) => `am force-stop ${p}`,
  uninstallkeep: (p) => `pm uninstall -k --user 0 ${p}`,
  clear: (p) => `pm clear ${p}`,
  info: (p) => `dumpsys package ${p} | grep -E 'versionName|firstInstallTime|lastUpdateTime' | head -4`
};
$$('[data-app]').forEach((b) => {
  b.onclick = async () => {
    if (!needDevice()) return;
    const pkg = $('#app-pkg').value.trim();
    if (!pkg) return toast('请先填写软件包名', true);
    const act = b.dataset.app;
    b.disabled = true;
    try {
      if (act === 'uninstall') {
        if (!confirm(`确定卸载 ${pkg} ?`)) return;
        const r = await api.appUninstall(currentSerial, pkg);
        appLog(`[卸载] ${pkg} → ${r.msg}`);
        toast(r.ok ? '卸载成功' : '卸载失败', !r.ok);
      } else if (act === 'extract') {
        appLog(`[提取] ${pkg} …`);
        const r = await api.appExtract(currentSerial, pkg);
        appLog(`[提取] ${r.msg}\n目录: ${r.dir || ''}`);
        toast(r.ok ? '提取完成' : '提取失败', !r.ok);
      } else {
        const r = await api.cmdRun(currentSerial, APP_ACTIONS[act](pkg));
        const names = { disable: '禁用', enable: '启用', run: '运行', forcestop: '强制停止', uninstallkeep: '保留数据卸载', clear: '清除数据', info: '软件信息' };
        appLog(`[${names[act]}] ${pkg}\n${((r.out || '') + (r.err || '')).trim() || '（成功，无输出）'}`);
        toast(`${names[act]}指令已执行`, !r.out && r.err);
      }
    } finally { b.disabled = false; }
  };
});

// 当前界面包名
let focusTimer = null;
async function readFocus() {
  if (!currentSerial) { $('#focus-pkg').textContent = '未连接'; return; }
  let r = await api.cmdRun(currentSerial, `dumpsys activity activities | grep -E 'topResumedActivity|ResumedActivity' | head -3`);
  let text = (r.out || r.err || '').trim();
  let m = text.match(/([a-zA-Z][a-zA-Z0-9._]+)\/([a-zA-Z0-9._$]+)/);
  if (!m) {
    r = await api.cmdRun(currentSerial, `dumpsys window | grep mCurrentFocus`);
    m = (r.out || '').match(/([a-zA-Z][a-zA-Z0-9._]+)\/([a-zA-Z0-9._$]+)/);
  }
  $('#focus-pkg').textContent = m ? m[1] : (text.split('\n')[0] || '获取失败');
  if (m && $('#focus-auto').checked) $('#app-pkg').value = m[1];
}
$('#focus-auto').addEventListener('change', (e) => {
  clearInterval(focusTimer);
  if (e.target.checked) { readFocus(); focusTimer = setInterval(readFocus, 3000); }
});

$('#btn-app-install').onclick = async () => {
  if (!needDevice()) return;
  appLog('[安装] 打开文件选择…');
  const r = await api.appInstall(currentSerial, SET.allowDowngrade);
  if (r.ok) { appLog('[安装]\n' + r.msg); toast('安装流程完成'); }
  else if (r.msg !== '已取消') appLog('[安装] ' + r.msg);
};
$('#btn-app-push').onclick = async () => {
  if (!needDevice()) return;
  appLog('[发送文件] 选择文件…');
  const r = await api.filePush(currentSerial, SET.pushPath || '');
  if (r.msg !== '已取消') { appLog('[发送文件]\n' + r.msg); toast(r.ok ? '发送完成' : '发送失败', !r.ok); }
};

// Google 套件
const GAPPS = {
  '商店': 'com.android.vending', '键盘': 'com.google.android.inputmethod.latin',
  '播客': 'com.google.android.apps.podcasts', '邮箱': 'com.google.android.gm',
  '服务': 'com.google.android.gms', '备份': 'com.google.android.apps.backup',
  '云盘': 'com.google.android.apps.docs', '搜索': 'com.google.android.googlequicksearchbox',
  '框架': 'com.google.android.gsf', '电影': 'com.google.android.videos',
  '相册': 'com.google.android.apps.photos', '地图': 'com.google.android.apps.maps',
  '音乐': 'com.google.android.music', 'Pay': 'com.google.android.apps.walletnfcrel',
  'One': 'com.google.android.apps.google.one', 'Duo': 'com.google.android.apps.tachyon',
  'Chrome': 'com.android.chrome', 'Youtube': 'com.google.android.youtube'
};
$('#gapps-grid').innerHTML = Object.keys(GAPPS).map((n) =>
  `<label><input type="checkbox" data-gapp="${GAPPS[n]}">${n}</label>`).join('');
// 本应用禁用过的 Google 组件清单：跨重启保留（否则重启后无法一键恢复），
// 存 localStorage 与 SET 同机制——不加新文件、不需要额外权限，随用户配置一起走
const GAPPS_DISABLED_KEY = 'zian_disabled_gapps';
function loadDisabledGapps() {
  try {
    const v = JSON.parse(localStorage.getItem(GAPPS_DISABLED_KEY) || '[]');
    return Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p) : [];
  } catch { return []; }
}
function saveDisabledGapps(arr) {
  try {
    const uniq = [...new Set(arr)];
    if (uniq.length) localStorage.setItem(GAPPS_DISABLED_KEY, JSON.stringify(uniq));
    else localStorage.removeItem(GAPPS_DISABLED_KEY);
  } catch {}
  setRestoreBtn();
}
function setRestoreBtn() {
  const btn = $('#btn-gapps-restore');
  if (!btn) return;
  const n = loadDisabledGapps().length;
  btn.disabled = !n;
  btn.textContent = n ? '批量恢复（' + n + '）' : '批量恢复';
}
/** 禁用前的确认文案：逐行列出完整包名 + 影响提示 */
function gappsDisableConfirm(pkgs) {
  return [
    '即将禁用 ' + pkgs.length + ' 个 Google 系统组件：',
    '',
    pkgs.join('\n'),
    '',
    '影响：这些组件在手机上停止运行；禁用 GMS/GSF/商店 后，依赖 Google 服务的应用可能闪退或提示「设备不支持」。',
    '本应用会记住这次禁用的清单，可用「批量恢复」一键启用回来。',
    '',
    '确认继续？'
  ].join('\n');
}
async function gappsBatch(disable) {
  if (!needDevice()) return;
  const checked = $$('#gapps-grid input:checked');
  if (!checked.length) return toast('请先勾选要操作的套件', true);
  const pkgs = [...checked].map((c) => c.dataset.gapp);
  if (disable && !confirm(gappsDisableConfirm(pkgs))) return toast('已取消，未执行任何操作');
  const cmd = disable ? 'pm disable-user --user 0' : 'pm enable';
  const results = [];
  const doneOk = [];
  for (const pkg of pkgs) {
    const r = await api.cmdRun(currentSerial, cmd + ' ' + pkg);
    const out = ((r.out || '') + (r.err || '')).trim();
    const ok = r.code === 0 && !/Exception|Failure|Error|not found/i.test(out);
    if (ok) doneOk.push(pkg);
    results.push(pkg + ': ' + (out.split('\n').pop() || (ok ? (disable ? '已禁用' : '已启用') : '失败')));
  }
  if (disable) saveDisabledGapps(loadDisabledGapps().concat(doneOk));
  else saveDisabledGapps(loadDisabledGapps().filter((p) => doneOk.indexOf(p) < 0));
  appLog('[Google套件' + (disable ? '禁用' : '启用') + ']\n' + results.join('\n'));
  toast('批量操作完成（成功 ' + doneOk.length + '/' + pkgs.length + '），详见操作记录', doneOk.length !== pkgs.length);
}
$('#btn-gapps-disable').onclick = () => gappsBatch(true);
$('#btn-gapps-enable').onclick = () => gappsBatch(false);
$('#btn-gapps-restore').onclick = async () => {
  if (!needDevice()) return;
  const list = loadDisabledGapps();
  if (!list.length) return toast('没有本应用禁用过的组件需要恢复', true);
  if (!confirm('将重新启用本应用禁用过的 ' + list.length + ' 个组件：\n\n' + list.join('\n') + '\n\n确认继续？')) return;
  const r = await api.gappsRestore(currentSerial, list);
  const rows = Array.isArray(r.results) ? r.results : [];
  appLog('[Google套件批量恢复]\n' + rows.map((x) => x.pkg + ': ' + (x.ok ? '已启用' : '失败 · ' + x.msg)).join('\n'));
  // 只清掉真正恢复成功的；失败的留在清单里，用户还能再点一次
  saveDisabledGapps(rows.filter((x) => !x.ok).map((x) => x.pkg));
  const okCount = rows.filter((x) => x.ok).length;
  toast('恢复完成：成功 ' + okCount + '/' + rows.length + (okCount < rows.length ? '，失败 ' + (rows.length - okCount) : ''), okCount !== rows.length);
};
setRestoreBtn();

// ============ 显示控制 ============
async function refreshDisplay() {
  if (!currentSerial) { $('#cur-res').textContent = $('#cur-dpi').textContent = '未连接'; return; }
  const [s, d] = await Promise.all([
    api.cmdRun(currentSerial, 'wm size'),
    api.cmdRun(currentSerial, 'wm density')
  ]);
  const res = ((s.out || '').match(/(\d+x\d+)/g) || []).pop() || '—';
  const dpi = ((d.out || '').match(/(\d+)/) || [])[1] || '—';
  $('#cur-res').textContent = res;
  $('#cur-dpi').textContent = dpi;
  const [w, h] = res.split('x').map(Number);
  $('#cur-minw').textContent = (w && dpi !== '—') ? Math.round(Math.min(w, h) / (dpi / 160)) : '—';
}
$('#btn-res-set').onclick = async () => {
  if (!needDevice()) return;
  const w = $('#res-w').value.trim(), h = $('#res-h').value.trim();
  if (!/^\d+$/.test(w) || !/^\d+$/.test(h)) return toast('请输入横向和纵向像素', true);
  const r = await api.cmdRun(currentSerial, `wm size ${w}x${h}`);
  showOut('#display-out', `修改分辨率 ${w}x${h}\n${(r.out || r.err || '已执行').trim()}`);
  refreshDisplay(); toast('分辨率已修改');
};
$('#btn-res-reset').onclick = async () => {
  if (!needDevice()) return;
  const r = await api.cmdRun(currentSerial, 'wm size reset');
  showOut('#display-out', '恢复默认分辨率\n' + (r.err || '已执行'));
  refreshDisplay(); toast('分辨率已恢复');
};
$('#btn-dpi-set').onclick = async () => {
  if (!needDevice()) return;
  const v = $('#dpi-input').value.trim();
  if (!/^\d+$/.test(v)) return toast('请输入 DPI 数值', true);
  const r = await api.cmdRun(currentSerial, `wm density ${v}`);
  showOut('#display-out', `修改密度 ${v}dpi\n${(r.out || r.err || '已执行').trim()}`);
  refreshDisplay(); toast('显示密度已修改');
};
$('#btn-dpi-reset').onclick = async () => {
  if (!needDevice()) return;
  const r = await api.cmdRun(currentSerial, 'wm density reset');
  showOut('#display-out', '恢复默认密度\n' + (r.err || '已执行'));
  refreshDisplay(); toast('显示密度已恢复');
};

// 按键模拟
$$('[data-key]').forEach((b) => {
  b.onclick = async () => {
    if (!needDevice()) return;
    await api.cmdRun(currentSerial, `input keyevent ${b.dataset.key}`);
  };
});
// 右键锁屏 → 关机菜单
$('#btn-key-lock').addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  if (!needDevice()) return;
  await api.cmdRun(currentSerial, 'input keyevent --longpress 26');
  toast('已发送长按电源键（关机菜单）');
});
// 右键截屏 → 截图并打开目录
$('#btn-key-shot').addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  if (!needDevice()) return;
  const r = await api.screenshot(currentSerial, { toPc: SET.shotPush });
  if (r.ok) { toast('截图已保存'); if (!r.temp) api.openPath(r.msg.replace(/[\\/]zian_[\d_]+\.png$/, '')); }
  else toast(r.msg, true);
});

// ============ 系统界面 ============
const ICONS = {
  '时间': 'clock', '定位': 'location', '耳机': 'headset', '投射': 'cast',
  '闹钟': 'alarm', '声音': 'volume', '信号': 'mobile', '飞行': 'airplane',
  '蓝牙': 'bluetooth', '电池': 'battery', '无线': 'wifi', 'NFC': 'nfc',
  '左下角旋转提示': 'rotate'
};
$('#icon-grid').innerHTML = Object.keys(ICONS).map((n) =>
  `<label><input type="checkbox" data-icon="${ICONS[n]}">${n}</label>`).join('');

$('#btn-icon-read').onclick = async () => {
  if (!needDevice()) return;
  const r = await api.cmdRun(currentSerial, 'settings get secure icon_blacklist');
  const cur = ((r.out || '').trim() === 'null' ? '' : (r.out || '').trim()).split(',').filter(Boolean);
  $$('#icon-grid input').forEach((c) => { c.checked = cur.includes(c.dataset.icon); });
  showOut('#sysui-out', '当前隐藏列表: ' + (cur.join(', ') || '（无）'));
  toast('已读取当前状态栏图标状态');
};
$('#btn-icon-apply').onclick = async () => {
  if (!needDevice()) return;
  // 兼容部分厂商 SystemUI 读 global 命名空间：双命名空间同时写入
  const readList = async (ns) => {
    const r = await api.cmdRun(currentSerial, `settings get ${ns} icon_blacklist`);
    return ((r.out || '').trim() === 'null' ? '' : (r.out || '').trim()).split(',').filter(Boolean);
  };
  const cur = [...new Set([...await readList('secure'), ...await readList('global')])];
  const set = new Set(cur);
  $$('#icon-grid input').forEach((c) => {
    if (c.checked) set.add(c.dataset.icon); else set.delete(c.dataset.icon);
  });
  const list = [...set];
  const put = list.length ? `settings put %NS% icon_blacklist ${list.join(',')}` : null;
  const outs = [`已应用图标隐藏列表: ${list.join(', ') || '（空，全部显示）'}`];
  for (const ns of ['secure', 'global']) {
    if (put) await api.cmdRun(currentSerial, put.replace('%NS%', ns));
    else await api.cmdRun(currentSerial, `settings delete ${ns} icon_blacklist`);
  }
  // 重启 SystemUI 使隐藏立即生效（两种方式依次尝试）
  const rk = await api.cmdRun(currentSerial, 'am crash com.android.systemui 2>/dev/null || killall com.android.systemui 2>/dev/null');
  outs.push('已尝试重启 SystemUI 使其立即生效（状态栏会闪烁一下）');
  if ((rk.err || '').trim() && !/no user|not found|Debug daemon/i.test(rk.err)) outs.push((rk.err || '').trim());
  outs.push('提示: 部分厂商系统（如 OriginOS）状态栏为自绘，可能不支持此方式');
  showOut('#sysui-out', outs.join('\n'));
  toast('状态栏图标设置已应用');
};
$('#btn-miui-apply').onclick = async () => {
  if (!needDevice()) return;
  const out = [];
  const cnt = $('#miui-count').value, gap = $('#miui-gap').value;
  if (cnt) { await api.cmdRun(currentSerial, `settings put system status_bar_icon_count ${cnt}`); out.push(`下拉图标个数 → ${cnt}`); }
  if (gap) { await api.cmdRun(currentSerial, `settings put system status_bar_icon_top_margin ${gap}`); out.push(`图标顶部间距 → ${gap}`); }
  await api.cmdRun(currentSerial, 'settings put global captive_portal_detection_enabled 0');
  await api.cmdRun(currentSerial, 'settings put global captive_portal_mode 0');
  out.push('已关闭网络 captive 检测（去除 Wi-Fi 的 x/! 标记）');
  out.push('提示: 图标个数/间距为 MIUI 专用，其他系统无效');
  showOut('#sysui-out', out.join('\n'));
  toast('设置已应用');
};
$$('[data-immersive]').forEach((b) => {
  b.onclick = async () => {
    if (!needDevice()) return;
    const mode = b.dataset.immersive;
    let r;
    if (mode === 'reset') {
      r = await api.cmdRun(currentSerial, 'settings delete global policy_control');
      showOut('#sysui-out', '已恢复全部沉浸设置\n' + (r.err || ''));
      toast('沉浸设置已恢复');
    } else {
      const base = { status: 'immersive.status=', navigation: 'immersive.navigation=', full: 'immersive.full=' }[mode];
      const exclude = $('#immersive-exclude').value.trim();
      r = await api.cmdRun(currentSerial, `settings put global policy_control ${base}${exclude}`);
      showOut('#sysui-out', `沉浸模式[${mode}]已应用\n${exclude ? '排除: ' + exclude : '全局生效'}\n提示: 状态栏/导航栏自动隐藏，从屏幕边缘滑出可临时呼出\n注意: Android 15+ 系统已移除 policy_control 特性，此功能在新系统上无效`);
      toast('沉浸设置已应用（Android 15+ 系统可能无效）');
    }
  };
});

// ============ 电池管理 ============
async function refreshBattery() {
  if (!currentSerial) {
    $('#bat-info').innerHTML = '<span class="hint" style="grid-column:1/-1">未连接设备，请先在主页选择设备</span>';
    return;
  }
  $('#bat-info').innerHTML = '<span class="hint" style="grid-column:1/-1">读取中…</span>';
  try {
    const b = await api.batteryRead(currentSerial);
    if (!b.ok) {
      $('#bat-info').innerHTML = `<span class="hint" style="grid-column:1/-1">读取失败，设备原始输出：</span>` +
        `<span style="grid-column:1/-1;font-family:var(--mono);font-size:11.5px;white-space:pre-wrap;word-break:break-all;user-select:text">${esc(b.raw || '（空）').slice(0, 1500)}</span>`;
      return;
    }
    const stMap = { '1': '未知', '2': '充电中', '3': '放电中', '4': '未充电', '5': '已充满' };
    const hMap = { '1': '未知', '2': '良好', '3': '过热', '4': '已损坏', '5': '过压', '7': '冷' };
    const powered = [b.acPowered && 'AC电源', b.usbPowered && 'USB', b.wirelessPowered && '无线'].filter(Boolean).join(' / ');
    $('#bat-info').innerHTML =
      infoCell('电量', b.level !== '' ? `${b.level} %` : '—') +
      infoCell('状态', stMap[b.status] || b.status || '—') +
      infoCell('电池健康', hMap[b.health] || b.health || '—') +
      infoCell('温度', b.temp ? (b.temp.slice(0, -1) + '.' + b.temp.slice(-1) + ' ℃') : '—') +
      infoCell('电压', b.voltage ? b.voltage + ' mV' : '—') +
      infoCell('电池技术', b.tech || '—') +
      infoCell('电量计数', b.counter ? b.counter + ' µAh' : '—') +
      infoCell('供电状态', powered || '电池供电') +
      infoCell('出厂设计容量', b.designCap ? b.designCap + ' mAh' : '厂商未开放') +
      infoCell('当前满充容量', b.fullCap ? b.fullCap + ' mAh' : '—') +
      infoCell('循环次数', b.cycles || '—') +
      infoCell('已开机', b.uptime || '—');
  } catch (err) {
    $('#bat-info').innerHTML = `<span class="hint" style="grid-column:1/-1">读取异常：${esc(String(err))}</span>`;
  }
}
$('#btn-bat-refresh').onclick = () => { if (needDevice()) refreshBattery(); };

// ============ 无级调节 ============
async function adbGet(key, ns = 'system') {
  const r = await api.cmdRun(currentSerial, `settings get ${ns} ${key}`);
  const v = (r.out || '').trim();
  return (v === 'null' || v === '') ? null : v;
}
async function readAdjust() {
  if (!currentSerial) return;
  const [fs_, w, t, a, lock] = await Promise.all([
    adbGet('font_scale'),
    adbGet('window_animation_scale', 'global'),
    adbGet('transition_animation_scale', 'global'),
    adbGet('animator_duration_scale', 'global'),
    adbGet('screen_off_timeout')
  ]);
  if (fs_) { $('#sl-font').value = parseFloat(fs_); $('#font-cur').textContent = parseFloat(fs_) + 'x'; }
  if (w !== null) { $('#sl-win').value = parseFloat(w); $('#win-v').textContent = parseFloat(w) + 'x'; }
  if (t !== null) { $('#sl-trans').value = parseFloat(t); $('#trans-v').textContent = parseFloat(t) + 'x'; }
  if (a !== null) { $('#sl-anim').value = parseFloat(a); $('#anim-v').textContent = parseFloat(a) + 'x'; }
  if (lock !== null) $('#lock-cur').textContent = Math.round(lock / 1000) + ' s';
}
$('#btn-adjust-read').onclick = () => { if (needDevice()) { readAdjust(); toast('已读取当前数值'); } };
$('#sl-font').addEventListener('input', (e) => $('#font-set').textContent = parseFloat(e.target.value) + 'x');
$('#sl-font').addEventListener('change', async (e) => {
  if (!needDevice()) return;
  await api.cmdRun(currentSerial, `settings put system font_scale ${e.target.value}`);
  toast('字体倍数已应用: ' + parseFloat(e.target.value) + 'x');
});
[['sl-win', 'window_animation_scale', 'win-v'], ['sl-trans', 'transition_animation_scale', 'trans-v'], ['sl-anim', 'animator_duration_scale', 'anim-v']].forEach(([id, key, label]) => {
  $('#' + id).addEventListener('input', (e) => $('#' + label).textContent = parseFloat(e.target.value) + 'x');
  $('#' + id).addEventListener('change', async (e) => {
    if (!needDevice()) return;
    await api.cmdRun(currentSerial, `settings put global ${key} ${e.target.value}`);
    toast(`动画速度已应用: ${parseFloat(e.target.value)}x`);
  });
});
$('#btn-lock-set').onclick = async () => {
  if (!needDevice()) return;
  const v = parseInt($('#lock-input').value);
  if (!(v > 0)) return toast('请输入锁屏秒数', true);
  await api.cmdRun(currentSerial, `settings put system screen_off_timeout ${v * 1000}`);
  $('#lock-cur').textContent = v + ' s';
  toast(`锁屏时间已修改为 ${v} 秒`);
};

// ============ 截图录屏 ============
$('#btn-shot').onclick = async () => {
  if (!needDevice()) return;
  $('#shot-preview').innerHTML = '<span class="hint">截图传输中…</span>';
  const r = await api.screenshot(currentSerial, { toPc: SET.shotPush });
  if (r.ok) {
    $('#shot-preview').innerHTML = `<img src="${r.dataUrl}" alt="截图">`;
    $('#btn-open-shot').disabled = r.temp;
    $('#btn-open-shot').onclick = () => api.openPath(r.msg.replace(/[\\/]zian_[\d_]+\.png$/, ''));
    toast(r.temp ? '截图完成（未保存到电脑）' : '截图已保存: ' + r.msg);
  } else { $('#shot-preview').innerHTML = '<span class="hint">截图失败</span>'; toast(r.msg, true); }
};
$('#btn-record').onclick = async () => {
  if (!needDevice()) return;
  const sec = parseInt($('#rec-sec').value) || 30;
  const r = await api.recordStart(currentSerial, sec, $('#rec-audio').value);
  $('#rec-state').textContent = r.msg;
  toast(r.msg, !r.ok);
};
$('#btn-record-stop').onclick = async () => {
  if (!needDevice()) return;
  const r = await api.recordStop();
  $('#rec-state').textContent = r.msg;
  toast(r.msg, !r.ok);
};
let recNote = ''; // 保留最近一条录制提示，避免被后续状态覆盖
api.onRecord((st) => {
  const el = $('#rec-state');
  if (st.state === 'recording') {
    recNote = '';
    el.textContent = `● 录制中 (${st.seconds}s)，请勿断开设备…（可点「结束录制」提前保存）`;
    $('#btn-record').disabled = true; $('#btn-record-stop').disabled = false;
  }
  if (st.state === 'note') { recNote = st.msg; el.textContent = '⚠ ' + st.msg; toast(st.msg); }
  if (st.state === 'pulling') el.textContent = '录制完成，正在拉取视频…';
  if (st.state === 'done') {
    el.textContent = '✔ 已保存: ' + st.path + (st.extra ? '\n✔ 麦克风音轨: ' + st.extra : '') + (recNote ? '\n⚠ ' + recNote : '');
    $('#btn-open-rec').disabled = false; $('#btn-open-rec').onclick = () => api.openPath(st.path);
    $('#btn-record').disabled = false; $('#btn-record-stop').disabled = true;
    toast(st.extra ? '录屏已保存（含独立麦克风音轨）' : '录屏已保存');
  }
  if (st.state === 'error') {
    el.textContent = '✘ ' + st.msg; toast(st.msg, true);
    $('#btn-record').disabled = false; $('#btn-record-stop').disabled = true;
  }
});

// ============ 控机脚本（编辑器） ============
let scriptItems = [];
let curScript = null;
let scriptRunning = false;
const INS_SNIPPETS = {
  touch: `\n# 触摸模拟（坐标按设备分辨率修改）\ninput tap 540 1200              # 单击\ninput swipe 540 1500 540 500 300 # 上滑\ninput swipe 540 500 540 1500 300 # 下滑\ninput swipe 300 800 300 800 2000 # 长按\n`,
  key: `\n# 按键模拟\ninput keyevent 4    # 返回\ninput keyevent 3    # 主页\ninput keyevent 187  # 多任务\ninput keyevent 26   # 电源键\ninput keyevent 24   # 音量+\ninput keyevent 25   # 音量-\n`,
  app: `\n# 软件控制（替换为实际包名）\nmonkey -p com.example.app -c android.intent.category.LAUNCHER 1  # 启动\nam force-stop com.example.app  # 强制停止\npm clear com.example.app       # 清除数据\npm disable-user --user 0 com.example.app  # 禁用\n`,
  sys: `\n# 系统控制\nwm size 1080x2400                # 修改分辨率\nwm size reset                    # 恢复分辨率\nwm density 480                   # 修改密度\nsettings put system screen_off_timeout 60000  # 锁屏时间\n`,
  ctrl: `\n# 脚本控制\ndelay 1000   # 等待1000毫秒\n# 以 # 开头的行与空行不会执行\n# 每行一条 adb shell 指令，自上而下执行\n`
};
async function loadScripts() {
  scriptItems = await api.scriptList();
  const box = $('#script-list');
  box.innerHTML = scriptItems.length
    ? scriptItems.map((f) => `<div class="item" data-name="${esc(f)}"><span>❯</span><span>${esc(f)}</span></div>`).join('')
    : '<div class="hint">暂无脚本，点击「新建」创建</div>';
  box.querySelectorAll('.item').forEach((el) => {
    el.onclick = () => selectScript(el.dataset.name);
  });
}
async function selectScript(name) {
  curScript = name;
  $('#script-name-tag').textContent = '（' + name + '）';
  const r = await api.scriptRead(name);
  $('#script-editor').value = r.ok ? r.content : '';
  if (!r.ok) toast(r.msg, true);
  $$('#script-list .item').forEach((el) => el.classList.toggle('active', el.dataset.name === name));
}
$$('[data-ins]').forEach((b) => {
  b.onclick = () => {
    const ed = $('#script-editor');
    ed.value += INS_SNIPPETS[b.dataset.ins];
    ed.scrollTop = ed.scrollHeight;
  };
});
// 内联脚本名输入：Electron 不支持 window.prompt（返回 undefined），必须用页面内输入
let scriptNameResolve = null;
function askScriptName(title) {
  const row = $('#script-name-row');
  const input = $('#script-name-input');
  $('#script-name-hint').textContent = title || '';
  input.value = '';
  row.style.display = 'flex';
  input.focus();
  return new Promise((resolve) => { scriptNameResolve = resolve; });
}
function closeScriptName(value) {
  const row = $('#script-name-row');
  if (row) row.style.display = 'none';
  const resolve = scriptNameResolve;
  scriptNameResolve = null;
  if (resolve) resolve(value);
}
function initScriptNameBar() {
  const row = $('#script-name-row');
  const input = $('#script-name-input');
  if (!row || !input) return;
  const submit = () => {
    const v = String(input.value || '').trim();
    if (!v) { $('#script-name-hint').textContent = '脚本名不能为空'; input.focus(); return; }
    closeScriptName(v);
  };
  const cancel = () => closeScriptName(null);
  $('#btn-script-name-ok').onclick = submit;
  $('#btn-script-name-cancel').onclick = cancel;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}
initScriptNameBar();

$('#btn-script-new').onclick = async () => {
  let name = await askScriptName('新建脚本名（回车确定 / Esc 取消，自动补 .bat）');
  if (!name) return;
  if (!/\.(bat|cmd|txt)$/i.test(name)) name += '.bat';
  const r = await api.scriptSave(name, '# 新脚本\n');
  if (!r.ok) return toast(r.msg, true);
  await loadScripts();
  selectScript(name);
  toast(r.msg);
};
$('#btn-script-refresh').onclick = async () => { await loadScripts(); toast(`共 ${scriptItems.length} 个脚本`); };
async function runScript(name, content) {
  if (scriptRunning) return toast('脚本正在运行中', true);
  if (!needDevice()) return;
  scriptRunning = true;
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  showOut('#cmd-out', `▶ 运行脚本 ${name}（${lines.length} 条指令）`);
  const autoDelay = $('#script-autodelay').checked;
  let idx = 0, fail = 0;
  // finally 兜底：中途抛错（设备掉线等）否则 scriptRunning 永远为 true，之后所有脚本都跑不了
  try {
    for (const line of lines) {
      idx++;
      const m = line.match(/^delay\s+(\d+)$/i);
      if (m) {
        appendOut('#cmd-out', `[${idx}/${lines.length}] 等待 ${m[1]}ms …`);
        await new Promise((res) => setTimeout(res, Math.min(60000, parseInt(m[1]))));
        continue;
      }
      const r = await api.cmdRun(currentSerial, line);
      const out = ((r.out || '') + (r.err || '')).trim();
      appendOut('#cmd-out', `[${idx}/${lines.length}] $ ${line}\n${out || '（成功，无输出）'}`);
      if (r.code !== 0) fail++;
      if (autoDelay) await new Promise((res) => setTimeout(res, 300));
    }
    appendOut('#cmd-out', `✔ 脚本执行完毕${fail ? `（${fail} 条失败）` : ''}`);
    toast(fail ? `脚本执行完毕，${fail} 条失败` : '脚本执行完毕', !!fail);
  } finally {
    scriptRunning = false;
  }
}
$('#btn-script-run').onclick = async () => {
  const content = $('#script-editor').value;
  if (!content.trim()) return toast('脚本内容为空', true);
  let name = curScript;
  if (!name) {
    name = await askScriptName('保存脚本名（回车确定 / Esc 取消，自动补 .bat）');
    if (!name) return;
    if (!/\.(bat|cmd|txt)$/i.test(name)) name += '.bat';
    curScript = name;
    $('#script-name-tag').textContent = '（' + name + '）';
  }
  const r = await api.scriptSave(name, content);
  if (!r.ok) return toast(r.msg, true);
  await runScript(name, content);
};

// ============ ADB终端 ============
function termPrint(text) { appendOut('#term-out', text); }
$('#btn-term-run').onclick = async () => {
  const cmd = $('#term-input').value.trim();
  if (!cmd) return;
  if (SET.termClearOutput) $('#term-out').textContent = '';
  termPrint(`$ adb ${cmd}`);
  if (SET.termClearInput) $('#term-input').value = '';
  const parts = cmd.split(/\s+/);
  // 统一注入 -s：多设备下 install/push/pull 不带 serial 会直接报 "more than one device"。
  // 只有 adb 的 host 级命令不接受 -s（它们不需要 transport）
  const HOST_CMDS = ['pair', 'connect', 'disconnect', 'devices', 'kill-server', 'start-server', 'reconnect', 'version', 'help'];
  const useSerial = currentSerial && !HOST_CMDS.includes(parts[0]);
  const r = await api.adbRun(parts, useSerial ? currentSerial : null);
  termPrint(((r.out || '') + (r.err || '')).trimEnd() || '（无输出）');
};
$('#term-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-term-run').click(); });
$('#btn-term-clear').onclick = () => { $('#term-out').textContent = ''; };

$('#btn-logcat').onclick = async () => {
  if (!needDevice()) return;
  await api.logcatStart(currentSerial);
  toast('日志流已开启');
};
$('#btn-logcat-stop').onclick = async () => { await api.logcatStop(); toast('日志流已停止'); };
$('#btn-logcat-clear').onclick = () => { logBuf = []; $('#logcat-view').textContent = ''; };
let logBuf = [], logRenderPending = false;
function renderLog() {
  if (logRenderPending) return;
  logRenderPending = true;
  requestAnimationFrame(() => {
    logRenderPending = false;
    const kw = ($('#log-filter').value || '').toLowerCase();
    const lines = logBuf.join('\n').split('\n');
    const shown = kw ? lines.filter((l) => l.toLowerCase().includes(kw)) : lines;
    const v = $('#logcat-view');
    v.textContent = shown.join('\n').slice(-60000);
    v.scrollTop = v.scrollHeight;
  });
}
api.onLogcat((chunk) => {
  logBuf.push(chunk);
  if (logBuf.length > 800) logBuf = logBuf.slice(-600);
  renderLog();
});
$('#log-filter').addEventListener('input', renderLog);

// ============ 软件设置 ============
function applyTheme() {
  document.body.classList.toggle('dark', SET.theme === 'dark');
  $('#theme-now').textContent = '当前：' + (SET.theme === 'dark' ? '深邃蓝黑' : '经典蓝');
}
$('#btn-theme').onclick = () => {
  SET.theme = SET.theme === 'dark' ? 'light' : 'dark';
  saveSET(); applyTheme();
  toast('主题已切换');
};
$('#set-startview').value = SET.startView;
$('#btn-set-startview').onclick = () => {
  SET.startView = $('#set-startview').value; saveSET();
  toast('已保存，下次启动进入「' + $('#set-startview option:checked').text + '」');
};
$('#set-cpu').value = SET.cpuInterval;
$('#btn-set-cpu').onclick = () => {
  const v = parseInt($('#set-cpu').value);
  if (isNaN(v) || v < 0) return toast('请输入毫秒数', true);
  SET.cpuInterval = v; saveSET(); startCpuTimer();
  toast(v === 0 ? 'CPU 自动刷新已关闭' : `CPU 频率刷新间隔：${v}ms`);
};
$('#set-pushpath').value = SET.pushPath;
$('#set-downgrade').checked = SET.allowDowngrade;
$('#btn-set-push').onclick = () => {
  SET.pushPath = $('#set-pushpath').value.trim() || '/sdcard/';
  SET.allowDowngrade = $('#set-downgrade').checked;
  saveSET();
  toast('已保存：推送路径 ' + SET.pushPath + (SET.allowDowngrade ? '（允许降级安装）' : ''));
};
$('#set-term-clearin').checked = SET.termClearInput;
$('#set-term-clearout').checked = SET.termClearOutput;
$('#set-term-clearin').addEventListener('change', (e) => { SET.termClearInput = e.target.checked; saveSET(); });
$('#set-term-clearout').addEventListener('change', (e) => { SET.termClearOutput = e.target.checked; saveSET(); });
$('#set-shotpush').checked = SET.shotPush;
$('#set-shotpush').addEventListener('change', (e) => { SET.shotPush = e.target.checked; saveSET(); });

// CPU 频率自动刷新
let cpuTimer = null;
function startCpuTimer() {
  clearInterval(cpuTimer);
  const iv = parseInt(SET.cpuInterval) || 0;
  if (iv <= 0) return;
  cpuTimer = setInterval(async () => {
    if (!currentSerial || !$('#view-home').classList.contains('active')) return;
    const r = await api.cmdRun(currentSerial, 'cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null');
    const cells = $('#cpu-cells');
    if (!cells) return;
    const freqs = (r.out || '').split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
    cells.innerHTML = freqs.length
      ? freqs.map((l, i) => `CPU ${i}: ${(Math.round(parseInt(l) / 1000 * 10) / 10)}MHz`).join('<br>')
      : 'CPU: —';
  }, Math.max(200, iv));
}

// ---------- 启动 ----------
// 全局错误可见化（便于反馈问题）
window.addEventListener('error', (e) => toast('脚本错误: ' + e.message, true));
window.addEventListener('unhandledrejection', (e) => toast('执行异常: ' + (e.reason && e.reason.message ? e.reason.message : e.reason), true));
applyTheme();
$('#term-out').textContent = '当前模式: ADB';
api.adbRun(['devices']).then((r) => termPrint((((r.out || '') + (r.err || '')).trimEnd() || '') + '\n提示：直接输入命令即可执行，如 devices / shell ls /sdcard'));
(async () => {
  const p = await api.getPaths();
  const adbV = await api.adbRun(['version']);
  const adbLine = ((adbV.out || '').split('\n')[0] || '').replace(/Android Debug Bridge version\s*/i, '');
  $('#about-versions').innerHTML =
    `Main: ${p.versions.main}<br>ADB: ${adbLine || '?'}<br>Electron: ${p.versions.electron}<br>Node: ${p.versions.node}`;
})();
refreshDevices();
const devTimer = setInterval(() => refreshDevices(), 4000);
// 窗口卸载时清掉所有轮询定时器（此前从未清理）
window.addEventListener('beforeunload', () => {
  clearInterval(devTimer);
  clearInterval(cpuTimer);
  stopInterTimers();
});
startCpuTimer();
loadScripts();

// ============ 互联 ============
let initedInter = false;
let linkList = [];
let curFileTab = 'recent';
let curDir = '';
let clipWatching = false;
let clipUserStopped = false;   // 用户主动关过：心跳不得自动重启，直到用户手动开启或连上新设备
let clipPulling = false;       // 「从手机读剪贴板」进行中（按钮禁用 + 进度文案）
let focusHintShownAt = 0;      // focusRequired 提示限流时间戳（与主进程双保险，防止每秒刷状态行）
let tapHintShownAt = 0;        // 「请在手机上点一下通知」提示限流时间戳
const CLIP_POLL_MS = 1000;         // 拉取轮询间隔
const CLIP_POLL_TIMEOUT_MS = 15000; // 拉取最长等待
const CLIP_FOCUS_HINT = '手机端后台读不到剪贴板，点「从手机读剪贴板」或让互联桥在前台';
const CLIP_TAP_HINT = '手机端拦下了后台读取，请在手机上点一下通知';
let interHeartbeat = null;   // 心跳：5s ping 当前设备 + 更新设备卡
let fmView = 'grid';          // grid | list
let fmSearchText = '';
let catCache = {};            // 分类 -> 文件数组（用于"最近文件"合并与计数）
let linkOk = false;           // 当前连接是否存活（心跳维护）
let linkLatency = 0;          // 最近一次 ping 延迟 ms

function needLink() {
  if (!currentLink) { toast('请先连接局域网设备', true); return false; }
  return true;
}

/** 配对行：未配对时显示（USB 连接会自动配对，通常看不到） */
function setPairRowVisible() {
  const row = $('#ic-pair-row');
  if (!row) return;
  row.style.display = (currentLink && !currentLink.paired) ? 'flex' : 'none';
}

async function pairWithCode() {
  if (!currentLink) return toast('请先连接设备', true);
  const code = ($('#ic-pair-input').value || '').trim();
  if (!/^[0-9a-fA-F]{32}$/.test(code)) return toast('配对码应为手机 App 上显示的 32 位十六进制', true);
  const r = await api.netPair(currentLink, code);
  if (!r.ok) return toast(r.msg || '配对失败', true);
  currentLink.paired = true;
  $('#ic-pair-input').value = '';
  setPairRowVisible();
  linkOk = true;
  updateLinkUI();
  toast('配对成功，鉴权通道已建立');
  loadFiles(true);
}

/** 单次 ping：返回 {info, latency}，失败返回 null */
async function pingOnce(link) {
  const start = Date.now();
  try {
    const r = await fetch(`http://${link.ip}:${link.port}/ping`, { method: 'GET', signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const j = await r.json();
    return { info: j, latency: Date.now() - start };
  } catch { return null; }
}

/** 刷新四个分类的 tab 计数（0 显示为空） */
function setCatCounts() {
  $('#cnt-images').textContent = (catCache.images || []).length || '';
  $('#cnt-videos').textContent = (catCache.videos || []).length || '';
  $('#cnt-music').textContent = (catCache.music || []).length || '';
  $('#cnt-docs').textContent = (catCache.docs || []).length || '';
}

async function initInterconnect() {
  if (!initedInter) {
    initedInter = true;
    // 绑定一次性事件
    $('#link-mode').value = SET.linkMode || 'auto';
    $('#link-mode').addEventListener('change', (e) => { SET.linkMode = e.target.value; saveSET(); toast('连接方式：' + e.target.selectedOptions[0].text.replace('连接方式：', '')); });
    $('#btn-link-scan').onclick = scanLinks;
    $('#btn-link-disconnect').onclick = async () => { await api.netDisconnect(); currentLink = null; linkOk = false; updateLinkUI(); };
    $('#btn-link-refresh').onclick = async () => {
      // 手动刷新：ping + 刷新文件 + 重试自动连接
      const btn = $('#btn-link-refresh');
      btn.disabled = true; btn.textContent = '刷新中…';
      try {
        if (currentLink) {
          // 手动 ping 一次
          const p = await pingOnce(currentLink);
          if (p) {
            linkLatency = p.latency;
            linkOk = true;
            if (p.info.fg !== undefined) currentLink.fg = p.info.fg;
          } else { linkOk = false; }
          updateLinkUI();
          // 刷新文件列表
          await loadFiles(true);
          toast(linkOk ? `已刷新 · ${linkLatency}ms` : '连接异常，已刷新文件', !linkOk);
        } else {
          // 无连接 → 尝试自动连接
          const link = await api.netAutoconnect(SET.linkMode || 'auto');
          if (link) { currentLink = link; linkOk = true; updateLinkUI(); await loadFiles(true); toast(`已连接: ${link.name}`); }
          else toast('未找到设备', true);
        }
      } finally {
        btn.disabled = false; btn.textContent = '⟳ 刷新';
      }
    };
    $('#link-select').addEventListener('change', async (e) => {
      const key = e.target.value;
      if (!key) { currentLink = null; updateLinkUI(); return; }
      const dev = linkList.find((d) => (d.ip + '|' + (d.port||35791) + '|' + (d.usb?'usb':'lan')) === key);
      if (!dev) return;
      const r = await api.netConnect(dev.ip, dev.port, { usb: !!dev.usb, serial: dev.serial });
      if (r.ok) { currentLink = r.link; clipUserStopped = false; toast(`已连接 ${currentLink.name}`); updateLinkUI(); }
      else toast(r.msg, true);
    });

    // 超级剪贴板：点击卡片开关
    $('#btn-ic-pair').onclick = pairWithCode;
    $('#ic-pair-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') pairWithCode(); });
    // 401：不得静默重试，直接让用户输入配对码
    api.onNetUnauthorized(() => {
      toast('设备要求配对码：请输入手机 App 上显示的 32 位配对码', true);
      if ($('#ic-dev-sub')) $('#ic-dev-sub').textContent = '需要配对：请输入手机 App 上显示的配对码';
      setPairRowVisible();
    });

    $('#card-clip').onclick = toggleClipWatch;
    $('#btn-clip-pull').onclick = async () => {
      if (!needLink()) return;
      const r = await api.clipboardGet(currentLink);
      if (!r) return toast('拉取失败', true);
      applyRemoteClipboard(r, true);
      toast('已拉取');
    };
    $('#btn-clip-pull-focus').onclick = pullClipFromPhone;
    $('#btn-clip-push').onclick = async () => {
      if (!needLink()) return;
      const r = await api.clipboardSet(currentLink, null);
      toast(r.ok ? '已推送' : '推送失败', !r.ok);
    };

    // 屏幕镜像：点击卡片 = 开始/停止
    $('#card-mirror').onclick = () => $('#btn-mirror-start').click();
    $('#btn-mirror-start').onclick = async () => {
      const serial = $('#mirror-serial').value;
      if (!serial) return toast('请先选择 USB/无线调试设备', true);
      const r = await api.mirrorStart(serial, true);
      toast(r.msg, !r.ok);
      if (r.ok) { $('#btn-mirror-start').disabled = true; $('#btn-mirror-stop').disabled = false; $('#mirror-state').textContent = '镜像中… Ctrl+C 退出'; }
    };
    $('#btn-mirror-stop').onclick = async () => {
      const r = await api.mirrorStop();
      toast(r.msg, !r.ok);
      $('#btn-mirror-start').disabled = false; $('#btn-mirror-stop').disabled = true;
      $('#mirror-state').textContent = '将手机屏幕投到电脑';
    };

    // 文件分类侧栏（切换即强制刷新 + 弹入动画）
    $$('.fm-cat').forEach((c) => {
      c.onclick = () => {
        $$('.fm-cat').forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
        curFileTab = c.dataset.tab;
        curDir = '';
        fmSearchText = '';
        $('#fm-search').value = '';
        $('#btn-files-up').disabled = true;
        loadFiles(true);
        const fl = $('#files-list');
        fl.classList.remove('zian-fm-in');
        void fl.offsetWidth; // 重启动画
        fl.classList.add('zian-fm-in');
      };
    });
    // 视图切换
    $('#btn-view-grid').onclick = () => { fmView = 'grid'; $('#btn-view-grid').classList.add('active'); $('#btn-view-list').classList.remove('active'); renderFiles(); };
    $('#btn-view-list').onclick = () => { fmView = 'list'; $('#btn-view-list').classList.add('active'); $('#btn-view-grid').classList.remove('active'); renderFiles(); };
    // 搜索
    $('#fm-search').addEventListener('input', (e) => { fmSearchText = e.target.value.trim().toLowerCase(); renderFiles(); });
    $('#btn-files-refresh').onclick = () => loadFiles(true);
    $('#btn-files-up').onclick = () => {
      if (!curDir) return;
      curDir = curDir.replace(/\/[^/]+\/?$/, '') || '';
      $('#btn-files-up').disabled = !curDir;
      loadFiles();
    };
    $('#btn-files-push').onclick = async () => {
      if (!needLink()) return;
      const remoteDir = curFileTab === 'storage' ? (curDir || '/sdcard') : '/sdcard/Download';
      const paths = await api.pickFiles();
      if (!paths || !paths.length) return;
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop();
        const r2 = await api.filesPush(currentLink, p, remoteDir);
        toast(r2.ok ? `已推送: ${name}` : '推送失败: ' + r2.msg, !r2.ok);
      }
      loadFiles(true);
    };

    api.onFilesProgress((pct) => {
      $('#files-progress-bar').classList.remove('hidden');
      $('#files-progress-fill').style.width = pct + '%';
      if (pct >= 100) setTimeout(() => $('#files-progress-bar').classList.add('hidden'), 800);
    });
    api.onClipboardRemote((p) => applyRemoteClipboard(p, false)); // 静默同步，不弹提示
    api.onClipboardFocusRequired(() => showFocusRequiredHint()); // 主进程已限流，这里再兜一层
    api.onClipboardTapRequired(() => showTapRequiredHint());
    api.onNetAutoconnected((link) => {
      currentLink = link;
      clipUserStopped = false;
      updateLinkUI();
      toast(`自动连接: ${link.name}`);
    });
    // USB 通道断线自动重连
    let usbReconnecting = false;
    api.onNetLinkState((s) => {
      if (s.state === 'reconnecting' && !usbReconnecting) {
        usbReconnecting = true;
        toast('USB 通道断开，正在自动重连…', true);
        if ($('#ic-dev-sub')) $('#ic-dev-sub').textContent = 'USB 通道断开，自动重连中…';
      }
    });
    api.onNetReconnected((link) => {
      usbReconnecting = false;
      const wasLost = !!link;
      currentLink = link || currentLink;
      clipUserStopped = false;
      updateLinkUI();
      if (wasLost) {
        toast(`USB 通道已恢复（${currentLink.name || '设备'}）`);
        if ($('#view-interconnect').classList.contains('active')) loadFiles(true);
      }
    });

    // 悬停信息浮层跟随鼠标，太靠边时自动翻到光标另一侧
    const tip = $('#fm-tip');
    $('#files-list').addEventListener('mousemove', (e) => {
      const item = e.target.closest('[data-meta]');
      if (!item) { tip.classList.add('hidden'); return; }
      if (!fillTip(tip, item.dataset.meta)) { tip.classList.add('hidden'); return; }
      tip.classList.remove('hidden');
      const margin = 6, pad = 12;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      // 水平：右侧空间不够 → 翻到光标左侧；否则保持右侧；再加两侧下限
      let x = e.clientX + margin;
      if (x + tw + pad > window.innerWidth) x = e.clientX - margin - tw;
      x = Math.max(pad, Math.min(x, window.innerWidth - tw - pad));
      // 垂直：底部空间不够 → 翻到光标上方；否则保持下方；再加两侧下限
      let y = e.clientY + margin;
      if (y + th + pad > window.innerHeight) y = e.clientY - margin - th;
      y = Math.max(pad, Math.min(y, window.innerHeight - th - pad));
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    $('#files-list').addEventListener('mouseleave', () => tip.classList.add('hidden'));
    // 缩略图加载失败 → 优先走主进程代理（直连 <img> 无法带 X-Zian-Token），再退回文件图标
    $('#files-list').addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || !img.parentNode) return;
      const fallback = () => { if (img.dataset.fb && img.parentNode) img.parentNode.textContent = img.dataset.fb; };
      if (currentLink && currentLink.paired && img.dataset.path && !img.dataset.ipc) {
        img.dataset.ipc = '1';
        api.filesThumb(currentLink, img.dataset.path).then((r) => {
          if (r && r.ok && r.dataUrl) img.src = r.dataUrl; else fallback();
        }).catch(fallback);
        return;
      }
      fallback();
    }, true);

    // 镜像设备下拉同步主下拉（随设备轮询刷新）
    syncMirrorSelect();

    // 投屏窗口关闭（用户点 X 或 Ctrl+C）→ 自动刷新 UI（只注册一次）
    api.onMirrorStopped(() => {
      $('#btn-mirror-start').disabled = false;
      $('#btn-mirror-stop').disabled = true;
      $('#mirror-state').textContent = '将手机屏幕投到电脑';
      toast('镜像已关闭');
      // 刷新连接状态（投屏退出后 adb 可能恢复）
      updateLinkUI();
    });
  }

  // 进入页面时刷新一次（按当前连接方式自动连接）
  if (!currentLink) {
    const link = await api.netAutoconnect(SET.linkMode || 'auto');
    if (link) { currentLink = link; toast(`已自动连接: ${link.name}`); }
  }
  updateLinkUI();
  // 进入互联页时并行加载所有分类（让各 tab 计数立即有值）
  if (currentLink && !Object.keys(catCache).length) {
    // 先加载当前 tab（立刻出内容）
    loadFiles(true);
    // 再并行加载其他分类补全计数
    Promise.all(['images', 'videos', 'music', 'docs'].map(async (t) => {
      if (!catCache[t]) {
        try {
          const res = await api.filesList(currentLink, t, '');
          if (Array.isArray(res)) catCache[t] = res;
        } catch {}
      }
    })).then(setCatCounts);
  }

  // 启动互联页实时刷新
  startInterTimers();
}

// ============ 实时刷新定时器 ============
function startInterTimers() {
  stopInterTimers();
  // 心跳：5s ping + 更新设备卡状态 + 自动开剪贴板
  interHeartbeat = setInterval(async () => {
    if (!$('#view-interconnect').classList.contains('active') || !currentLink) {
      linkOk = false; updateLinkUI(); return;
    }
    const p = await pingOnce(currentLink);
    if (p) {
      linkLatency = p.latency;
      linkOk = true;
      // 同步 fg 状态到 currentLink
      if (p.info.fg !== undefined) currentLink.fg = p.info.fg;
    } else { linkOk = false; }
    updateLinkUI();
    // 自动开剪贴板：连接存活 + 还没开 + 没被用户主动关过 → 静默开启
    if (linkOk && !clipWatching && !clipUserStopped) {
      try { await api.clipboardWatchStart(); clipWatching = true; $('#clip-state').textContent = '每秒自动同步中'; }
      catch {}
    }
  }, 5000);
}

function stopInterTimers() {
  if (interHeartbeat) { clearInterval(interHeartbeat); interHeartbeat = null; }
}

function syncMirrorSelect() {
  const sel = $('#mirror-serial');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = devList.length
    ? devList.filter((d) => d.state === 'device').map((d) => `<option value="${esc(d.serial)}" ${d.serial === cur ? 'selected' : ''}>${esc((d.model || d.serial))} · ${esc(d.serial)}</option>`).join('') || '<option value="">无在线设备</option>'
    : '<option value="">无设备</option>';
}

async function scanLinks() {
  const mode = SET.linkMode || 'auto';
  toast(mode === 'usb' ? '正在通过 USB 数据线连接…' : '扫描中（最多 30 秒）…');
  let list = [];
  if (mode === 'usb') {
    const r = await api.netConnect(null, null, { usb: true });
    if (r.ok) { currentLink = r.link; clipUserStopped = false; linkList = [currentLink]; updateLinkUI(); toast(`已连接: ${currentLink.name}（USB 通道）`); return; }
    toast(r.msg, true);
    linkList = [];
  } else {
    list = (await api.netScan(30000)) || [];
    if (mode === 'lan') list = list.filter((d) => !d.usb);
    linkList = list;
  }
  const sel = $('#link-select');
  sel.innerHTML = linkList.length
    ? linkList.map((d) => {
        const key = d.ip + '|' + (d.port||35791) + '|' + (d.usb?'usb':'lan');
        const display = d.usb
          ? `${d.name || ''} · USB（127.0.0.1）`
          : `${d.name || ''} · ${d.ip}`;
        return `<option value="${esc(key)}">${esc(display)}</option>`;
      }).join('')
    : '<option value="">未发现设备</option>';
  if (linkList.length === 1) {
    const dev = linkList[0];
    const r = await api.netConnect(dev.ip, dev.port, { usb: !!dev.usb, serial: dev.serial });
    if (r.ok) { currentLink = r.link; clipUserStopped = false; toast(`已连接: ${currentLink.name}`); updateLinkUI(); }
    else toast(r.msg, true);
  } else {
    toast(linkList.length ? `发现 ${linkList.length} 台设备` : '未发现设备（请确认手机已打开「梓安互联桥」，或改用 USB 数据线连接）', !linkList.length);
  }
}

function updateLinkUI() {
  const nameEl = $('#ic-dev-name'), subEl = $('#ic-dev-sub'), metaEl = $('#ic-dev-meta');
  if (!nameEl) return;
  if (!currentLink) {
    nameEl.innerHTML = '未连接设备';
    subEl.textContent = '点击「扫描」发现手机（局域网或 USB 数据线均可，≤30 秒自动连接）';
    metaEl.classList.remove('show');
    setPairRowVisible();
    return;
  }
  const l = currentLink;
  const modeTag = l.usb || l.mode === 'usb' ? 'USB 连接' : '局域网连接';
  // 心跳状态指示
  const statusDot = linkOk
    ? `<span class="ic-stat ok" title="连接正常 · ${linkLatency}ms">●</span>`
    : `<span class="ic-stat bad" title="连接已断开">●</span>`;
  nameEl.innerHTML = `${esc(l.name || '未知设备')}<span class="ic-linktag">${modeTag}</span>${statusDot}`;
  subEl.textContent = (l.usb || l.mode === 'usb')
    ? 'USB 数据线通道 · adb 端口转发 · 稳定不掉线'
    : '局域网直连 · 传输速率可达百兆';
  metaEl.innerHTML =
    `<span>设备：<b>${esc(l.model || l.name || '—')}</b></span><span>IP：<b>${esc(l.ip)}</b></span>` +
    `<span>品牌：<b>${esc(l.brand || '—')}</b></span><span>系统：<b>${l.android ? 'Android ' + esc(l.android) : '—'}</b></span>` +
    `<span>端口：<b>${esc(String(l.port))}</b></span><span>版本：<b>${esc(l.ver || '—')}</b></span>` +
    (linkOk ? `<span>延迟：<b>${linkLatency}ms</b></span>` : `<span class="link-bad">● 连接断开</span>`);
  metaEl.classList.add('show');
  setPairRowVisible();
}

async function toggleClipWatch() {
  if (clipWatching) {
    await api.clipboardWatchStop();
    clipWatching = false;
    clipUserStopped = true;
    $('#clip-state').textContent = '未开启 · 点击开启';
    toast('已停止剪贴板同步');
  } else {
    if (!needLink()) return;
    await api.clipboardWatchStart();
    clipWatching = true;
    clipUserStopped = false;
    $('#clip-state').textContent = '每秒自动同步中';
    toast('已开启剪贴板自动同步（每秒）');
  }
}

/** focusRequired：手机端后台读不到剪贴板，状态行提示一次，60s 内不再重复 */
function showFocusRequiredHint() {
  if (Date.now() - focusHintShownAt < 60000) return false;
  focusHintShownAt = Date.now();
  const el = $('#clip-state');
  if (el) el.textContent = CLIP_FOCUS_HINT;
  return true;
}

/** 手机端拦下了直接拉起（只能人工点通知）：状态行提示一次，60s 内不再重复 */
function showTapRequiredHint() {
  if (Date.now() - tapHintShownAt < 60000) return false;
  tapHintShownAt = Date.now();
  const el = $('#clip-state');
  if (el) el.textContent = CLIP_TAP_HINT;
  return true;
}

/** 「📥 从手机读剪贴板」：请手机发通知 → 每 1s 轮询最多 15s → 拿到内容就写回本机剪贴板 */
async function pullClipFromPhone() {
  if (clipPulling) return;
  if (!needLink()) return;
  const btn = $('#btn-clip-pull-focus');
  const oldLabel = btn ? btn.textContent : '';
  clipPulling = true;
  if (btn) { btn.disabled = true; btn.textContent = '📥 已请求，等待手机…'; }
  try {
    const req = await api.clipboardPull(currentLink);
    if (!req || !req.ok) { toast((req && req.msg) || '请求失败：设备无响应', true); return; }
    focusHintShownAt = Date.now();   // 已主动发起，本轮不再弹 focusRequired 提示
    // 直接拉起被系统拦下：用户只能点通知，先明确告知，再继续等（15s 内点到仍会成功）
    if (req.launched === false && btn) { toast('请在手机上点一下通知', true); btn.textContent = '📥 请在手机上点一下通知…'; }
    const deadline = Date.now() + CLIP_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, CLIP_POLL_MS));
      if (btn) btn.textContent = '📥 等待手机…';
      const r = await api.clipboardGet(currentLink);
      if (!r || !r.type || r.type === 'empty') continue;
      const applied = await api.clipboardApplyRemote(r);
      applyRemoteClipboard(r, false);
      // 手机端在后台读不到时返回的是借焦点读到的缓存（TTL 60s），如实标注
      const tag = r.cached ? '（来自手机缓存）' : '';
      if (applied && applied.ok) toast('已从手机读回剪贴板' + tag);
      else toast('手机端有新内容，但写回本机剪贴板失败' + tag, true);
      return;
    }
    toast('请在手机上点一下通知', true);
  } finally {
    clipPulling = false;
    if (btn) { btn.disabled = false; btn.textContent = oldLabel; }
  }
}

function applyRemoteClipboard(p, fromPull) {
  const prev = $('#clip-preview');
  if (!p || p.type === 'empty') {
    prev.innerHTML = '<span class="hint">手机剪贴板为空</span>';
    return;
  }
  if (p.type === 'text') {
    let text = p.data;
    if (typeof text === 'string' && /^[A-Za-z0-9+/=]+$/.test(text)) {
      try { text = decodeURIComponent(escape(atob(text))); } catch {}
    }
    prev.innerHTML = `<div class="clip-text" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(text.slice(0, 300))}</div>`;
    // 静默同步：仅拉取按钮触发时提示
    if (fromPull) toast('已拉取手机剪贴板');
  } else if (p.type === 'image') {
    // mime 来自手机端，不可信：拼进 innerHTML 能注入属性/事件处理器，这里改为 DOM 赋值。
    // 畸形 mime 统一按 png 处理（原本也只会得到一张坏图）
    const mime = /^image\/[a-z0-9.+-]+$/i.test(p.mime || '') ? p.mime : 'image/png';
    const img = document.createElement('img');
    img.alt = '剪贴板图片';
    img.src = 'data:' + mime + ';base64,' + (p.data || '');
    prev.textContent = '';
    prev.appendChild(img);
    if (fromPull) toast('已拉取手机剪贴板图片');
  }
}

// 拉取分类列表（force=true 重新请求；"recent" 合并 images+videos）
async function loadFiles(force = false) {
  if (!currentLink) { $('#files-list').innerHTML = '<div class="hint">请先连接设备</div>'; return; }
  if (curFileTab === 'storage') {
    // 手机存储：目录浏览，不缓存
    if (force || !catCache[curDir || '/']) {
      $('#files-list').innerHTML = '<div class="hint">加载中…</div>';
      const res = await api.filesList(currentLink, 'storage', curDir);
      if (!Array.isArray(res)) {
        $('#files-list').innerHTML = '<div class="hint">加载失败：设备无响应（请保持手机「梓安互联桥」在前台）· 点击「刷新」重试</div>';
        return;
      }
      catCache[curDir || '/'] = res;
    }
    renderFiles(catCache[curDir || '/'], false);
    return;
  }
  const tabs = curFileTab === 'recent' ? ['images', 'videos'] : [curFileTab];
  if (force) tabs.forEach((t) => { delete catCache[t]; });
  const missing = tabs.filter((t) => !catCache[t]);
  if (missing.length) {
    $('#files-list').innerHTML = '<div class="hint">加载中…</div>';
    let failed = false;
    await Promise.all(missing.map(async (t) => {
      const res = await api.filesList(currentLink, t, '');
      if (!Array.isArray(res)) { failed = true; return; } // null=失败，不缓存
      catCache[t] = res;
    }));
    if (failed) {
      $('#files-list').innerHTML = '<div class="hint">加载失败：设备无响应（请保持手机「梓安互联桥」在前台）· 点击「刷新」重试</div>';
      return;
    }
  }
  // 计数
  setCatCounts();
  // 组装当前列表
  let list;
  if (curFileTab === 'recent') {
    list = [...(catCache.images || []), ...(catCache.videos || [])]
      .sort((a, b) => (b.modified || 0) - (a.modified || 0)).slice(0, 120);
  } else {
    list = catCache[curFileTab] || [];
  }
  renderFiles(list, curFileTab !== 'storage');
}

// 已配对设备的缩略图统一走主进程代理（一次一张，最多 4 路并发）
async function loadThumbsViaIpc() {
  if (!currentLink || !currentLink.paired) return;
  const queue = [...document.querySelectorAll('#files-list img[data-ipc="1"]')];
  const worker = async () => {
    while (queue.length) {
      const img = queue.shift();
      if (!img || !img.dataset.path) continue;
      const r = await api.filesThumb(currentLink, img.dataset.path);
      if (r && r.ok && r.dataUrl) { img.src = r.dataUrl; continue; }
      if (img.parentNode) img.parentNode.textContent = img.dataset.fb || '📦';
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// 渲染（分组 + 网格/列表 + 搜索过滤）
function renderFiles(list, groupByDate) {
  const box = $('#files-list');
  if (!Array.isArray(list)) { box.innerHTML = '<div class="hint">无内容</div>'; return; }
  let items = list;
  if (fmSearchText) items = items.filter((it) => it.name.toLowerCase().includes(fmSearchText));
  if (!items.length) { box.innerHTML = `<div class="hint">${fmSearchText ? '无匹配文件' : '无内容'}</div>`; return; }
  const isImg = (n) => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(n);
  const isVid = (n) => /\.(mp4|mkv|avi|mov|3gp|webm)$/i.test(n);
  const icon = (it) => it.dir ? '📁' : (
    isImg(it.name) ? '🖼️' : isVid(it.name) ? '🎬' :
    /\.(mp3|flac|wav|aac|ogg|m4a)$/i.test(it.name) ? '🎵' :
    /\.(doc|docx|xls|xlsx|ppt|pptx|pdf|txt|md|csv|wps|et|dps|epub)$/i.test(it.name) ? '📄' : '📦'
  );
  const thumbURL = (it) => `http://${currentLink.ip}:${currentLink.port}/thumb?path=${encodeURIComponent(it.path)}`;
  // 已配对设备（鉴权生效）：<img> 无法带 X-Zian-Token，直连必然 401，直接走 IPC 代理，省掉注定失败的一跳
  const thumbTag = (it) => {
    const p = esc(it.path);
    const fb = icon(it);
    return (currentLink && currentLink.paired)
      ? `<img data-path="${p}" data-ipc="1" loading="lazy" decoding="async" data-fb="${fb}" alt="">`
      : `<img src="${thumbURL(it)}" data-path="${p}" loading="lazy" decoding="async" data-fb="${fb}">`;
  };
  // 浮层数据以 JSON 存进属性（esc 转义后无法破坏属性），读回后交给 fillTip 用 DOM 拼装。
  // 绝不把 dataset 内容当 HTML 插入：手机端文件名可含任意 HTML
  const meta = (it) => esc(JSON.stringify({
    n: it.name,
    s: it.dir ? '目录' : formatSize(it.size),
    m: fmtDate(it.modified, true),
    p: it.path
  }));
  // 网格 / 列表共用同一份模板，仅外层 class 与标签名不同
  const itemHtml = (it, view) => {
    const grid = view === 'grid';
    const tag = grid ? 'div' : 'span';
    const thumb = (isImg(it.name) || isVid(it.name)) && !it.dir ? thumbTag(it) : icon(it);
    return `<div class="${grid ? 'fm-item' : 'fm-row'}" data-path="${esc(it.path)}" data-dir="${it.dir ? 1 : 0}" data-name="${esc(it.name)}" data-meta="${meta(it)}">
      <div class="fm-thumb">${thumb}</div>
      <${tag} class="fm-name">${esc(it.name)}</${tag}>
      ${grid && it.dir ? '' : `<${tag} class="fm-size">${it.dir ? '' : formatSize(it.size)}</${tag}>`}
      ${grid ? '' : `<span class="fm-date">${fmtDate(it.modified)}</span>`}
    </div>`;
  };
  const bind = () => {
    $$('#files-list [data-path]').forEach((el) => {
      el.onclick = async (ev) => {
        if (el.dataset.dir === '1') {
          curDir = el.dataset.path;
          $('#btn-files-up').disabled = false;
          loadFiles();
          return;
        }
        // 文件：默认下载
        const r = await api.filesPull(currentLink, el.dataset.path, '');
        toast(r.ok ? `已下载: ${r.msg}` : '下载失败: ' + r.msg, !r.ok);
        if (r.ok) api.openPath(r.msg);
      };
      el.oncontextmenu = (ev) => {
        // 右键：文档可用 vivo 办公套件打开
        ev.preventDefault();
        if (/\.(doc|docx|xls|xlsx|ppt|pptx|pdf|txt)$/i.test(el.dataset.name)) {
          api.filesOpenInVivo(currentLink, el.dataset.path).then((r) =>
            toast(r.ok ? '已在 vivo 办公套件打开' : '打开失败（可能未安装）', !r.ok));
        } else {
          toast('右键打开仅支持文档类文件（vivo 办公套件）');
        }
      };
    });
    // 已配对设备：缩略图走 IPC 代理（直连 <img> 带不了鉴权头）
    loadThumbsViaIpc();
  };
  if (!groupByDate) {
    // 手机存储：目录在前，不分组
    const sorted = [...items.filter((i) => i.dir), ...items.filter((i) => !i.dir)];
    box.innerHTML = `<div class="${fmView === 'grid' ? 'fm-grid' : 'fm-rows'}">${sorted.map((it) => itemHtml(it, fmView)).join('')}</div>`;
    bind();
    return;
  }
  // 按日期分组
  const groups = new Map();
  for (const it of items) {
    const g = fmtDate(it.modified);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  let html = '';
  for (const [g, arr] of groups) {
    html += `<div class="fm-group-title">${esc(g)}</div>`;
    html += `<div class="${fmView === 'grid' ? 'fm-grid' : 'fm-rows'}">${arr.map((it) => itemHtml(it, fmView)).join('')}</div>`;
  }
  box.innerHTML = html;
  bind();
}

function fmtDate(ts, withTime = false) {
  if (!ts) return '—';
  // 手机返回秒级时间戳则转毫秒
  let ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  const dateStr = `${d.getMonth() + 1}月${d.getDate()}日`;
  const label = diff === 0 ? `今天 · ${dateStr}` : diff === 1 ? `昨天 · ${dateStr}` : `${dateStr}`;
  if (!withTime) return label;
  return `${label} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!bytes) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(v < 10 ? 1 : 0) + ' ' + u[i];
}

// ---------- 默认启动页 ----------
// 必须放在所有 let/const 声明之后执行：这里会同步触发视图切换（互联页会立刻调用
// initInterconnect），在模块求值途中点击会撞上 initedInter 等声明的 TDZ，抛 ReferenceError
const startBtn = document.querySelector(`.nav-item[data-view="${SET.startView}"]`);
if (startBtn && SET.startView !== 'home') startBtn.click();
