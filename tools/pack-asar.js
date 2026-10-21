#!/usr/bin/env node
'use strict';
/**
 * 无依赖 asar 打包器（项目内工具）
 * 用法：node tools/pack-asar.js <源目录> <输出.asar>
 *
 * 说明：按 Electron asar 的 Chrome Pickle 头格式重建归档：
 *   [0..3]  = 4
 *   [4..7]  = headerSize (H)
 *   [8..11] = H - 4
 *   [12..15]= JSON 字节长度 (L)
 *   [16..]  = JSON + 零填充，数据区从 8 + H 开始
 * 每个文件条目写 size（数字）与 offset（字符串），与官方实现一致。
 */
const fs = require('fs');
const path = require('path');

const [, , srcDir, outFile] = process.argv;
if (!srcDir || !outFile) {
  console.error('用法: node tools/pack-asar.js <源目录> <输出.asar>');
  process.exit(1);
}

// 目录名同样在此过滤：运行时数据目录与依赖目录绝不能进包
const IGNORE = new Set(['.DS_Store', 'Thumbs.db', 'node_modules', 'tmp', 'dist', '.git', 'selfcheck',
  '梓安工具箱', 'Log', 'Screenshots', 'Synced', 'ApkExt', 'Script', 'links.json']);

function walk(dir, rel, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !IGNORE.has(e.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(abs, r, out);
    else if (ent.isFile()) out.push({ rel: r, abs });
  }
}

const files = [];
walk(path.resolve(srcDir), '', files);

let offset = 0;
const tree = { files: {} };
const blobs = [];
for (const f of files) {
  const data = fs.readFileSync(f.abs);
  const parts = f.rel.split('/');
  let node = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!node.files[key]) node.files[key] = { files: {} };
    node = node.files[key];
  }
  node.files[parts[parts.length - 1]] = { size: data.length, offset: String(offset) };
  blobs.push(data);
  offset += data.length;
}

const json = Buffer.from(JSON.stringify(tree), 'utf8');
const headerSize = 8 + json.length + ((4 - ((8 + json.length) % 4)) % 4);
const head = Buffer.alloc(16);
head.writeUInt32LE(4, 0);
head.writeUInt32LE(headerSize, 4);
head.writeUInt32LE(headerSize - 4, 8);
head.writeUInt32LE(json.length, 12);
const pad = Buffer.alloc(headerSize - 8 - json.length);
const out = Buffer.concat([head, json, pad, ...blobs]);

fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, out);
console.log(`packed ${files.length} files -> ${outFile} (${out.length} bytes, header ${headerSize})`);
