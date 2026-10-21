package com.zian.bridge;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

/**
 * 1x1 透明 Activity：借一次窗口焦点合法读取剪贴板（Android 10+ 后台服务读不到），
 * 读到后写入 BridgeService 静态缓存并立即 finish。
 * 由 GET /clipboard/pull 发出的通知点击拉起（PendingIntent），不入最近任务。
 */
public class ClipReadActivity extends Activity {

    private boolean done;

    /** onCreate 时间戳：/clipboard/pull 靠它判定 startActivity 是否真被系统放行（BAL 拦截不抛异常，只静默丢弃） */
    private static volatile long sCreateAt;

    static long lastCreateAt() { return sCreateAt; }

    @Override
    protected void onCreate(Bundle s) {
        super.onCreate(s);
        sCreateAt = System.currentTimeMillis();
        getWindow().setLayout(1, 1);
        // 兜底：一直拿不到焦点就 3s 后自己退出，不留一个透明窗口
        new Handler(Looper.getMainLooper()).postDelayed(this::finishOnce, 3000);
    }

    @Override
    protected void onResume() {
        super.onResume();
        tryRead();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) tryRead();
    }

    private void tryRead() {
        if (done || !hasWindowFocus()) return;
        done = true;
        ClipReader.Snap snap = ClipReader.read(this);
        if (snap != null) BridgeService.setSnap(snap);
        BridgeService.cancelClipNoti(this);
        finish();
    }

    private void finishOnce() {
        if (done) return;
        done = true;
        finish();
    }
}
