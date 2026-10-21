package com.zian.bridge;

import android.content.Context;
import android.os.Build;

import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.nio.charset.StandardCharsets;

/**
 * UDP 多播发现，不走 NsdManager（Android 7+ 前台服务外不稳定）。
 * 每 5 秒向 239.0.0.1:35791 广播 JSON：
 * {name,model,android,ver,port}
 */
public class MdnsBroadcaster {

    private final Context ctx;
    private volatile boolean run = false;
    private Thread t;

    public MdnsBroadcaster(Context ctx) { this.ctx = ctx; }

    public void start() {
        if (run) return;
        run = true;
        t = new Thread(this::loop, "mdns-broadcast");
        t.setDaemon(true);
        t.start();
    }

    public void stop() {
        run = false;
        if (t != null) t.interrupt();
    }

    private void loop() {
        while (run) {
            MulticastSocket s = null;
            try {
                s = new MulticastSocket();
                s.setTimeToLive(255);
                InetAddress group = InetAddress.getByName(Constants.MULTICAST_GROUP);
                String name = Build.MODEL;
                String brand = Build.BRAND;
                String displayName = name + "(" + brand + ")";
                String androidVer = Build.VERSION.RELEASE;
                String ip = NetUtil.getIp();
                String msg = String.format(
                        "{\"name\":\"%s\",\"model\":\"%s\",\"brand\":\"%s\",\"android\":\"%s\",\"ver\":\"%s\",\"port\":%d,\"filePort\":%d,\"ip\":\"%s\",\"fg\":%s}",
                        JsonUtil.esc(displayName), JsonUtil.esc(name), JsonUtil.esc(brand), JsonUtil.esc(androidVer),
                        Constants.VER, Constants.PORT_HTTP, Constants.PORT_FILE, JsonUtil.esc(ip),
                        MainActivity.sForeground ? "true" : "false");
                byte[] data = msg.getBytes(StandardCharsets.UTF_8);
                DatagramPacket pkt = new DatagramPacket(data, data.length, group, Constants.PORT_HTTP);
                s.send(pkt);
            } catch (Exception e) {
                // 静默
            } finally {
                if (s != null) try { s.close(); } catch (Exception e) {}
            }
            try { Thread.sleep(5000); } catch (InterruptedException e) { break; }
        }
    }
}
