#!/usr/bin/env node
'use strict';
/**
 * asar 校验器（项目内工具）
 * 用法：node tools/verify-asar.js <asar> [源目录]
 * 校验：头部字段自洽、条目可解出、可选与源目录逐文件 sha256 比对。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [, , asarPath, srcDir] = process.argv;
if (!asarPath) {
  console.error('用法: node tools/verify-asar.js <asar> [源目录]');
  process.exit(1);
}

const buf = fs.readFileSync(asarPath);
const u32 = (o) => buf.readUInt32LE(o);
const a0 = u32(0), H = u32(4), H2 = u32(8), L = u32(12);
const json = buf.slice(16, 16 + L).toString('utf8');
let tree;
try { tree = JSON.parse(json); } catch (e) { console.error('JSON 解析失败:', e.message); process.exit(1); }
const dataStart = 8 + H;
const problems = [];
if (a0 !== 4) problems.push('字段0 应为 4，实际 ' + a0);
if (H2 !== H - 4) problems.push('字段8 应为 headerSize-4');
if (H < L + 8) problems.push('headerSize 小于 JSON 长度+8');
if (dataStart > buf.length) problems.push('dataStart 越界');

const entries = [];
(function walk(node, p) {
  for (const k of Object.keys(node.files || {})) {
    const n = node.files[k];
    const q = p ? p + '/' + k : k;
    if (n.files) walk(n, q);
    else entries.push({ p: q, size: n.size, offset: parseInt(n.offset, 10), unpacked: !!n.unpacked });
  }
})(tree, '');

let end = dataStart;
for (const e of entries) {
  // unpacked 条目的数据不在 asar 内，按 .unpacked 目录校验，这里跳过偏移检查
  if (e.unpacked) continue;
  if (!Number.isFinite(e.offset) || e.offset < 0) problems.push('offset 非法: ' + e.p);
  end = Math.max(end, dataStart + e.offset + e.size);
  if (dataStart + e.offset + e.size > buf.length) problems.push('数据越界: ' + e.p);
}
if (end > buf.length) problems.push('数据区超出文件长度');

console.log(`entries=${entries.length} header=${H} json=${L} dataStart=${dataStart} file=${buf.length}`);
if (srcDir) {
  const src = path.resolve(srcDir);
  let ok = 0, bad = 0, missing = 0;
  const seen = new Set();
  for (const e of entries) {
    const abs = path.join(src, e.p);
    if (!fs.existsSync(abs)) { missing++; problems.push('源文件缺失: ' + e.p); continue; }
    const data = buf.slice(dataStart + e.offset, dataStart + e.offset + e.size);
    const h1 = crypto.createHash('sha256').update(data).digest('hex');
    const h2 = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    if (h1 === h2) ok++; else { bad++; problems.push('内容不一致: ' + e.p); }
    seen.add(path.resolve(abs));
  }
  const all = [];
  // 与 pack-asar.js 保持同一份忽略集：运行时目录与依赖目录本就不该进包
  const IGNORE = new Set(['.DS_Store', 'Thumbs.db', 'node_modules', 'tmp', 'dist', '.git', 'selfcheck',
    '梓安工具箱', 'Log', 'Screenshots', 'Synced', 'ApkExt', 'Script', 'links.json']);
  (function walkSrc(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (IGNORE.has(ent.name)) continue;
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walkSrc(abs);
      else all.push(abs);
    }
  })(src);
  const extra = all.filter((a) => !seen.has(path.resolve(a)));
  if (extra.length) problems.push('归档缺少源文件: ' + extra.map((x) => path.relative(src, x)).join(', '));
  console.log(`compare ok=${ok} bad=${bad} missing=${missing} extraInSrc=${extra.length}`);
}

if (problems.length) {
  console.error('FAIL');
  problems.forEach((p) => console.error(' - ' + p));
  process.exit(2);
}
console.log('OK');
