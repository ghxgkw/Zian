'use strict';
/** ADB 进程封装：普通命令 / 二进制输出 / 设备列表解析。 */
const { execFile, spawn } = require('child_process');

function createAdb(adbPath) {
  /** 执行 adb 命令，始终 resolve，不抛异常 */
  function adb(args, serial = null, timeout = 30000) {
    return new Promise((resolve) => {
      const finalArgs = serial ? ['-s', serial, ...args] : [...args];
      const child = execFile(
        adbPath,
        finalArgs,
        { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          resolve({ code: err ? (err.code ?? 1) : 0, out: (stdout || '').toString(), err: (stderr || '').toString() });
        }
      );
      child.on('error', () => {});
    });
  }

  /** 读取二进制输出（截图用） */
  function adbBinary(args, serial) {
    return new Promise((resolve) => {
      const finalArgs = serial ? ['-s', serial, ...args] : [...args];
      const child = spawn(adbPath, finalArgs, { windowsHide: true });
      const chunks = [];
      child.stdout.on('data', (c) => chunks.push(c));
      child.stderr.on('data', (c) => chunks.push(c));
      child.on('close', (code) => resolve({ code, buf: Buffer.concat(chunks) }));
      child.on('error', (e) => resolve({ code: -1, buf: Buffer.from(String(e)) }));
    });
  }

  /** 解析 `adb devices -l` 输出 */
  function parseDevices(text) {
    const list = [];
    for (const line of String(text || '').split(/\r?\n/).slice(1)) {
      const m = line.match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload)\b\s*(.*)$/);
      if (!m) continue;
      const modelM = m[3].match(/model:(\S+)/);
      list.push({ serial: m[1], state: m[2], model: modelM ? modelM[1] : '' });
    }
    return list;
  }

  /** 取在线设备 serial（按输出顺序） */
  function onlineSerials(text) {
    return String(text || '').split('\n').slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length >= 2 && p[1] === 'device')
      .map((p) => p[0]);
  }

  return { adb, adbBinary, parseDevices, onlineSerials };
}

module.exports = { createAdb };
