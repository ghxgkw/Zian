package com.zian.bridge;

/** 协议常量：端口、多播组、版本。修改时必须同步 PC 端与文档附录 A。 */
public final class Constants {
    public static final int PORT_HTTP = 35791;
    public static final int PORT_FILE = 35792;
    public static final String MULTICAST_GROUP = "239.0.0.1";
    public static final String VER = "1.0";

    private Constants() {}
}
