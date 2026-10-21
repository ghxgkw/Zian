package com.zian.bridge;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;

/** IO/哈希工具：MD5 hex、整段读取（带上限）。 */
public final class IoUtil {

    /** 单次整段读入上限 20MB：剪贴板图片/推送 PNG base64 后约 26.7MB，超过按异常内容处理 */
    public static final int MAX_INMEM = 20 * 1024 * 1024;

    private IoUtil() {}

    /** MD5 hex（小写）；异常时退回长度串（与旧实现一致） */
    public static String md5Hex(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] d = md.digest(data);
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xf, 16));
                sb.append(Character.forDigit(b & 0xf, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(data == null ? 0 : data.length);
        }
    }

    /** 读完整流到内存（调用方负责关闭流）；超过 max 字节返回 null */
    public static byte[] readAll(InputStream in, int max) throws Exception {
        ByteArrayOutputStream bout = new ByteArrayOutputStream();
        byte[] buf = new byte[1 << 16];
        int n;
        while ((n = in.read(buf)) > 0) {
            if (bout.size() + n > max) return null;
            bout.write(buf, 0, n);
        }
        return bout.toByteArray();
    }

    /** 读完整流到内存（上限 MAX_INMEM）；超限返回 null */
    public static byte[] readAll(InputStream in) throws Exception {
        return readAll(in, MAX_INMEM);
    }

    /** 读整个文件；失败或超过上限返回 null */
    public static byte[] readFileBytes(String path) {
        try (FileInputStream fis = new FileInputStream(path)) {
            return readAll(fis);
        } catch (Exception e) {
            return null;
        }
    }
}
