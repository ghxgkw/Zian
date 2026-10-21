package com.zian.bridge;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 极简 FileProvider（不引入 AndroidX）：把 file:// 换成 content://。
 * 清单里 exported=false + grantUriPermissions=true，第三方应用只能读被
 * FLAG_GRANT_READ_URI_PERMISSION 临时授权的那个 URI。
 * URI 形如 content://com.zian.bridge.fileprovider/path/<URL 编码后的绝对路径>。
 */
public class BridgeFileProvider extends ContentProvider {

    static final String AUTHORITY = "com.zian.bridge.fileprovider";

    /** 文件 -> 授权用 content URI */
    static Uri uriFor(File f) {
        return Uri.parse("content://" + AUTHORITY + "/path/" + Uri.encode(f.getAbsolutePath()));
    }

    private static File fileOf(Uri uri) throws FileNotFoundException {
        String p = uri.getLastPathSegment();
        if (p == null || p.isEmpty()) throw new FileNotFoundException("no path");
        File f = new File(p);
        if (!f.isFile()) throw new FileNotFoundException(p);
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File f = fileOf(uri);
            String[] cols = projection != null ? projection
                    : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            MatrixCursor c = new MatrixCursor(cols, 1);
            Object[] row = new Object[cols.length];
            for (int i = 0; i < cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
                else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
                else row[i] = null;
            }
            c.addRow(row);
            return c;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public String getType(Uri uri) {
        try {
            return FileHelper.guessMime(fileOf(uri).getAbsolutePath());
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("read only");
        return ParcelFileDescriptor.open(fileOf(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
