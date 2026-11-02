package com.ian.aitrans;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** 即時字幕用的離線語音辨識模型（Vosk）：第一次使用時才下載，之後完全離線。 */
final class Models {
    /** {代碼, 模型資料夾名稱, 顯示名稱, Google 語言代碼, 約略大小MB} */
    static final String[][] LIST = {
        {"en", "vosk-model-small-en-us-0.15", "英文", "en", "40"},
        {"cn", "vosk-model-small-cn-0.22", "中文（普通話）", "zh-CN", "42"},
        {"ja", "vosk-model-small-ja-0.22", "日文", "ja", "48"},
        {"ko", "vosk-model-small-ko-0.22", "韓文", "ko", "82"},
        {"es", "vosk-model-small-es-0.42", "西班牙文", "es", "39"},
        {"fr", "vosk-model-small-fr-0.22", "法文", "fr", "41"},
        {"de", "vosk-model-small-de-0.15", "德文", "de", "45"},
        {"ru", "vosk-model-small-ru-0.22", "俄文", "ru", "45"},
        {"pt", "vosk-model-small-pt-0.3", "葡萄牙文", "pt", "31"},
        {"it", "vosk-model-small-it-0.22", "義大利文", "it", "48"},
        {"vi", "vosk-model-small-vn-0.4", "越南文", "vi", "32"},
        {"tr", "vosk-model-small-tr-0.3", "土耳其文", "tr", "35"},
        {"hi", "vosk-model-small-hi-0.22", "印地文", "hi", "42"},
    };
    private static final Set<String> BUSY = new HashSet<String>();

    private Models() { }

    static String[] find(String code) {
        for (String[] m : LIST) if (m[0].equals(code)) return m;
        return null;
    }

    static File root(Context c) {
        File d = new File(c.getFilesDir(), "vosk");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File dir(Context c, String code) {
        String[] m = find(code);
        return m == null ? null : new File(root(c), m[1]);
    }

    static boolean ready(Context c, String code) {
        File d = dir(c, code);
        return d != null && new File(d, ".ok").exists();
    }

    static String listJson(Context c) {
        JSONArray a = new JSONArray();
        try {
            for (String[] m : LIST) {
                a.put(new JSONObject().put("code", m[0]).put("name", m[2]).put("g", m[3]).put("mb", Integer.parseInt(m[4])).put("ready", ready(c, m[0])));
            }
        } catch (Throwable t) { /* ignore */ }
        return a.toString();
    }

    private static void event(String code, String state, int pct, String msg) {
        try {
            MainActivity.emit("cap", new JSONObject().put("state", "model").put("code", code).put("st", state).put("pct", pct).put("msg", msg == null ? "" : msg).toString());
        } catch (Throwable t) { /* ignore */ }
    }

    static void delete(Context c, String code) {
        File d = dir(c, code);
        if (d != null) rm(d);
        event(code, "deleted", 0, "");
    }

    private static void rm(File f) {
        File[] k = f.listFiles();
        if (k != null) for (File x : k) rm(x);
        f.delete();
    }

    static void download(final Context c, final String code) {
        final String[] m = find(code);
        if (m == null) return;
        synchronized (BUSY) { if (!BUSY.add(code)) return; }
        new Thread(new Runnable() {
            @Override public void run() {
                File zip = new File(c.getCacheDir(), m[1] + ".zip");
                try {
                    event(code, "download", 0, "");
                    String u = "https://alphacephei.com/vosk/models/" + m[1] + ".zip";
                    for (int hop = 0; hop < 5; hop++) {
                        HttpURLConnection h = (HttpURLConnection) new URL(u).openConnection();
                        h.setInstanceFollowRedirects(false);
                        h.setConnectTimeout(20000);
                        h.setReadTimeout(60000);
                        int rc = h.getResponseCode();
                        if (rc >= 300 && rc < 400) { u = new URL(new URL(u), h.getHeaderField("Location")).toString(); h.disconnect(); continue; }
                        if (rc != 200) throw new Exception("下載失敗（HTTP " + rc + "）");
                        long total = h.getContentLengthLong();
                        InputStream in = h.getInputStream();
                        OutputStream out = new FileOutputStream(zip);
                        byte[] buf = new byte[65536];
                        long got = 0;
                        int n, lastPct = -1;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            got += n;
                            int pct = total > 0 ? (int) (got * 100 / total) : 0;
                            if (pct != lastPct) { lastPct = pct; event(code, "download", pct, ""); }
                        }
                        out.close();
                        in.close();
                        h.disconnect();
                        break;
                    }
                    if (!zip.exists() || zip.length() < 1000000) throw new Exception("下載的檔案不完整");
                    event(code, "unzip", 100, "");
                    File root = root(c);
                    File target = new File(root, m[1]);
                    rm(target);
                    unzip(zip, root);
                    if (!target.exists()) throw new Exception("解壓縮後找不到模型資料夾");
                    new File(target, ".ok").createNewFile();
                    event(code, "ready", 100, "");
                } catch (Throwable t) {
                    event(code, "error", 0, t.getMessage() == null ? t.toString() : t.getMessage());
                } finally {
                    zip.delete();
                    synchronized (BUSY) { BUSY.remove(code); }
                }
            }
        }).start();
    }

    private static void unzip(File zip, File dest) throws Exception {
        String base = dest.getCanonicalPath() + File.separator;
        ZipInputStream z = new ZipInputStream(new java.io.BufferedInputStream(new java.io.FileInputStream(zip)));
        try {
            ZipEntry e;
            byte[] buf = new byte[65536];
            while ((e = z.getNextEntry()) != null) {
                File f = new File(dest, e.getName());
                if (!f.getCanonicalPath().startsWith(base)) throw new Exception("壓縮檔路徑不安全");
                if (e.isDirectory()) { f.mkdirs(); continue; }
                f.getParentFile().mkdirs();
                OutputStream o = new FileOutputStream(f);
                int n;
                while ((n = z.read(buf)) > 0) o.write(buf, 0, n);
                o.close();
            }
        } finally { z.close(); }
    }
}
