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
import java.util.concurrent.Semaphore;

/**
 * 文件接收 raw TCP 服务（端口 35792）。
 *
 * 协议：
 *   第1行：配对令牌（Pairing.token，32 位小写十六进制；不符立刻断开）
 *   第2行：目标目录绝对路径
 *   第3行：文件名
 *   第4行：长度（字节，long）
 *   接着是 raw 字节流，长度满后服务端返回 "OK\n" 或 "ERR xxx\n"
 *
 * 行读取用自己实现的 readLine（逐字节读直到 \n），避免 BufferedReader 缓存丢字节。
 * raw body 从同一个 InputStream 读，零拷贝流式写入磁盘。
 */
public class FileReceiver {

    /** 同时处理的连接上限 */
    private static final int MAX_CONN = 4;
    /** 单次传输上限 4GiB（同时防止协议首行给出荒谬长度后无限写盘） */
    private static final long MAX_LEN = 4L * 1024 * 1024 * 1024;

    private final Context ctx;
    private final Semaphore slots = new Semaphore(MAX_CONN);
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
            server = new ServerSocket(Constants.PORT_FILE);
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
            if (!slots.tryAcquire()) {
                try { writeResp(socket, "ERR busy\n"); } catch (Exception e) {}
                try { socket.close(); } catch (Exception e) {}
                continue;
            }
            new Thread(() -> {
                try { handle(socket); } finally { slots.release(); }
            }, "FileReceiver-conn").start();
        }
    }

    private void handle(Socket socket) {
        try {
            // 局域网暂停时（仅 USB 可用）：非回环连接直接断开
            if (BridgeService.sLanPaused && socket.getInetAddress() != null
                    && !socket.getInetAddress().isLoopbackAddress()) {
                writeResp(socket, "ERR lan paused\n");
                return;
            }
            socket.setSoTimeout(60000);
            InputStream in = socket.getInputStream();
            // 令牌校验：不符立刻断开，不读后续数据
            String tokenLine = readLine(in);
            if (tokenLine == null || !Pairing.token(ctx).equals(tokenLine.trim())) return;
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
            if (length < 0 || length > MAX_LEN) {
                writeResp(socket, "ERR too large\n");
                return;
            }
            File dirFile = new File(dirOrPath);
            if (!dirFile.exists()) dirFile.mkdirs();
            // 防路径穿越：文件名只取末段，且目标 canonical 路径必须落在目标目录内
            String safeName = new File(name).getName();
            if (safeName.isEmpty() || ".".equals(safeName) || "..".equals(safeName)) {
                writeResp(socket, "ERR bad name\n");
                return;
            }
            String dirRoot = dirFile.getCanonicalPath();
            File dst = new File(dirFile, safeName);
            String dstCanon = dst.getCanonicalPath();
            if (!dstCanon.startsWith(dirRoot + File.separator)) {
                writeResp(socket, "ERR path escape\n");
                return;
            }
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
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
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
}
