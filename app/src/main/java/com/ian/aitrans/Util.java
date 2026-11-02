package com.ian.aitrans;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

final class Util {
    private Util() { }

    static int dp(Context c, float v) { return (int) (v * c.getResources().getDisplayMetrics().density + 0.5f); }

    /** 簡單的 HTTP 請求；非 2xx 會丟出含狀態碼與內容片段的例外。 */
    static String http(String method, String url, Map<String, String> headers, String body, int timeoutMs) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
            if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) c.setRequestProperty(e.getKey(), e.getValue());
            if (body != null) {
                c.setDoOutput(true);
                byte[] b = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(b.length);
                OutputStream os = c.getOutputStream();
                os.write(b);
                os.close();
            }
            int code = c.getResponseCode();
            InputStream in = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
            String text = in == null ? "" : readAll(in);
            if (code < 200 || code >= 300) {
                String snip = text.length() > 300 ? text.substring(0, 300) : text;
                throw new Exception("HTTP " + code + (snip.isEmpty() ? "" : "：" + snip));
            }
            return text;
        } finally {
            c.disconnect();
        }
    }

    static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        in.close();
        return new String(o.toByteArray(), StandardCharsets.UTF_8);
    }

    /** 存到「下載/AI全能翻譯」資料夾，回傳給使用者看的路徑。 */
    static String saveDownload(Context c, String name, String mime, byte[] data) throws Exception {
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]", "_");
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AI全能翻譯");
            Uri u = c.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (u == null) throw new Exception("無法建立檔案");
            OutputStream o = c.getContentResolver().openOutputStream(u);
            if (o == null) throw new Exception("無法寫入檔案");
            o.write(data);
            o.close();
            return "下載/AI全能翻譯/" + safe;
        }
        File d = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AI全能翻譯");
        if (!d.exists() && !d.mkdirs()) throw new Exception("無法建立資料夾");
        File f = new File(d, safe);
        FileOutputStream o = new FileOutputStream(f);
        o.write(data);
        o.close();
        return "下載/AI全能翻譯/" + safe;
    }
}
