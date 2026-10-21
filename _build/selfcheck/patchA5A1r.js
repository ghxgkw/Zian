const fs = require('fs');
const R = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/renderer.js';
const H = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/index.html';
let bad = 0;
function readEol(f) { const b = fs.readFileSync(f, 'utf8'); return b.indexOf('\r\n') >= 0 ? '\r\n' : '\n'; }
function load(f) { return fs.readFileSync(f, 'utf8').split('\r\n').join('\n'); }
function save(f, s, eol) { fs.writeFileSync(f, s.split('\n').join(eol)); }
function rep(name, s, a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.log('FAIL ' + name + ' matches=' + n); bad++; return s; }
  console.log('OK   ' + name);
  return s.replace(a, () => b);
}
function splice(name, s, startMark, endMark, newLines) {
  const lines = s.split('\n');
  const i = lines.indexOf(startMark);
  if (i < 0) { console.log('FAIL ' + name + ' start-miss'); bad++; return s; }
  const j = lines.indexOf(endMark, i);
  if (j < 0) { console.log('FAIL ' + name + ' end-miss'); bad++; return s; }
  console.log('OK   ' + name + ' (lines ' + (i + 1) + '-' + (j + 1) + ' -> ' + newLines.length + ')');
  lines.splice(i, j - i + 1, ...newLines);
  return lines.join('\n');
}
function insertAfter(name, s, marker, newLines) {
  const lines = s.split('\n');
  const i = lines.findIndex((l) => l.indexOf(marker) >= 0);
  if (i < 0 || lines.filter((l) => l.indexOf(marker) >= 0).length !== 1) { console.log('FAIL ' + name); bad++; return s; }
  console.log('OK   ' + name + ' (after line ' + (i + 1) + ')');
  lines.splice(i + 1, 0, ...newLines);
  return lines.join('\n');
}

