package com.zian.bridge;

import android.content.Context;
import android.media.MediaScannerConnection;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * 文件接收 raw TCP 服务（端口 35792）。
 *
 * 协议：
 *   第1行：目标目录绝对路径
 *   第2行：文件名
 *   第3行：长度（字节，long）
 *   接着是 raw 字节流，长度满后服务端返回 "OK\n" 或 "ERR xxx\n"
 *
 * 行读取用自己实现的 readLine（逐字节读直到 \n），避免 BufferedReader 缓存丢字节。
 * raw body 从同一个 InputStream 读，零拷贝流式写入磁盘。
 */
public class FileReceiver {

    private static final int PORT = 35792;
    private final Context ctx;
    private ServerSocket server;
    private volatile boolean running = false;

    public FileReceiver(Context ctx) {
        this.ctx = ctx;
    }

    public void start() {
        running = true;
        new Thread(this::loop, "FileReceiver").start();
    }

    public void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (Exception e) {}
    }

    private void loop() {
        try {
            server = new ServerSocket(PORT);
            server.setSoTimeout(2000);
        } catch (Exception e) {
            e.printStackTrace();
            return;
        }
        while (running) {
            Socket s = null;
            try {
                s = server.accept();
            } catch (java.net.SocketTimeoutException ste) {
                continue;
            } catch (Exception e) {
                if (running) e.printStackTrace();
                continue;
            }
            final Socket socket = s;
            new Thread(() -> handle(socket), "FileReceiver-conn").start();
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(60000);
            InputStream in = socket.getInputStream();
            String dirOrPath = readLine(in);
            String name = readLine(in);
            String lenStr = readLine(in);
            if (dirOrPath == null || name == null || lenStr == null) {
                writeResp(socket, "ERR no header\n");
                return;
            }
            long length;
            try { length = Long.parseLong(lenStr.trim()); } catch (Exception e) {
                writeResp(socket, "ERR bad length\n");
                return;
            }
            File dirFile = new File(dirOrPath);
            if (!dirFile.exists()) dirFile.mkdirs();
            File dst = new File(dirFile, name);
            long total = 0;
            byte[] buf = new byte[1 << 16];
            try (FileOutputStream out = new FileOutputStream(dst)) {
                while (total < length) {
                    int want = (int) Math.min(buf.length, length - total);
                    int n = in.read(buf, 0, want);
                    if (n < 0) break;
                    out.write(buf, 0, n);
                    total += n;
                }
            }
            MediaScannerConnection.scanFile(ctx, new String[]{dst.getAbsolutePath()}, null, null);
            writeResp(socket, total == length ? ("OK " + total + "\n") : ("ERR truncated " + total + "/" + length + "\n"));
        } catch (Exception e) {
            try { writeResp(socket, "ERR " + e.getMessage() + "\n"); } catch (Exception e2) {}
        } finally {
            try { socket.close(); } catch (Exception e) {}
        }
    }

    /** 逐字节读取直到 \n，不缓存多余字节，剩余 raw 字节仍在 InputStream 中。 */
    private String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream2 buf = new ByteArrayOutputStream2();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c == '\r') continue;
            buf.write(c);
        }
        if (buf.size() == 0 && c == -1) return null;
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }

    private void writeResp(Socket socket, String msg) throws Exception {
        OutputStream os = socket.getOutputStream();
        os.write(msg.getBytes(StandardCharsets.UTF_8));
        os.flush();
    }

    /** 内部简化版 ByteArrayOutputStream（避免 import）。 */
    private static class ByteArrayOutputStream2 {
        private byte[] buf = new byte[256];
        private int count = 0;
        void write(int b) {
            if (count == buf.length) {
                byte[] nb = new byte[buf.length * 2];
                System.arraycopy(buf, 0, nb, 0, count);
                buf = nb;
            }
            buf[count++] = (byte) b;
        }
        int size() { return count; }
        byte[] toByteArray() {
            byte[] r = new byte[count];
            System.arraycopy(buf, 0, r, 0, count);
            return r;
        }
    }
}
