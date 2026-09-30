package com.zian.bridge;

import android.content.ClipboardManager;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;

/**
 * 剪贴板监听 + 防回环。
 * echoGuard：被电脑推过来的内容写入剪贴板时，sig 记入 echoGuard，
 * OnPrimaryClipChangedListener 回调时若 sig 匹配 echoGuard 则忽略本次变化。
 */
public class ClipboardWatcher {

    private final Context ctx;
    private final HttpServer server;
    private String echoGuard = "";

    public ClipboardWatcher(Context ctx, HttpServer server) {
        this.ctx = ctx;
        this.server = server;
        if (server != null) server.setClipboardWatcher(this);
    }

    public synchronized void echoGuard(String sig) {
        this.echoGuard = sig;
        // 5 秒后清除，避免误杀后续手动复制
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            synchronized (ClipboardWatcher.this) { echoGuard = ""; }
        }, 5000);
    }

    public void start() {
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null) return;
        cm.addPrimaryClipChangedListener(listener);
    }

    public void stop() {
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null) return;
        try {
            cm.removePrimaryClipChangedListener(listener);
        } catch (Exception e) {}
    }

    private final ClipboardManager.OnPrimaryClipChangedListener listener = new ClipboardManager.OnPrimaryClipChangedListener() {
        @Override
        public void onPrimaryClipChanged() {
            synchronized (ClipboardWatcher.this) {
                if (!echoGuard.isEmpty()) {
                    // 静默忽略一次
                    return;
                }
            }
            // 不主动推送，电脑端会轮询
        }
    };
}
