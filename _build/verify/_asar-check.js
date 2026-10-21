'use strict';
// Read main.js out of the packed resources/app.asar and check two facts.
// asar layout (pickle): u32@4 = headerSize, u32@8 = header payload, u32@12 = json length,
// JSON starts at 16, binary data starts at 8 + headerSize (NOT a hardcoded 652).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const ASAR = path.join(ROOT, 'resources', 'app.asar');
const b = fs.readFileSync(ASAR);
const headerSize = b.readUInt32LE(4);
const jsonLen = b.readUInt32LE(12);
const dataStart = 8 + headerSize;
const json = JSON.parse(b.slice(16, 16 + jsonLen).toString('utf8'));
const ent = json.files['main.js'];
console.log('asar=' + ASAR);
console.log('asar bytes=' + b.length + ' headerSize=' + headerSize + ' jsonLen=' + jsonLen
  + ' dataStart=' + dataStart + ' (16+jsonLen=' + (16 + jsonLen) + ', padding=' + (dataStart - 16 - jsonLen) + ')');
// sanity: first packed entry is assets/icon.ico, a PNG
const first = json.files['assets'].files['icon.ico'];
const head = b.slice(dataStart, dataStart + 8).toString('hex');
console.log('first entry assets/icon.ico offset=' + first.offset + ' size=' + first.size + ' magic=' + head + ' (89504e470d0a1a0a = PNG)');
const off = dataStart + Number(ent.offset);
const packed = b.slice(off, off + ent.size);
const text = packed.toString('utf8');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const up = fs.readFileSync(path.join(ROOT, 'resources', 'app.asar.unpacked', 'main.js'));
console.log('entry main.js size=' + ent.size + ' offset=' + ent.offset + ' unpackedFlag=' + !!ent.unpacked);
console.log('packed   main.js sha256=' + sha(packed));
console.log('unpacked main.js bytes=' + up.length + ' sha256=' + sha(up));
console.log('count clipboard:pull            = ' + (text.split('clipboard:pull').length - 1));
console.log('count requestSingleInstanceLock = ' + (text.split('requestSingleInstanceLock').length - 1));
const idx = text.indexOf('clipboard:pull');
console.log('context: ' + JSON.stringify(text.slice(Math.max(0, idx - 70), idx + 30)));
console.log('RESULT ' + (text.includes('clipboard:pull') && !text.includes('requestSingleInstanceLock') ? 'PASS' : 'FAIL'));
