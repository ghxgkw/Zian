package com.zian.bridge;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.net.Uri;
import android.util.Base64;

import java.nio.charset.StandardCharsets;

/**
 * 剪贴板读取：GET /clipboard 与「借焦点一次性读取」共用同一份解析逻辑。
 * sig 与旧实现完全一致（图片 img:len:md5前8，文本 txt:len:md5前8），PC 端依赖它去重。
 */
public final class ClipReader {

    private ClipReader() {}

    /** 一次读取结果 */
    static final class Snap {
        final String type;   // text | image | intent
        final String mime;   // 仅 image
        final byte[] raw;    // 文本 UTF-8 字节 / 图片原始字节
        final String sig;
        final long at = System.currentTimeMillis();

        Snap(String type, String mime, byte[] raw, String sig) {
            this.type = type;
            this.mime = mime;
            this.raw = raw;
            this.sig = sig;
        }

        /** JSON 与旧 /clipboard 响应逐字段一致；cached=true 时仅在末尾追加 "cached":true */
        String json(boolean cached) {
            String tail = cached ? ",\"cached\":true" : "";
            if ("image".equals(type)) {
                return "{\"type\":\"image\",\"mime\":\""
                        + JsonUtil.esc(mime == null ? "image/png" : mime)
                        + "\",\"data\":\"" + Base64.encodeToString(raw, Base64.NO_WRAP)
                        + "\",\"sig\":\"" + sig + "\"" + tail + "}";
            }
            if ("text".equals(type)) {
                return "{\"type\":\"text\",\"data\":\""
                        + Base64.encodeToString(raw, Base64.NO_WRAP)
                        + "\",\"sig\":\"" + sig + "\"" + tail + "}";
            }
            if ("intent".equals(type)) {
                return "{\"type\":\"intent\",\"data\":\"\",\"sig\":\"" + sig + "\"" + tail + "}";
            }
            return "{\"type\":\"empty\",\"sig\":\"\"" + tail + "}";
        }
    }

    /** 读当前剪贴板；真的没有内容（或后台无焦点读不到）返回 null */
    static Snap read(Context ctx) {
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip()) return null;
        ClipData cd = cm.getPrimaryClip();
        if (cd == null || cd.getItemCount() == 0) return null;
        ClipData.Item item = cd.getItemAt(0);
        if (item == null) return null;

        // 优先：URI（图片）
        Uri uri = item.getUri();
        if (uri != null) {
            try (java.io.InputStream in = ctx.getContentResolver().openInputStream(uri)) {
                // 上限 IoUtil.MAX_INMEM（20MB）：整段读入再 base64 会把内存翻倍，超限按无图处理
                byte[] bytes = IoUtil.readAll(in);
                if (bytes != null) {
                    String md5 = IoUtil.md5Hex(bytes);
                    String sig = "img:" + bytes.length + ":" + md5.substring(0, Math.min(8, md5.length()));
                    String mime = ctx.getContentResolver().getType(uri);
                    return new Snap("image", mime, bytes, sig);
                }
            } catch (Exception e) {
                // fall through to text
            }
        }
        // 文本
        CharSequence text = item.getText();
        if (text != null) {
            byte[] raw = text.toString().getBytes(StandardCharsets.UTF_8);
            String md5 = IoUtil.md5Hex(raw);
            return new Snap("text", null, raw, "txt:" + raw.length + ":" + md5.substring(0, Math.min(8, md5.length())));
        }
        // Intent（如复制快捷方式）
        if (item.getIntent() != null) return new Snap("intent", null, null, "");
        return null;
    }
}
