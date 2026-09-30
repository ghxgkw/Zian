package com.zian.bridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * 前台服务：HttpServer + MdnsBroadcaster + ClipboardWatcher + FileReceiver 常驻。
 * - foregroundServiceType=dataSync
 * - 亮屏时前台服务保活，vivo 不杀有前台通知的进程
 * - 息屏时该冻结就冻结，不干预
 * - 不操作手机：不唤醒屏幕、不 am start
 * - onTaskRemoved：用户从最近任务划掉时自启（不改变前台状态）
 * - 动态注册 SCREEN_ON：Service 存活时亮屏自动恢复 HTTP 服务
 * - Manifest BootReceiver：开机/重启/亮屏解锁（USER_PRESENT）自启
 */
public class BridgeService extends Service {

    static final String CHANNEL_ID = "zian_bridge";
    static final int NOTI_ID = 0x35791;
    private static final String TAG = "zian/svc";
    /** 暂停状态：true=局域网暂停（仅 USB 可用），false=正常 */
    static volatile boolean sLanPaused = false;

    private HttpServer http;
    private MdnsBroadcaster mdns;
    private ClipboardWatcher clip;
    private FileReceiver fileReceiver;
    /** 亮屏广播接收器：息屏→亮屏时恢复 HTTP 服务 */
    private BroadcastReceiver screenOnReceiver;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();

        // 动态注册 SCREEN_ON：亮屏时恢复 HTTP 服务
        // ACTION_SCREEN_ON 是 protected broadcast，只能动态注册
        screenOnReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                Log.i(TAG, "亮屏广播收到，重启 HTTP 服务");
                restartHttp();
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        registerReceiver(screenOnReceiver, filter);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 处理暂停/恢复
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if ("PAUSE_LAN".equals(action)) {
                sLanPaused = true;
                Log.i(TAG, "局域网已暂停（仅 USB 可用）");
                // 停广播（手机不再被发现）
                if (mdns != null) { mdns.stop(); mdns = null; }
                updateNoti("已暂停 · 仅 USB 可用");
                return START_STICKY;
            }
            if ("RESUME_LAN".equals(action)) {
                sLanPaused = false;
                Log.i(TAG, "局域网已恢复");
                if (mdns == null) { mdns = new MdnsBroadcaster(this); mdns.start(); }
                updateNoti("后台运行中");
                return START_STICKY;
            }
        }

        Notification n = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("梓安互联桥")
                .setContentText("后台运行中")
                .setSmallIcon(R.drawable.ic_notification)
                .setOngoing(true)
                .setContentIntent(PendingIntent.getActivity(this, 0,
                        new Intent(this, MainActivity.class),
                        PendingIntent.FLAG_IMMUTABLE))
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTI_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTI_ID, n);
        }

        // 启动各组件（如果还没启动）
        restartHttp();
        if (fileReceiver == null) { fileReceiver = new FileReceiver(this); fileReceiver.start(); }
        if (mdns == null) { mdns = new MdnsBroadcaster(this); mdns.start(); }
        if (clip == null) { clip = new ClipboardWatcher(this, http); clip.start(); }

        return START_STICKY;
    }

    /** 重启 HTTP 服务（亮屏恢复 / Service 重启时调用） */
    private void restartHttp() {
        try {
            if (http == null) {
                http = new HttpServer(this);
                http.start();
                Log.i(TAG, "HTTP 服务已启动");
            }
        } catch (Exception e) {
            Log.e(TAG, "HTTP 启动失败: " + e.getMessage());
        }
    }

    /** 用户从最近任务划掉时自启（不改变手机前台状态） */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        try {
            Intent i = new Intent(this, BridgeService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(i);
            } else {
                startService(i);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (screenOnReceiver != null) {
            try { unregisterReceiver(screenOnReceiver); } catch (Exception ignored) {}
            screenOnReceiver = null;
        }
        if (clip != null) { clip.stop(); clip = null; }
        if (mdns != null) { mdns.stop(); mdns = null; }
        if (fileReceiver != null) { fileReceiver.stop(); fileReceiver = null; }
        if (http != null) { http.stop(); http = null; }
    }

    /** 更新通知文案 */
    private void updateNoti(String text) {
        try {
            Notification n = new Notification.Builder(this, CHANNEL_ID)
                    .setContentTitle("梓安互联桥")
                    .setContentText(text)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setOngoing(true)
                    .setContentIntent(PendingIntent.getActivity(this, 0,
                            new Intent(this, MainActivity.class),
                            PendingIntent.FLAG_IMMUTABLE))
                    .build();
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.notify(NOTI_ID, n);
        } catch (Exception ignored) {}
    }

    private void createChannel() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "互联桥", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("后台常驻");
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(ch);
        }
    }
}

