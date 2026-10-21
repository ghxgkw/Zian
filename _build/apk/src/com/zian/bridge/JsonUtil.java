package com.zian.bridge;

/** JSON 字符串转义（与 PC 端 JSON.parse 兼容）。 */
public final class JsonUtil {

    private JsonUtil() {}

    public static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }
}