const eolR = readEol(R), eolH = readEol(H);
let r = load(R);
r = splice('A5-gapps-block', r, 'async function gappsBatch(disable) {', "$('#btn-gapps-enable').onclick = () => gappsBatch(false);", ["// 本应用禁用过的 Google 组件清单：跨重启保留（否则重启后无法一键恢复），","// 存 localStorage 与 SET 同机制——不加新文件、不需要额外权限，随用户配置一起走","const GAPPS_DISABLED_KEY = 'zian_disabled_gapps';","function loadDisabledGapps() {","  try {","    const v = JSON.parse(localStorage.getItem(GAPPS_DISABLED_KEY) || '[]');","    return Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p) : [];","  } catch { return []; }","}","function saveDisabledGapps(arr) {","  try {","    const uniq = [...new Set(arr)];","    if (uniq.length) localStorage.setItem(GAPPS_DISABLED_KEY, JSON.stringify(uniq));","    else localStorage.removeItem(GAPPS_DISABLED_KEY);","  } catch {}","  setRestoreBtn();","}","function setRestoreBtn() {","  const btn = $('#btn-gapps-restore');","  if (!btn) return;","  const n = loadDisabledGapps().length;","  btn.disabled = !n;","  btn.textContent = n ? '批量恢复（' + n + '）' : '批量恢复';","}","/** 禁用前的确认文案：逐行列出完整包名 + 影响提示 */","function gappsDisableConfirm(pkgs) {","  return [","    '即将禁用 ' + pkgs.length + ' 个 Google 系统组件：',","    '',","    pkgs.join('\\n'),","    '',","    '影响：这些组件在手机上停止运行；禁用 GMS/GSF/商店 后，依赖 Google 服务的应用可能闪退或提示「设备不支持」。',","    '本应用会记住这次禁用的清单，可用「批量恢复」一键启用回来。',","    '',","    '确认继续？'","  ].join('\\n');","}","async function gappsBatch(disable) {","  if (!needDevice()) return;","  const checked = $$('#gapps-grid input:checked');","  if (!checked.length) return toast('请先勾选要操作的套件', true);","  const pkgs = [...checked].map((c) => c.dataset.gapp);","  if (disable && !confirm(gappsDisableConfirm(pkgs))) return toast('已取消，未执行任何操作');","  const cmd = disable ? 'pm disable-user --user 0' : 'pm enable';","  const results = [];","  const doneOk = [];","  for (const pkg of pkgs) {","    const r = await api.cmdRun(currentSerial, cmd + ' ' + pkg);","    const out = ((r.out || '') + (r.err || '')).trim();","    const ok = r.code === 0 && !/Exception|Failure|Error|not found/i.test(out);","    if (ok) doneOk.push(pkg);","    results.push(pkg + ': ' + (out.split('\\n').pop() || (ok ? (disable ? '已禁用' : '已启用') : '失败')));","  }","  if (disable) saveDisabledGapps(loadDisabledGapps().concat(doneOk));","  else saveDisabledGapps(loadDisabledGapps().filter((p) => doneOk.indexOf(p) < 0));","  appLog('[Google套件' + (disable ? '禁用' : '启用') + ']\\n' + results.join('\\n'));","  toast('批量操作完成（成功 ' + doneOk.length + '/' + pkgs.length + '），详见操作记录', doneOk.length !== pkgs.length);","}","$('#btn-gapps-disable').onclick = () => gappsBatch(true);","$('#btn-gapps-enable').onclick = () => gappsBatch(false);","$('#btn-gapps-restore').onclick = async () => {","  if (!needDevice()) return;","  const list = loadDisabledGapps();","  if (!list.length) return toast('没有本应用禁用过的组件需要恢复', true);","  if (!confirm('将重新启用本应用禁用过的 ' + list.length + ' 个组件：\\n\\n' + list.join('\\n') + '\\n\\n确认继续？')) return;","  const r = await api.gappsRestore(currentSerial, list);","  const rows = Array.isArray(r.results) ? r.results : [];","  appLog('[Google套件批量恢复]\\n' + rows.map((x) => x.pkg + ': ' + (x.ok ? '已启用' : '失败 · ' + x.msg)).join('\\n'));","  // 只清掉真正恢复成功的；失败的留在清单里，用户还能再点一次","  saveDisabledGapps(rows.filter((x) => !x.ok).map((x) => x.pkg));","  const okCount = rows.filter((x) => x.ok).length;","  toast('恢复完成：成功 ' + okCount + '/' + rows.length + (okCount < rows.length ? '，失败 ' + (rows.length - okCount) : ''), okCount !== rows.length);","};","setRestoreBtn();"]);
r = insertAfter('A1-pair-helpers', r, 'function needLink() {', ["/** 配对行：未配对时显示（USB 连接会自动配对，通常看不到） */","function setPairRowVisible() {","  const row = $('#ic-pair-row');","  if (!row) return;","  row.style.display = (currentLink && !currentLink.paired) ? 'flex' : 'none';","}","async function pairWithCode() {","  if (!currentLink) return toast('请先连接设备', true);","  const code = ($('#ic-pair-input').value || '').trim();","  if (!/^[0-9a-fA-F]{32}$/.test(code)) return toast('配对码应为手机 App 上显示的 32 位十六进制', true);","  const r = await api.netPair(currentLink, code);","  if (!r.ok) return toast(r.msg || '配对失败', true);","  currentLink.paired = true;","  $('#ic-pair-input').value = '';","  setPairRowVisible();","  linkOk = true;","  updateLinkUI();","  toast('配对成功，鉴权通道已建立');","  loadFiles(true);","}",""]);
r = insertAfter('A1-pair-bind', r, '    // 超级剪贴板：点击卡片开关', ["    $('#btn-ic-pair').onclick = pairWithCode;","    $('#ic-pair-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') pairWithCode(); });","    // 401：不得静默重试，直接让用户输入配对码","    api.onNetUnauthorized(() => {","      toast('设备要求配对码：请输入手机 App 上显示的 32 位配对码', true);","      if ($('#ic-dev-sub')) $('#ic-dev-sub').textContent = '需要配对：请输入手机 App 上显示的配对码';","      setPairRowVisible();","    });",""]);
r = rep('A1-updateLinkUI-empty', r, '    metaEl.classList.remove(\'show\');\n    return;', '    metaEl.classList.remove(\'show\');\n    setPairRowVisible();\n    return;');
r = rep('A1-updateLinkUI-show', r, '  metaEl.classList.add(\'show\');\n}', '  metaEl.classList.add(\'show\');\n  setPairRowVisible();\n}');
r = rep('A1-thumb-fallback', r, "    // 缩略图加载失败 → 回退为文件图标（原为内联 onerror，CSP 禁用内联脚本后改事件委托）\n    $('#files-list').addEventListener('error', (e) => {\n      const img = e.target;\n      if (img && img.tagName === 'IMG' && img.dataset.fb && img.parentNode) img.parentNode.textContent = img.dataset.fb;\n    }, true);", ["    // 缩略图加载失败 → 优先走主进程代理（直连 <img> 无法带 X-Zian-Token），再退回文件图标","    $('#files-list').addEventListener('error', (e) => {","      const img = e.target;","      if (!img || img.tagName !== 'IMG' || !img.parentNode) return;","      const fallback = () => { if (img.dataset.fb && img.parentNode) img.parentNode.textContent = img.dataset.fb; };","      if (currentLink && currentLink.paired && img.dataset.path && !img.dataset.ipc) {","        img.dataset.ipc = '1';","        api.filesThumb(currentLink, img.dataset.path).then((r) => {","          if (r && r.ok && r.dataUrl) img.src = r.dataUrl; else fallback();","        }).catch(fallback);","        return;","      }","      fallback();","    }, true);"]);
r = rep('A1-thumb-datapath', r, '? `<img src="${thumbURL(it)}" loading="lazy"', '? `<img src="${thumbURL(it)}" data-path="${esc(it.path)}" loading="lazy"');

let h = load(H);
h = insertAfter('A5-restore-button', h, 'id="btn-gapps-enable"', ["              <button class=\"btn\" id=\"btn-gapps-restore\"><i>↺</i>批量恢复</button>"]);
h = insertAfter('A1-pair-row', h, 'id="ic-dev-meta"', [
  '            <div class="ic-dev-btns" id="ic-pair-row" style="margin-top:8px;display:none">',
  '              <input id="ic-pair-input" class="ic-select wide" maxlength="32" placeholder="配对码：手机 App 内显示的 32 位十六进制">',
  '              <button class="ic-chip primary" id="btn-ic-pair">确认配对</button>',
  '            </div>'
]);

if (bad) { console.log('未写入'); process.exitCode = 1; }
else { save(R, r, eolR); save(H, h, eolH); console.log('written renderer(eol=' + JSON.stringify(eolR) + ') index(eol=' + JSON.stringify(eolH) + ')'); }