package com.zian.bridge;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.SecureRandom;

/** 配对令牌：32 位小写十六进制（16 字节 SecureRandom），首次启动生成后持久化在 zian_prefs/token。 */
public final class Pairing {

    private static final String PREFS = "zian_prefs";
    private static final String KEY = "token";
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static volatile String cached;

    private Pairing() {}

    /** 当前令牌（首次调用生成并落盘） */
    static String token(Context ctx) {
        String t = cached;
        if (t != null) return t;
        synchronized (Pairing.class) {
            if (cached != null) return cached;
            SharedPreferences sp = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String v = sp.getString(KEY, null);
            if (v == null || v.length() != 32) {
                v = generate();
                sp.edit().putString(KEY, v).commit();
            }
            cached = v;
            return v;
        }
    }

    /** 重置令牌：旧令牌立即失效 */
    static String reset(Context ctx) {
        synchronized (Pairing.class) {
            String v = generate();
            ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(KEY, v).commit();
            cached = v;
            return v;
        }
    }

    private static String generate() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder(32);
        for (byte x : b) {
            sb.append(HEX[(x >> 4) & 0xf]).append(HEX[x & 0xf]);
        }
        return sb.toString();
    }
}
