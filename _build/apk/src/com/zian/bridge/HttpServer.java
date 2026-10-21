package com.zian.bridge;

import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.List;

import fi.iki.elonen.NanoHTTPD;

/**
 * HTTP 服务端，端口 35791。
 * 路由：
 *   GET  /ping            -> {name,model,android,ver,ip}
 *   GET  /clipboard        -> {type,data,sig}
 *   POST /clipboard        -> body=text 或 multipart image
 *   GET  /files?type=..   -> [{name,path,size,modified}]
 *   GET  /file?path=..    -> 流式下载
 *   GET  /open?path=..&app=vivo_office
 *   大文件上传走 FileReceiver（raw TCP 35792），不走 HTTP。
 */
public class HttpServer extends NanoHTTPD {

    private final Context ctx;

    public HttpServer(Context ctx) {
        super(Constants.PORT_HTTP);
        this.ctx = ctx;
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method m = session.getMethod();
        // 暂停状态：仅允许 USB forward（127.0.0.1），拒绝局域网请求
        if (BridgeService.sLanPaused) {
            String clientIp = session.getRemoteHostName();
            if (clientIp != null && !clientIp.equals("127.0.0.1") && !clientIp.equals("localhost")) {
                return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "403 LAN paused");
            }
        }
        // 配对引导：本身无鉴权，但只允许回环来源（USB forward 在手机侧看到的是 127.0.0.1）
        if ("/pair".equals(uri)) return pair(session);
        // 除 /ping 外全部路由都要令牌，缺失或不符一律 401
        if (!"/ping".equals(uri) && !authorized(session)) {
            return newFixedLengthResponse(Response.Status.UNAUTHORIZED, "application/json",
                    "{\"ok\":false,\"err\":\"unauthorized\"}");
        }
        try {
            if ("/ping".equals(uri)) return ping();
            if ("/clipboard/pull".equals(uri) && m == Method.GET) return pullClipboard();
            if ("/clipboard".equals(uri) && m == Method.GET) return getClipboard();
            if ("/clipboard".equals(uri) && m == Method.POST) return setClipboard(session);
            if ("/files".equals(uri) && m == Method.GET) return listFiles(session);
            if ("/file".equals(uri) && m == Method.GET) return getFile(session);
            if ("/thumb".equals(uri) && m == Method.GET) return getThumb(session);
            if ("/open".equals(uri) && m == Method.GET) return openInVivo(session);
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404");
        } catch (Exception e) {
            e.printStackTrace();
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "500 " + e.getMessage());
        }
    }

    private Response ping() {
        String name = android.os.Build.MODEL;
        String brand = android.os.Build.BRAND;
        String androidVer = android.os.Build.VERSION.RELEASE;
        String ip = NetUtil.getIp();
        String fg = MainActivity.sForeground ? "true" : "false";
        String displayName = name + "(" + brand + ")";
        String json = String.format(
                "{\"ok\":true,\"name\":\"%s\",\"model\":\"%s\",\"android\":\"%s\",\"ver\":\"%s\",\"ip\":\"%s\",\"brand\":\"%s\",\"fg\":%s,\"port\":%d}",
                JsonUtil.esc(displayName), JsonUtil.esc(name), JsonUtil.esc(androidVer), Constants.VER, JsonUtil.esc(ip), JsonUtil.esc(brand), fg, Constants.PORT_HTTP);
        return newFixedLengthResponse(Response.Status.OK, "application/json", json);
    }

    /** 缩略图：图片采样解码 / 视频抽帧，统一 480px JPEG + LRU 缓存 */
    private Response getThumb(IHTTPSession session) {
        String path = firstParam(session.getParameters(), "path", null);
        if (path == null) return json("{\"ok\":false,\"err\":\"no path\"}");
        byte[] jpg = ThumbCache.jpeg(path, this::makeThumb);
        if (jpg == null) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "no thumb");
        return newFixedLengthResponse(Response.Status.OK, "image/jpeg",
                new java.io.ByteArrayInputStream(jpg), jpg.length);
    }

    private Bitmap makeThumb(String path) {
        try {
            String p = path.toLowerCase();
            // 视频：优先 MediaStore 系统缓存（比 MediaMetadataRetriever 快 10x+）
            if (p.endsWith(".mp4") || p.endsWith(".mkv") || p.endsWith(".avi") || p.endsWith(".mov")
                    || p.endsWith(".3gp") || p.endsWith(".webm")) {
                Bitmap cached = queryMediaThumb(path);
                if (cached != null) return scaleDown(cached);
                // 缓存没有才用 MediaMetadataRetriever 抽帧
                android.media.MediaMetadataRetriever mmr = new android.media.MediaMetadataRetriever();
                try {
                    mmr.setDataSource(path);
                    return scaleDown(mmr.getFrameAtTime(1_000_000, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC));
                } finally {
                    try { mmr.release(); } catch (Exception ignored) {}
                }
            }
            // 图片：采样解码，控制内存
            android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            android.graphics.BitmapFactory.decodeFile(path, opts);
            int sample = 1;
            while (opts.outWidth / (sample * 2) >= 480 && opts.outHeight / (sample * 2) >= 480) sample *= 2;
            opts = new android.graphics.BitmapFactory.Options();
            opts.inSampleSize = sample;
            return scaleDown(android.graphics.BitmapFactory.decodeFile(path, opts));
        } catch (Exception e) {
            return null;
        }
    }

    /** 查询 MediaStore 系统缓存的缩略图（视频/图片通用） */
    private Bitmap queryMediaThumb(String filePath) {
        try {
            android.content.ContentResolver cr = ctx.getContentResolver();
            android.net.Uri uri = android.provider.MediaStore.Files.getContentUri("external");
            String[] proj = { android.provider.MediaStore.MediaColumns._ID };
            String sel = android.provider.MediaStore.MediaColumns.DATA + "=?";
            android.database.Cursor cur = cr.query(uri, proj, sel, new String[]{filePath}, null);
            if (cur == null || !cur.moveToFirst()) { if (cur != null) cur.close(); return null; }
            long id = cur.getLong(0);
            cur.close();
            return android.provider.MediaStore.Video.Thumbnails.getThumbnail(cr, id,
                    android.provider.MediaStore.Video.Thumbnails.MINI_KIND, null);
        } catch (Exception ignored) { return null; }
    }

    private Bitmap scaleDown(Bitmap src) {
        if (src == null) return null;
        int max = 480;
        int w = src.getWidth(), h = src.getHeight();
        int sw = Math.max(w, h);
        if (sw <= max) return src;
        float ratio = max / (float) sw;
        return Bitmap.createScaledBitmap(src, Math.round(w * ratio), Math.round(h * ratio), true);
    }

    /** 简单 LRU 位图缓存（上限 96 张，淘汰时立即 recycle：480px JPEG 位图常驻峰值曾达 ~88MB） */
    private static class ThumbCache {
        private static final java.util.LinkedHashMap<String, Bitmap> MAP =
                new java.util.LinkedHashMap<String, Bitmap>(32, 0.75f, true) {
                    protected boolean removeEldestEntry(java.util.Map.Entry<String, Bitmap> e) {
                        if (size() <= 96) return false;
                        Bitmap old = e.getValue();
                        if (old != null && !old.isRecycled()) old.recycle();
                        return true;
                    }
                };
        /** 取缓存 → 缺则解码 → JPEG 编码；编码期间持锁，淘汰 recycle 不会打断正在压缩的位图 */
        static byte[] jpeg(String k, java.util.function.Function<String, Bitmap> maker) {
            Bitmap bmp;
            synchronized (MAP) { bmp = MAP.get(k); }
            if (bmp == null || bmp.isRecycled()) {
                bmp = maker.apply(k);
                if (bmp == null) return null;
                synchronized (MAP) { MAP.put(k, bmp); }
            }
            synchronized (MAP) {
                if (bmp.isRecycled()) return null;
                ByteArrayOutputStream bout = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.JPEG, 62, bout);
                return bout.toByteArray();
            }
        }
    }

    /** 一次性读取结果的缓存有效期：PC 每 1s 轮询，通知→点击一般几秒内完成，60s 够交互又不会长期返回过期内容 */
    private static final long SNAP_TTL_MS = 60_000;

    private Response getClipboard() {
        ClipReader.Snap s = ClipReader.read(ctx);
        if (s != null) return json(s.json(false));
        // Android 10+ 焦点闸门：进程在后台时 getPrimaryClip 返回空，读不到 ≠ 真的空。
        // 用「借焦点一次性读取」（GET /clipboard/pull → 点通知）的缓存兜底。
        if (MainActivity.sForeground) return json("{\"type\":\"empty\",\"sig\":\"\"}");
        ClipReader.Snap cached = BridgeService.getSnap(SNAP_TTL_MS);
        if (cached != null) return json(cached.json(true));
        return json("{\"type\":\"empty\",\"sig\":\"\",\"focusRequired\":true}");
    }

    /** direct start 判定窗口：startActivity 被 BAL 拦截时不抛异常，只能看透明 Activity 有没有真的被创建 */
    private static final long DIRECT_START_WAIT_MS = 700;
    /** logcat 固定 tag：adb logcat -s ZianPull */
    private static final String TAG_PULL = "ZianPull";

    /**
     * 借焦点读取：先按老路径发通知（兜底，路径不变），再尝试直接 startActivity 拉起 1x1 透明 Activity。
     * 直接拉起成功则用户无需点通知；被 BAL / 厂商「后台弹出界面」拦截时静默失败，仍走通知路径。
     * 整段 try/catch：任何异常都不影响 HTTP 响应。
     */
    private Response pullClipboard() {
        BridgeService.requestClipRead(ctx);
        boolean launched = false;
        String note;
        try {
            long before = ClipReadActivity.lastCreateAt();
            Intent i = new Intent(ctx, ClipReadActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            long deadline = System.currentTimeMillis() + DIRECT_START_WAIT_MS;
            while (System.currentTimeMillis() < deadline) {
                if (ClipReadActivity.lastCreateAt() != before) { launched = true; break; }
                try {
                    Thread.sleep(20);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
            note = launched ? "direct start ok" : "direct start blocked";
        } catch (Throwable t) {
            // 部分 ROM 的 BAL 实现直接抛 SecurityException；其余异常同样吞掉
            note = "direct start exception: " + t;
        }
        // 用 W 而非 I：实测该机（vivo OriginOS/Android 16）logcat 对第三方 App 的 I/D 级日志整体过滤，
        // 5s 全缓冲区 0 行 I 级；只有 W/E 可见。用 W 才能 adb logcat -s ZianPull 抓到，功能语义不变。
        Log.w(TAG_PULL, note);
        return json("{\"ok\":true,\"focusRequired\":true,\"launched\":" + launched
                + ",\"launchNote\":\"" + JsonUtil.esc(note) + "\"}");
    }

    private Response setClipboard(IHTTPSession session) throws Exception {
        String contentType = session.getHeaders().get("content-type");
        if (contentType != null && contentType.toLowerCase().contains("multipart/form-data")) {
            java.util.Map<String, String> files = new java.util.HashMap<>();
            session.parseBody(files);
            String tmp = files.get("file");
            if (tmp == null) return json("{\"ok\":false,\"err\":\"no file\"}");
            // 原样读取字节（不 decode->re-encode）：保证手机剪贴板内容与 PC 推送字节一致，
            // 回传的内容哈希才能与 PC 端记录的 sig 对上，否则双向同步死循环。
            byte[] png = IoUtil.readFileBytes(tmp);
            // NanoHTTPD parseBody 会把 multipart 文件写入临时文件（DefaultTempFileManager），
            // 数据已在内存，读取后立即删除，否则每次推图都在 tmp 目录残留一个完整 PNG（磁盘泄漏）
            new File(tmp).delete();
            if (png == null || png.length == 0) return json("{\"ok\":false,\"err\":\"read fail\"}");
            Bitmap bmp = BitmapFactory.decodeByteArray(png, 0, png.length);
            if (bmp == null) return json("{\"ok\":false,\"err\":\"not image\"}");
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            // 文件名用内容哈希 + MediaStore 查重：同一张图无论推送多少次，相册只有一份
            String md5 = IoUtil.md5Hex(png);
            Uri imgUri = writeToMediaStore(png, "clip_" + md5.substring(0, Math.min(10, md5.length())) + ".png");
            if (imgUri != null) {
                ClipData cd = ClipData.newUri(ctx.getContentResolver(), "image", imgUri);
                cm.setPrimaryClip(cd);
                BridgeService.clearSnap();
                return json("{\"ok\":true}");
            }
            return json("{\"ok\":false,\"err\":\"write fail\"}");
        } else {
            // text：NanoHTTPD 对 text/plain 把 body 存到 files 的 "content" key
            java.util.Map<String, String> body = new java.util.HashMap<>();
            try {
                session.parseBody(body);
            } catch (Exception pe) {
                // NanoHTTPD 对含 % 的 raw body 可能抛 URLDecoder 错误，忽略后用 postData
            }
            String text = body.get("content");
            if (text == null) text = body.get("postData");
            if (text == null) text = "";
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData cd = ClipData.newPlainText("zian", text);
            cm.setPrimaryClip(cd);
            BridgeService.clearSnap();
            return json("{\"ok\":true}");
        }
    }

    /** 原样写入 MediaStore（Pictures/ZianClip），同名（内容哈希名）直接复用已有条目，避免相册堆积重复图 */
    private Uri writeToMediaStore(byte[] png, String name) {
        try {
            // 查重：同名条目已存在则直接复用
            android.database.Cursor cur = ctx.getContentResolver().query(
                    android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    new String[]{ android.provider.MediaStore.Images.Media._ID },
                    android.provider.MediaStore.Images.Media.DISPLAY_NAME + "=?",
                    new String[]{ name }, null);
            if (cur != null) {
                boolean found = cur.moveToFirst();
                long id = found ? cur.getLong(0) : -1;
                cur.close();
                if (found) {
                    return android.content.ContentUris.withAppendedId(
                            android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                }
            }
            android.content.ContentValues cv = new android.content.ContentValues();
            cv.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, name);
            cv.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                cv.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ZianClip");
                cv.put(android.provider.MediaStore.Images.Media.IS_PENDING, 1);
            }
            android.net.Uri base = android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            android.net.Uri uri = ctx.getContentResolver().insert(base, cv);
            if (uri == null) return null;
            // try-with-resources：写失败也要关流，否则留下的 IS_PENDING=1 条目在相册里是僵尸
            boolean written = true;
            try {
                java.io.OutputStream os0 = ctx.getContentResolver().openOutputStream(uri);
                if (os0 == null) throw new java.io.IOException("no stream");
                try (java.io.OutputStream out = os0) {
                    out.write(png);
                }
            } catch (Exception e) {
                written = false;
                try { ctx.getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
            }
            if (!written) return null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                cv.clear();
                cv.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0);
                ctx.getContentResolver().update(uri, cv, null, null);
            }
            return uri;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    /** MD5/文件读取见 IoUtil */

    private Response listFiles(IHTTPSession session) {
        java.util.Map<String, List<String>> params = session.getParameters();
        String type = firstParam(params, "type", "all");
        String dir = firstParam(params, "dir", "");
        String json = FileHelper.listFiles(ctx, type, dir);
        return newFixedLengthResponse(Response.Status.OK, "application/json", json);
    }

    private Response getFile(IHTTPSession session) {
        java.util.Map<String, List<String>> params = session.getParameters();
        String path = firstParam(params, "path", null);
        if (path == null) return json("{\"ok\":false,\"err\":\"no path\"}");
        File f = new File(path);
        if (!f.exists() || !f.isFile()) return json("{\"ok\":false,\"err\":\"not found\"}");
        try {
            java.io.FileInputStream fis = new java.io.FileInputStream(f);
            java.io.BufferedInputStream bis = new java.io.BufferedInputStream(fis, 1 << 20);
            String mime = FileHelper.guessMime(path);
            Response res = newFixedLengthResponse(Response.Status.OK, mime, bis, f.length());
            res.addHeader("Content-Disposition", "attachment; filename=\"" + JsonUtil.esc(f.getName()) + "\"");
            res.addHeader("Connection", "keep-alive");
            return res;
        } catch (Exception e) {
            return json("{\"ok\":false,\"err\":\"" + JsonUtil.esc(e.getMessage()) + "\"}");
        }
    }

    private Response openInVivo(IHTTPSession session) {
        java.util.Map<String, List<String>> params = session.getParameters();
        String path = firstParam(params, "path", null);
        String app = firstParam(params, "app", "vivo_office");
        if (path == null) return json("{\"ok\":false,\"err\":\"no path\"}");
        boolean ok = VivoOfficeAdapter.open(ctx, path, app);
        return json("{\"ok\":" + ok + "}");
    }

    /** 令牌校验：请求头 X-Zian-Token 必须与当前配对令牌一致 */
    private boolean authorized(IHTTPSession session) {
        String given = session.getHeaders().get("x-zian-token");
        return given != null && given.equals(Pairing.token(ctx));
    }

    /** 配对引导：回环来源才返回令牌，否则 403 */
    private Response pair(IHTTPSession session) {
        if (isLoopback(session.getRemoteIpAddress())) {
            return json("{\"ok\":true,\"token\":\"" + Pairing.token(ctx) + "\"}");
        }
        return newFixedLengthResponse(Response.Status.FORBIDDEN, "application/json",
                "{\"ok\":false,\"err\":\"pair requires local connection\"}");
    }

    private static boolean isLoopback(String ip) {
        if (ip == null) return false;
        if (ip.startsWith("127.") || "localhost".equals(ip)) return true;
        return "::1".equals(ip) || "0:0:0:0:0:0:0:1".equals(ip);
    }

    /** NanoHTTPD getParameters 返回 Map<String, List<String>>，这里取第一个值。 */
    private String firstParam(java.util.Map<String, List<String>> params, String key, String def) {
        java.util.List<String> v = params.get(key);
        if (v == null || v.isEmpty()) return def;
        return v.get(0);
    }

    private Response json(String s) {
        return newFixedLengthResponse(Response.Status.OK, "application/json", s);
    }
}
