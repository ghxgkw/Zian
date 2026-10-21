'use strict';
/** 通用工具：路径/命名/解析/等待。无状态，不依赖 Electron。 */
const fs = require('fs');

/** 时间戳，用于文件名：YYYYMMDD_HHmmss_SSS（毫秒级，同一秒内多次截图/录屏不再互相覆盖） */
function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${p(d.getMilliseconds(), 3)}`;
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * 解析 "Key: Value" 形式的 dumpsys 输出（同名键只取第一次出现）。
 * 正则本身已吃掉值两端空白，调用方不必再传 trim 开关。
 */
function parseKeyVals(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z ]+?):\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    if (out[key] !== undefined) continue;
    out[key] = m[2];
  }
  return out;
}

/** Windows 文件名清洗：非法字符/控制字符换下划线，去掉尾部点与空格 */
function safeWinName(name) {
  const cleaned = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return cleaned || 'file_' + Date.now();
}

/** 从错误输出里取最后一条含 error 的行，取不到则取最后一行 */
function lastErrLine(s) {
  const lines = String(s || '').split(/\r?\n/);
  return (lines.filter((l) => /error/i.test(l)).pop() || lines[lines.length - 1] || '').trim();
}

/** 文件存在且大于指定字节数（录屏产物校验） */
const fileOk = (p, min = 20000) => {
  try { return fs.existsSync(p) && fs.statSync(p).size > min; } catch { return false; }
};

/** 解析互联端点：显式 link 优先，否则当前连接，最后回退指定端口 */
function endpointOf(link, currentLink, fallbackPort = 35791) {
  const l = link || currentLink;
  return l && l.ip ? { ip: l.ip, port: l.port || fallbackPort } : null;
}

module.exports = { ts, delay, parseKeyVals, safeWinName, lastErrLine, fileOk, endpointOf };
