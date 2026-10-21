package com.zian.bridge;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import java.io.File;

/**
 * 调起 vivo 办公套件打开文件。
 * 优先 com.yozo.vivo.office（永中 Office vivo 版），回退 com.vivo.alldocuments。
 * file:// 对第三方应用不可读（FLAG_GRANT_READ_URI_PERMISSION 只对 content:// 生效），
 * 统一走内置 BridgeFileProvider 的 content:// URI。
 */
public class VivoOfficeAdapter {

    public static boolean open(Context ctx, String path, String app) {
        File f = new File(path);
        if (!f.exists()) return false;
        String mime = FileHelper.guessMime(path);
        Uri uri = BridgeFileProvider.uriFor(f);

        String pkg = "vivo_office".equals(app) ? "com.yozo.vivo.office" : "com.vivo.alldocuments";
        if (!launch(ctx, pkg, uri, mime)) {
            // 回退到另一个
            String alt = "com.yozo.vivo.office".equals(pkg) ? "com.vivo.alldocuments" : "com.yozo.vivo.office";
            if (!launch(ctx, alt, uri, mime)) {
                // 最终回退：让系统选择
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, mime);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    ctx.startActivity(i);
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        }
        return true;
    }

    private static boolean launch(Context ctx, String pkg, Uri uri, String mime) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setPackage(pkg);
            i.setDataAndType(uri, mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
