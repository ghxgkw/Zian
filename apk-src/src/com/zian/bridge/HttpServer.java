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
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
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

    private static final int PORT = 35791;
    private final Context ctx;

    public HttpServer(Context ctx) {
        super(PORT);
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
        try {
            if ("/ping".equals(uri)) return ping();
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
        String ip = getIp();
        String fg = MainActivity.sForeground ? "true" : "false";
        String json = String.format(
                "{\"ok\":true,\"name\":\"%s\",\"model\":\"%s\",\"android\":\"%s\",\"ver\":\"1.0\",\"ip\":\"%s\",\"brand\":\"%s\",\"fg\":%s}",
                safe(name), safe(name), safe(androidVer), safe(ip), safe(brand), fg);
        return newFixedLengthResponse(Response.Status.OK, "application/json", json);
    }

    /** 缩略图：图片采样解码 / 视频抽帧，统一 480px JPEG + LRU 缓存 */
    private Response getThumb(IHTTPSession session) {
        String path = firstParam(session.getParameters(), "path", null);
        if (path == null) return json("{\"ok\":false,\"err\":\"no path\"}");
        Bitmap bmp = ThumbCache.get(path);
        if (bmp == null) {
            bmp = makeThumb(path);
            if (bmp == null) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "no thumb");
            ThumbCache.put(path, bmp);
        }
        ByteArrayOutputStream bout = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 62, bout);
        return newFixedLengthResponse(Response.Status.OK, "image/jpeg",
                new java.io.ByteArrayInputStream(bout.toByteArray()), bout.size());
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
                mmr.setDataSource(path);
                Bitmap src = mmr.getFrameAtTime(1_000_000, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                mmr.release();
                return scaleDown(src);
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

    /** 简单 LRU 位图缓存（上限 96 张） */
    private static class ThumbCache {
        private static final java.util.LinkedHashMap<String, Bitmap> MAP =
                new java.util.LinkedHashMap<String, Bitmap>(32, 0.75f, true) {
                    protected boolean removeEldestEntry(java.util.Map.Entry<String, Bitmap> e) {
                        return size() > 96;
                    }
                };
        static Bitmap get(String k) { synchronized (MAP) { return MAP.get(k); } }
        static void put(String k, Bitmap v) { synchronized (MAP) { MAP.put(k, v); } }
    }

    private Response getClipboard() {
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        if (!cm.hasPrimaryClip() || cm.getPrimaryClip() == null) {
            return json("{\"type\":\"empty\",\"sig\":\"\"}");
        }
        ClipData cd = cm.getPrimaryClip();
        ClipData.Item item = cd.getItemAt(0);
        // sig 必须是内容哈希（与 PC 端格式 type:len:hash8 对齐）。
        // 以前用 System.currentTimeMillis()，PC 端每次轮询都当成新内容，
        // 导致 PC<->手机双向同步死循环、相册堆满重复图。
        String sig = "";

        // 优先：URI（图片）
        Uri uri = item.getUri();
        if (uri != null) {
            try {
                java.io.InputStream in = ctx.getContentResolver().openInputStream(uri);
                ByteArrayOutputStream bout = new ByteArrayOutputStream();
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) bout.write(buf, 0, n);
                in.close();
                String md5 = md5Hex(bout.toByteArray());
                sig = "img:" + bout.size() + ":" + md5.substring(0, Math.min(8, md5.length()));
                String b64 = Base64.encodeToString(bout.toByteArray(), Base64.NO_WRAP);
                String mime = ctx.getContentResolver().getType(uri);
                if (mime == null) mime = "image/png";
                return json("{\"type\":\"image\",\"mime\":\"" + safe(mime) + "\",\"data\":\"" + b64 + "\",\"sig\":\"" + sig + "\"}");
            } catch (Exception e) {
                // fall through to text
            }
        }
        // 文本
        CharSequence text = item.getText();
        if (text != null) {
            String t = text.toString();
            byte[] raw = t.getBytes(StandardCharsets.UTF_8);
            String md5 = md5Hex(raw);
            sig = "txt:" + raw.length + ":" + md5.substring(0, Math.min(8, md5.length()));
            String b64 = Base64.encodeToString(raw, Base64.NO_WRAP);
            return json("{\"type\":\"text\",\"data\":\"" + b64 + "\",\"sig\":\"" + sig + "\"}");
        }
        // Intent（如复制快捷方式）
        Intent intent = item.getIntent();
        if (intent != null) {
            return json("{\"type\":\"intent\",\"data\":\"\",\"sig\":\"" + sig + "\"}");
        }
        return json("{\"type\":\"empty\",\"sig\":\"\"}");
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
            byte[] png = readFileBytes(tmp);
            // NanoHTTPD parseBody 会把 multipart 文件写入临时文件（DefaultTempFileManager），
            // 数据已在内存，读取后立即删除，否则每次推图都在 tmp 目录残留一个完整 PNG（磁盘泄漏）
            new File(tmp).delete();
            if (png == null || png.length == 0) return json("{\"ok\":false,\"err\":\"read fail\"}");
            Bitmap bmp = BitmapFactory.decodeByteArray(png, 0, png.length);
            if (bmp == null) return json("{\"ok\":false,\"err\":\"not image\"}");
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            // 文件名用内容哈希 + MediaStore 查重：同一张图无论推送多少次，相册只有一份
            String md5 = md5Hex(png);
            Uri imgUri = writeToMediaStore(png, "clip_" + md5.substring(0, Math.min(10, md5.length())) + ".png");
            if (imgUri != null) {
                ClipData cd = ClipData.newUri(ctx.getContentResolver(), "image", imgUri);
                cm.setPrimaryClip(cd);
                if (clip != null) clip.echoGuard(imgUri.toString());
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
            if (text.length() > 2 && text.startsWith("\"") && text.endsWith("\"")) {
                text = text.substring(1, text.length() - 1);
            }
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData cd = ClipData.newPlainText("zian", text);
            cm.setPrimaryClip(cd);
            if (clip != null) clip.echoGuard(text);
            return json("{\"ok\":true}");
        }
    }

    private ClipboardWatcher clip;
    public void setClipboardWatcher(ClipboardWatcher w) { this.clip = w; }

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
            java.io.OutputStream out = ctx.getContentResolver().openOutputStream(uri);
            out.write(png);
            out.close();
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

    /** MD5 hex（小写），异常时退回长度串 */
    private String md5Hex(byte[] data) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
            byte[] d = md.digest(data);
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(data == null ? 0 : data.length);
        }
    }

    /** 读取整个文件到内存 */
    private byte[] readFileBytes(String path) {
        try {
            java.io.FileInputStream fis = new java.io.FileInputStream(path);
            ByteArrayOutputStream bout = new ByteArrayOutputStream();
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = fis.read(buf)) > 0) bout.write(buf, 0, n);
            fis.close();
            return bout.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

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
            res.addHeader("Content-Disposition", "attachment; filename=\"" + safe(f.getName()) + "\"");
            res.addHeader("Connection", "keep-alive");
            return res;
        } catch (Exception e) {
            return json("{\"ok\":false,\"err\":\"" + safe(e.getMessage()) + "\"}");
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

    /** NanoHTTPD getParameters 返回 Map<String, List<String>>，这里取第一个值。 */
    private String firstParam(java.util.Map<String, List<String>> params, String key, String def) {
        java.util.List<String> v = params.get(key);
        if (v == null || v.isEmpty()) return def;
        return v.get(0);
    }

    private Response json(String s) {
        return newFixedLengthResponse(Response.Status.OK, "application/json", s);
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

    private String safe(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }
}
