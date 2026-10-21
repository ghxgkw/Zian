const fs = require('fs');
const p = 'D:/tool/梓安搞机工具箱-win32-x64/resources/app.asar';
const b = fs.readFileSync(p);
const hdrSize = b.readUInt32LE(12);
const json = JSON.parse(b.slice(16, 16 + hdrSize).toString('utf8'));
let n = 0;
function walk(node, prefix) {
  for (const [k, v] of Object.entries(node.files || {})) {
    const path = prefix + '/' + k;
    if (v.files) walk(v, path);
    else { n++; console.log((v.unpacked ? 'UNPACKED ' : 'PACKED   ') + path + '  size=' + (v.size || 0)); }
  }
}
walk(json, '');
console.log('--- entries', n, 'asar bytes', b.length);
