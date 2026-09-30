package com.zian.bridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 自启动接收器：
 * 1. BOOT_COMPLETED → 开机/重启后自启
 * 2. USER_PRESENT → 亮屏解锁后自启（息屏时进程可能被冻结/杀死，亮屏后恢复）
 * 3. LOCKED_BOOT_COMPLETED → Android 14+ 直接启动（用户未解锁时也能启动）
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "zian/boot";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.i(TAG, "收到广播: " + action);

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_USER_PRESENT.equals(action)
                || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)) {
            startService(context);
        }
    }

    private void startService(Context context) {
        try {
            Intent svc = new Intent(context, BridgeService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
            Log.i(TAG, "BridgeService 已拉起");
        } catch (Exception e) {
            Log.e(TAG, "拉起 Service 失败: " + e.getMessage());
        }
    }
}

