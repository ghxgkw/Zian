package com.zian.bridge;

import android.app.Application;
import android.os.StrictMode;

import java.io.File;

/**
 * Application 入口。
 * 1. 把 java.io.tmpdir 指向 app cache dir：NanoHTTPD 默认会写到 /data/local/tmp，
 *    普通应用无写权限，上传 >1MB 直接 500。
 * 2. 放宽 StrictMode：用 file:// URI 跳第三方应用（vivo Office）时不会抛 FileUriExposedException。
 */
public class BridgeApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        File cacheDir = getCacheDir();
        if (!cacheDir.exists()) cacheDir.mkdirs();
        System.setProperty("java.io.tmpdir", cacheDir.getAbsolutePath());

        // 用空策略避免 file:// URI 触发 FileUriExposedException
        StrictMode.setThreadPolicy(new StrictMode.ThreadPolicy.Builder().build());
        StrictMode.setVmPolicy(new StrictMode.VmPolicy.Builder().build());
    }
}
