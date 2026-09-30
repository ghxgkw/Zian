package com.zian.bridge;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

/**
 * 启动入口：申请运行时权限 + 启动前台服务。
 */
public class MainActivity extends Activity {

    private static final int REQ_PERMS = 0x51a;

    /** App 是否在前台（供 /ping 与广播判断"是否在 App 界面"） */
    public static volatile boolean sForeground = false;

    private final String[] perms() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return new String[]{
                    Manifest.permission.POST_NOTIFICATIONS,
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO,
                    Manifest.permission.READ_MEDIA_AUDIO
            };
        }
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
    }

    @Override
    protected void onCreate(Bundle s) {
        super.onCreate(s);
        setContentView(R.layout.activity_main);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        TextView tv = findViewById(R.id.tv_status);
        Button btn = findViewById(R.id.btn_start);

        tv.setText("梓安互联桥\n端口 35791 · 多播 239.0.0.1\n点击下方启动服务");

        btn.setText("启动互联桥");
        btn.setOnClickListener(v -> {
            ensurePermsAndStart();
        });

        // vivo 后台白名单引导：防止息屏后进程被冻结导致互联卡死
        Button btnKeep = findViewById(R.id.btn_keepalive);
        if (btnKeep != null) {
            btnKeep.setOnClickListener(v -> openVivoKeepAlive());
        }

        // 暂停/恢复局域网按钮
        Button btnPause = findViewById(R.id.btn_pause_lan);
        if (btnPause != null) {
            btnPause.setOnClickListener(v -> {
                boolean paused = BridgeService.sLanPaused;
                Intent svc = new Intent(this, BridgeService.class);
                svc.setAction(paused ? "RESUME_LAN" : "PAUSE_LAN");
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(svc);
                    } else {
                        startService(svc);
                    }
                btnPause.setText(paused ? "暂停局域网（仅 USB 可用）" : "恢复局域网连接");
                android.widget.Toast.makeText(this,
                    paused ? "局域网已恢复" : "局域网已暂停，仅 USB 可用",
                    android.widget.Toast.LENGTH_SHORT).show();
            });
        }

        ensurePermsAndStart();
    }

    /** 跳转 vivo 后台功耗管控 / 通用应用详情，引导用户加白名单 */
    private void openVivoKeepAlive() {
        android.widget.Toast.makeText(this, "请将「梓安互联桥」设为允许后台高耗电", android.widget.Toast.LENGTH_LONG).show();
        try {
            Intent i = new Intent();
            i.setClassName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerAct");
            startActivity(i);
            return;
        } catch (Exception ignored) {}
        try {
            Intent i = new Intent();
            i.setClassName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.PurviewTabActivity");
            startActivity(i);
            return;
        } catch (Exception ignored) {}
        // 通用应用详情页兜底
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception ignored) {}
    }

    private void ensurePermsAndStart() {
        String[] need = perms();
        java.util.List<String> miss = new java.util.ArrayList<>();
        for (String p : need) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) miss.add(p);
        }
        if (!miss.isEmpty()) {
            requestPermissions(miss.toArray(new String[0]), REQ_PERMS);
            return;
        }
        // Android 11+ 文件同步需要"所有文件访问"授权
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                } catch (Exception e2) {}
            }
            return;
        }
        startService();
    }

    @Override
    protected void onResume() {
        super.onResume();
        sForeground = true;
        // 从"所有文件访问"设置页返回后继续启动
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
            startService();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        sForeground = false;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        startService();
    }

    private void startService() {
        Intent i = new Intent(this, BridgeService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(i);
        } else {
            startService(i);
        }
        TextView tv = findViewById(R.id.tv_status);
        tv.setText("梓安互联桥运行中\n端口 35791 · 多播 239.0.0.1\n服务已启动");
    }
}
