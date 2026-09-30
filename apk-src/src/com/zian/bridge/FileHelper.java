package com.zian.bridge;

import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * MediaStore 列表查询。
 * type: images | videos | music | docs | all | storage
 * dir : 当 type=all/storage 时按目录列
 */
public class FileHelper {

    public static String listFiles(Context ctx, String type, String dir) {
        List<Item> items = new ArrayList<>();
        switch (type == null ? "all" : type) {
            case "images": items = queryMediaStore(ctx, MediaStore.Images.Media.EXTERNAL_CONTENT_URI); break;
            case "videos": items = queryMediaStore(ctx, MediaStore.Video.Media.EXTERNAL_CONTENT_URI); break;
            case "music":  items = queryMediaStore(ctx, MediaStore.Audio.Media.EXTERNAL_CONTENT_URI); break;
            case "docs":   items = queryDocs(ctx); break;
            case "storage": items = listDir(dir.isEmpty() ? Environment.getExternalStorageDirectory().getAbsolutePath() : dir); break;
            case "all":
            default:
                items = listDir(dir.isEmpty() ? Environment.getExternalStorageDirectory().getAbsolutePath() : dir); break;
        }
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) sb.append(',');
            Item it = items.get(i);
            sb.append("{\"name\":\"").append(esc(it.name)).append("\",")
              .append("\"path\":\"").append(esc(it.path)).append("\",")
              .append("\"size\":").append(it.size).append(',')
              .append("\"modified\":").append(it.modified).append(',')
              .append("\"dir\":").append(it.dir ? "true" : "false").append('}');
        }
        sb.append(']');
        return sb.toString();
    }

    static class Item {
        String name, path; long size, modified; boolean dir;
    }

    private static List<Item> queryMediaStore(Context ctx, Uri base) {
        List<Item> out = new ArrayList<>();
        String[] proj = {MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.DATE_MODIFIED,
                MediaStore.MediaColumns.DATA};
        try (android.database.Cursor c = ctx.getContentResolver().query(base, proj, null, null, "DATE_MODIFIED DESC")) {
            if (c == null) return out;
            int idxName = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME);
            int idxId   = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int idxSize = c.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE);
            int idxMod  = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED);
            int idxData = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA);
            while (c.moveToNext()) {
                Item it = new Item();
                it.name = c.getString(idxName);
                long id = c.getLong(idxId);
                // 优先用 _DATA 真实路径（下载快），无则用 content URI
                String data = idxData >= 0 ? c.getString(idxData) : null;
                it.path = (data != null && !data.isEmpty()) ? data
                        : Uri.withAppendedPath(base, String.valueOf(id)).toString();
                it.size = c.getLong(idxSize);
                it.modified = c.getLong(idxMod);
                it.dir = false;
                out.add(it);
            }
        } catch (Exception e) {}
        return out;
    }

    private static List<Item> queryDocs(Context ctx) {
        // MediaStore.Files 对第三方 app 不返回非媒体文件（Android 11+ 限制），
        // 改为直接扫描常见文档目录（两层），按扩展名过滤
        String[] docExts = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
                ".txt", ".md", ".csv", ".rtf", ".wps", ".et", ".dps", ".epub", ".mobi"};
        String[] roots = {
                Environment.getExternalStorageDirectory().getAbsolutePath() + "/Documents",
                Environment.getExternalStorageDirectory().getAbsolutePath() + "/Download",
                Environment.getExternalStorageDirectory().getAbsolutePath() + "/vivo"};  // vivo 办公套件常用目录
        List<Item> out = new ArrayList<>();
        for (String root : roots) {
            File rf = new File(root);
            if (!rf.exists() || !rf.isDirectory()) continue;
            File[] subs = rf.listFiles();
            if (subs == null) continue;
            for (File f : subs) {
                if (f.isDirectory()) {
                    // 第二层
                    File[] subs2 = f.listFiles();
                    if (subs2 == null) continue;
                    for (File f2 : subs2) {
                        if (isDoc(f2.getName(), docExts)) out.add(toItem(f2));
                    }
                } else if (isDoc(f.getName(), docExts)) {
                    out.add(toItem(f));
                }
            }
        }
        // 按修改时间倒序
        out.sort((a, b) -> Long.compare(b.modified, a.modified));
        return out;
    }

    private static boolean isDoc(String name, String[] exts) {
        String n = name.toLowerCase();
        for (String e : exts) if (n.endsWith(e)) return true;
        return false;
    }

    private static Item toItem(File f) {
        Item it = new Item();
        it.name = f.getName();
        it.path = f.getAbsolutePath();
        it.size = f.isFile() ? f.length() : 0;
        it.modified = f.lastModified();
        it.dir = false;
        return it;
    }

    private static List<Item> listDir(String dir) {
        List<Item> out = new ArrayList<>();
        File root = new File(dir);
        if (!root.exists() || !root.isDirectory()) return out;
        File[] subs = root.listFiles();
        if (subs == null) return out;
        // 目录优先
        List<File> sorted = new ArrayList<>();
        for (File f : subs) if (f.isDirectory()) sorted.add(f);
        for (File f : subs) if (f.isFile()) sorted.add(f);
        for (File f : sorted) {
            Item it = new Item();
            it.name = f.getName();
            it.path = f.getAbsolutePath();
            it.size = f.isFile() ? f.length() : 0;
            it.modified = f.lastModified();
            it.dir = f.isDirectory();
            out.add(it);
        }
        return out;
    }

    public static String guessMime(String path) {
        if (path == null) return "application/octet-stream";
        String p = path.toLowerCase();
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".bmp")) return "image/bmp";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".mp4")) return "video/mp4";
        if (p.endsWith(".mkv")) return "video/x-matroska";
        if (p.endsWith(".avi")) return "video/x-msvideo";
        if (p.endsWith(".mov")) return "video/quicktime";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".flac")) return "audio/flac";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".aac")) return "audio/aac";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".m4a")) return "audio/mp4";
        if (p.endsWith(".txt")) return "text/plain";
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".pdf")) return "application/pdf";
        if (p.endsWith(".doc")) return "application/msword";
        if (p.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (p.endsWith(".xls")) return "application/vnd.ms-excel";
        if (p.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (p.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
        if (p.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        if (p.endsWith(".zip")) return "application/zip";
        if (p.endsWith(".apk")) return "application/vnd.android.package-archive";
        return "application/octet-stream";
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }
}
