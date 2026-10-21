'use strict';
/**
 * CDP 客户端（浏览器级 + 会话附加；Node ws，无全局依赖）
 * 用法：
 *   node cdp.js evaluate <port> "<expression>"
 *   node cdp.js screenshot <port> <outFile>
 */
const fs = require('fs');
const path = require('path');
const WebSocket = require('./node_modules/ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [mode, portArg, arg3] = process.argv.slice(2);
  const port = parseInt(portArg, 10) || 9222;
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);

  let nextId = 1;
  const pending = new Map();
  const waiters = [];

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].method === msg.method) {
        waiters.splice(i, 1)[0].resolve(msg.params);
      }
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); }
    }, 60000);
  });

  const waitEvent = (method) => new Promise((resolve) => waiters.push({ method, resolve }));

  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });

  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page' && /index\.html/.test(t.url))
    || targetInfos.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });

  if (mode === 'screenshot') {
    const res = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const out = path.resolve(arg3);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(res.data, 'base64'));
    console.log('SHOT_OK ' + out + ' ' + fs.statSync(out).size);
  } else {
    const res = await send('Runtime.evaluate', {
      expression: arg3,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    const r = res.result || {};
    console.log(r.type === 'undefined' ? 'undefined' : JSON.stringify(r.value));
  }

  await send('Target.detachFromTarget', { sessionId }).catch(() => {});
  ws.close();
  await sleep(50);
}

main().catch((e) => { console.error('CDP_FAIL ' + e.message); process.exit(1); });
