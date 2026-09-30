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

    private static final String GROUP = "239.0.0.1";
    private static final int PORT = 35791;

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
                InetAddress group = InetAddress.getByName(GROUP);
                String name = Build.MODEL;
                String brand = Build.BRAND;
                String androidVer = Build.VERSION.RELEASE;
                String ip = getIp();
                String msg = String.format(
                        "{\"name\":\"%s\",\"model\":\"%s\",\"brand\":\"%s\",\"android\":\"%s\",\"ver\":\"1.0\",\"port\":%d,\"filePort\":35792,\"ip\":\"%s\",\"fg\":%s}",
                        name, name, brand, androidVer, PORT, ip, MainActivity.sForeground ? "true" : "false");
                byte[] data = msg.getBytes(StandardCharsets.UTF_8);
                DatagramPacket pkt = new DatagramPacket(data, data.length, group, PORT);
                s.send(pkt);
            } catch (Exception e) {
                // 静默
            } finally {
                if (s != null) try { s.close(); } catch (Exception e) {}
            }
            try { Thread.sleep(5000); } catch (InterruptedException e) { break; }
        }
    }

    private String getIp() {
        try {
            java.util.Enumeration<java.net.NetworkInterface> ifs = java.net.NetworkInterface.getNetworkInterfaces();
            while (ifs.hasMoreElements()) {
                java.net.NetworkInterface ni = ifs.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                java.util.Enumeration<java.net.InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    java.net.InetAddress addr = addrs.nextElement();
                    if (addr instanceof java.net.Inet4Address && !addr.isLoopbackAddress()) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception e) {}
        return "";
    }
}
