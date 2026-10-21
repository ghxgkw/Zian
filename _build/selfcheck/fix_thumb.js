const fs = require('fs');
const F = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar.unpacked/renderer.js';
const lines = fs.readFileSync(F, 'utf8').split('\n');
const i = lines.findIndex((l) => l.trimStart().startsWith('// 缩略图加载失败'));
if (i < 0) { console.log('FAIL not found'); process.exit(1); }
if (lines[i].length < 400) { console.log('SKIP already ok, len=' + lines[i].length); process.exit(0); }
console.log('replacing collapsed line ' + (i + 1) + ' (len=' + lines[i].length + ')');
const block = ["    // 缩略图加载失败 → 优先走主进程代理（直连 <img> 无法带 X-Zian-Token），再退回文件图标","    $('#files-list').addEventListener('error', (e) => {","      const img = e.target;","      if (!img || img.tagName !== 'IMG' || !img.parentNode) return;","      const fallback = () => { if (img.dataset.fb && img.parentNode) img.parentNode.textContent = img.dataset.fb; };","      if (currentLink && currentLink.paired && img.dataset.path && !img.dataset.ipc) {","        img.dataset.ipc = '1';","        api.filesThumb(currentLink, img.dataset.path).then((r) => {","          if (r && r.ok && r.dataUrl) img.src = r.dataUrl; else fallback();","        }).catch(fallback);","        return;","      }","      fallback();","    }, true);"];
lines.splice(i, 1, ...block);
fs.writeFileSync(F, lines.join('\n'));
console.log('fixed, now ' + lines.length + ' lines');