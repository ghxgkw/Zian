'use strict';
/** 局域网互联：UDP 多播发现 + HTTP JSON 请求 + ping。协议 v1.1：/ping 之外全部带 X-Zian-Token。 */
const http = require('http');
const dgram = require('dgram');

/** 401 哨兵：调用方必须提示重新配对，绝不能当普通空结果吞掉 */
const UNAUTHORIZED = { __unauthorized: true };
const isUnauthorized = (r) => !!r && r.__unauthorized === true;
/** 受保护端点的鉴权头 */
const authHeaders = (token) => (token ? { 'X-Zian-Token': String(token) } : {});

/** ping 设备（/ping 豁免鉴权）：成功返回 {ip,fg,...}，失败返回 null */
function pingDevice(ip, port) {
  return new Promise((res) => {
    const req = http.get({ host: ip, port, path: '/ping', timeout: 3000 }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { const j = JSON.parse(d); res(j.ok ? j : null); } catch { res(null); } });
    });
    req.on('timeout', () => { req.destroy(); res(null); });
    req.on('error', () => res(null));
  });
}

function httpGetJsonOnce(ip, port, p, timeoutMs, token) {
  return new Promise((res) => {
    const req = http.get({ host: ip, port, path: p, timeout: timeoutMs, headers: authHeaders(token) }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        if (r.statusCode === 401) { res(UNAUTHORIZED); return; }
        try { res(JSON.parse(d)); } catch { res(null); }
      });
      r.on('error', () => res(null));
    });
    // Node 的 timeout 选项只触发事件不中止请求，必须手动销毁
    req.on('timeout', () => { req.destroy(); res(null); });
    req.on('error', () => res(null));
  });
}

/** GET JSON，失败自动重试一次（仅重发，不拉起手机 App）；401 不重试 */
async function httpGetJson(ip, port, p, timeoutMs = 8000, retries = 1, token) {
  let r = await httpGetJsonOnce(ip, port, p, timeoutMs, token);
  // 令牌不会自己变对：401 重试只会刷屏，直接交给调用方提示重新配对
  while (r === null && retries-- > 0) {
    r = await httpGetJsonOnce(ip, port, p, timeoutMs, token);
  }
  return r;
}

/** UDP 多播扫描（239.0.0.1:35791），主动 ping 补全并过滤后台设备 */
function lanScan(timeoutMs) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { sock.close(); } catch {} resolve([...found.values()]); };
    const timer = setTimeout(done, timeoutMs);
    sock.on('error', () => { clearTimeout(timer); done(); });
    sock.on('message', (buf) => {
      try {
        const dev = JSON.parse(buf.toString());
        if (!dev.ip || !dev.port || found.has(dev.ip)) return;
        found.set(dev.ip, dev);
        pingDevice(dev.ip, dev.port).then((info) => {
          if (!info) return;
          if (info.fg === false) { found.delete(dev.ip); return; }
          found.set(dev.ip, { ...dev, ...info });
        });
      } catch {}
    });
    sock.bind(35791, () => { try { sock.addMembership('239.0.0.1'); } catch {} });
  });
}

module.exports = { pingDevice, httpGetJson, lanScan, UNAUTHORIZED, isUnauthorized, authHeaders };