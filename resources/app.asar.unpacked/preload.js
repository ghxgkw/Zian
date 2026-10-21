const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zian', {
  // 窗口控制
  winMin: () => ipcRenderer.invoke('win:min'),
  winClose: () => ipcRenderer.invoke('win:close'),
  // ADB 基础
  adbDevices: () => ipcRenderer.invoke('adb:devices'),
  adbRun: (args, serial) => ipcRenderer.invoke('adb:run', args, serial),
  deviceInfo: (s) => ipcRenderer.invoke('device:info', s),
  batteryRead: (s) => ipcRenderer.invoke('battery:read', s),
  cmdRun: (s, c) => ipcRenderer.invoke('cmd:run', s, c),
  // 应用管理
  appInstall: (s, downgrade) => ipcRenderer.invoke('app:install', s, downgrade),
  appUninstall: (s, p) => ipcRenderer.invoke('app:uninstall', s, p),
  appExtract: (s, p) => ipcRenderer.invoke('app:extract', s, p),
  gappsRestore: (s, pkgs) => ipcRenderer.invoke('gapps:restore', s, pkgs),
  // 截图录屏
  screenshot: (s, opts) => ipcRenderer.invoke('screen:shot', s, opts),
  recordStart: (s, sec, audio) => ipcRenderer.invoke('screen:record', s, sec, audio),
  recordStop: () => ipcRenderer.invoke('screen:record-stop'),
  // 文件传输（ADB）
  filePush: (s, dest) => ipcRenderer.invoke('file:push', s, dest),
  // 重启
  reboot: (s, m) => ipcRenderer.invoke('reboot', s, m),
  // 脚本
  scriptList: () => ipcRenderer.invoke('script:list'),
  scriptRead: (n) => ipcRenderer.invoke('script:read', n),
  scriptSave: (n, c) => ipcRenderer.invoke('script:save', n, c),
  // 日志
  logcatStart: (s) => ipcRenderer.invoke('logcat:start', s),
  logcatStop: () => ipcRenderer.invoke('logcat:stop'),
  // 对话框 / Shell
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  getPaths: () => ipcRenderer.invoke('paths:get'),
  // ---------- 局域网互联 ----------
  netScan: (t) => ipcRenderer.invoke('net:scan', t),
  netAutoconnect: (mode) => ipcRenderer.invoke('net:autoconnect', mode),
  netConnect: (ip, port, opts) => ipcRenderer.invoke('net:connect', ip, port, opts),
  netDisconnect: () => ipcRenderer.invoke('net:disconnect'),
  netPair: (l, code) => ipcRenderer.invoke('net:pair', l, code),
  // 超级剪贴板
  clipboardGet: (l) => ipcRenderer.invoke('clipboard:get', l),
  clipboardSet: (l, p) => ipcRenderer.invoke('clipboard:set', l, p),
  clipboardPull: (l) => ipcRenderer.invoke('clipboard:pull', l),
  clipboardApplyRemote: (r) => ipcRenderer.invoke('clipboard:apply-remote', r),
  clipboardWatchStart: () => ipcRenderer.invoke('clipboard:watch:start'),
  clipboardWatchStop: () => ipcRenderer.invoke('clipboard:watch:stop'),
  // 文件同步（局域网）
  filesList: (l, t, d) => ipcRenderer.invoke('files:list', l, t, d),
  filesPull: (l, rp, sp) => ipcRenderer.invoke('files:pull', l, rp, sp),
  filesPush: (l, lp, rd) => ipcRenderer.invoke('files:push', l, lp, rd),
  filesOpenInVivo: (l, rp) => ipcRenderer.invoke('files:open-in-vivo', l, rp),
  filesThumb: (l, rp) => ipcRenderer.invoke('files:thumb', l, rp),
  // 屏幕镜像
  mirrorStart: (s, c) => ipcRenderer.invoke('mirror:start', s, c),
  mirrorStop: () => ipcRenderer.invoke('mirror:stop'),
  // 事件
  onLogcat: (cb) => ipcRenderer.on('logcat:data', (_e, line) => cb(line)),
  onRecord: (cb) => ipcRenderer.on('record:state', (_e, st) => cb(st)),
  onFilesProgress: (cb) => ipcRenderer.on('files:progress', (_e, p) => cb(p)),
  onClipboardRemote: (cb) => ipcRenderer.on('clipboard:remote', (_e, p) => cb(p)),
  onClipboardFocusRequired: (cb) => ipcRenderer.on('clipboard:focus-required', (_e, p) => cb(p)),
  onClipboardTapRequired: (cb) => ipcRenderer.on('clipboard:tap-required', (_e, p) => cb(p)),
  onNetAutoconnected: (cb) => ipcRenderer.on('net:autoconnected', (_e, l) => cb(l)),
  onNetReconnected: (cb) => ipcRenderer.on('net:reconnected', (_e, l) => cb(l)),
  onNetLinkState: (cb) => ipcRenderer.on('net:linkstate', (_e, s) => cb(s)),
  onNetUnauthorized: (cb) => ipcRenderer.on('net:unauthorized', (_e, p) => cb(p)),
  onMirrorStopped: (cb) => ipcRenderer.on('mirror:stopped', () => cb())
});