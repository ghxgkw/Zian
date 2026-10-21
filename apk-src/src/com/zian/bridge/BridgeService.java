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
 * 前台服务：HttpServer + MdnsBroadcaster + FileReceiver 常驻。
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
    /** /clipboard/pull 通知：同一 ID 复用，点一下读取剪贴板 */
    private static final String CLIP_CHANNEL_ID = "zian_clip_pull";
    private static final int CLIP_NOTI_ID = 0x35792;
    private static final int REQ_CLIP_READ = 0x35792;
    private static final String TAG = "zian/svc";
    /** 暂停状态：true=局域网暂停（仅 USB 可用），false=正常 */
    static volatile boolean sLanPaused = false;
    /** 「借焦点一次性读取」的结果（GET /clipboard 读不到时按 TTL 兜底） */
    private static volatile ClipReader.Snap sSnap;

    private HttpServer http;
    private MdnsBroadcaster mdns;
    private FileReceiver fileReceiver;
    /** 亮屏广播接收器：息屏→亮屏时恢复 HTTP 服务 */
    private BroadcastReceiver screenOnReceiver;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** 启动前台服务（Activity / BootReceiver / onTaskRemoved 共用，行为与原三处一致） */
    static void startBridge(Context ctx) {
        Intent i = new Intent(ctx, BridgeService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
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
        String action = intent == null ? null : intent.getAction();

        // 必须先转前台再处理 action：调用方用 startForegroundService 拉起，
        // 若在 PAUSE/RESUME 分支提前 return（5s 内没有 startForeground），
        // 系统会抛 RemoteServiceException 把进程搞崩。
        Notification n = buildNoti("后台运行中");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTI_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTI_ID, n);
        }

        if ("PAUSE_LAN".equals(action)) {
            sLanPaused = true;
            Log.i(TAG, "局域网已暂停（仅 USB 可用）");
            // 停广播（手机不再被发现）
            if (mdns != null) { mdns.stop(); mdns = null; }
        } else if ("RESUME_LAN".equals(action)) {
            sLanPaused = false;
            Log.i(TAG, "局域网已恢复");
        }

        // 启动各组件（如果还没启动）
        restartHttp();
        if (fileReceiver == null) { fileReceiver = new FileReceiver(this); fileReceiver.start(); }
        if (mdns == null && !sLanPaused) { mdns = new MdnsBroadcaster(this); mdns.start(); }

        updateNoti(sLanPaused ? "已暂停 · 仅 USB 可用" : "后台运行中");
        return START_STICKY;
    }

    static void setSnap(ClipReader.Snap s) { sSnap = s; }

    static void clearSnap() { sSnap = null; }

    /** 取 TTL 内的一次性读取结果，过期返回 null */
    static ClipReader.Snap getSnap(long ttlMs) {
        ClipReader.Snap s = sSnap;
        if (s == null) return null;
        return (System.currentTimeMillis() - s.at) <= ttlMs ? s : null;
    }

    /** 发「点一下读取剪贴板」通知：点击拉起 1x1 透明 ClipReadActivity 借焦点读取 */
    static void requestClipRead(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(CLIP_CHANNEL_ID, "剪贴板读取", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("点一下通知即读取手机剪贴板并同步到电脑");
                nm.createNotificationChannel(ch);
            }
            Intent i = new Intent(ctx, ClipReadActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pi = PendingIntent.getActivity(ctx, REQ_CLIP_READ, i,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification n = new Notification.Builder(ctx, CLIP_CHANNEL_ID)
                    .setContentTitle("读取手机剪贴板")
                    .setContentText("点一下通知 → 读取手机剪贴板并同步到电脑")
                    .setSmallIcon(R.drawable.ic_notification)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .setContentIntent(pi)
                    .build();
            nm.notify(CLIP_NOTI_ID, n);
        } catch (Exception e) {
            Log.e(TAG, "剪贴板通知发送失败: " + e.getMessage());
        }
    }

    static void cancelClipNoti(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
            nm.cancel(CLIP_NOTI_ID);
        } catch (Exception ignored) {}
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
        try { startBridge(this); } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (screenOnReceiver != null) {
            try { unregisterReceiver(screenOnReceiver); } catch (Exception ignored) {}
            screenOnReceiver = null;
        }
        if (mdns != null) { mdns.stop(); mdns = null; }
        if (fileReceiver != null) { fileReceiver.stop(); fileReceiver = null; }
        if (http != null) { http.stop(); http = null; }
    }

    private Notification buildNoti(String text) {
        return new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("梓安互联桥")
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_notification)
                .setOngoing(true)
                .setContentIntent(PendingIntent.getActivity(this, 0,
                        new Intent(this, MainActivity.class),
                        PendingIntent.FLAG_IMMUTABLE))
                .build();
    }

    /** 更新通知文案 */
    private void updateNoti(String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.notify(NOTI_ID, buildNoti(text));
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
