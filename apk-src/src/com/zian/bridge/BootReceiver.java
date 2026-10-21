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
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "zian/boot";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.i(TAG, "收到广播: " + action);

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_USER_PRESENT.equals(action)) {
            startService(context);
        }
    }

    private void startService(Context context) {
        try {
            BridgeService.startBridge(context);
            Log.i(TAG, "BridgeService 已拉起");
        } catch (Exception e) {
            Log.e(TAG, "拉起 Service 失败: " + e.getMessage());
        }
    }
}

