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

/** 字幕用的中文字體：Android 的中文字不會因系統「字體家族」改變，所以提供真正的字型檔下載（Google Fonts，開源授權）。 */
final class Fonts {
    private static final String B = "https://raw.githubusercontent.com/google/fonts/main/ofl/";
    /** {id, 顯示名稱, 網址, 約略 MB} */
    static final String[][] LIST = {
        {"notosans", "思源黑體（清晰無襯線）", B + "notosanstc/NotoSansTC%5Bwght%5D.ttf", "12"},
        {"notoserif", "思源宋體（明體）", B + "notoseriftc/NotoSerifTC%5Bwght%5D.ttf", "17"},
        {"wenkai", "霞鶩文楷（楷書）", B + "lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf", "13"},
        {"iansui", "芫荽（手寫風）", B + "iansui/Iansui-Regular.ttf", "9"},
        {"huninn", "粉圓（圓體）", B + "huninn/Huninn-Regular.ttf", "5"},
        {"chocolate", "巧克力黑體（圓潤黑體）", B + "chocolateclassicalsans/ChocolateClassicalSans-Regular.ttf", "12"},
        {"cactus", "仙人掌明體（古典明體）", B + "cactusclassicalserif/CactusClassicalSerif-Regular.ttf", "29"},
    };
    private static final Set<String> BUSY = new HashSet<String>();

    private Fonts() { }

    static String[] find(String id) {
        for (String[] f : LIST) if (f[0].equals(id)) return f;
        return null;
    }

    static File file(Context c, String id) {
        File d = new File(c.getFilesDir(), "fonts");
        if (!d.exists()) d.mkdirs();
        return new File(d, id + ".ttf");
    }

    static boolean ready(Context c, String id) { File f = file(c, id); return f.exists() && f.length() > 100000; }

    static String listJson(Context c) {
        JSONArray a = new JSONArray();
        try {
            for (String[] f : LIST) a.put(new JSONObject().put("id", f[0]).put("name", f[1]).put("url", f[2]).put("mb", Integer.parseInt(f[3])).put("ready", ready(c, f[0])));
        } catch (Throwable t) { /* ignore */ }
        return a.toString();
    }

    private static void event(String id, String st, int pct, String msg) {
        try {
            MainActivity.emit("cap", new JSONObject().put("state", "font").put("id", id).put("st", st).put("pct", pct).put("msg", msg == null ? "" : msg).toString());
        } catch (Throwable t) { /* ignore */ }
    }

    static void delete(Context c, String id) { file(c, id).delete(); event(id, "deleted", 0, ""); }

    static void download(final Context c, final String id) {
        final String[] f = find(id);
        if (f == null) return;
        synchronized (BUSY) { if (!BUSY.add(id)) return; }
        new Thread(new Runnable() {
            @Override public void run() {
                File tmp = new File(file(c, id).getPath() + ".part");
                try {
                    event(id, "download", 0, "");
                    String u = f[2];
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
                        OutputStream out = new FileOutputStream(tmp);
                        byte[] buf = new byte[65536];
                        long got = 0;
                        int n, last = -1;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            got += n;
                            int pct = total > 0 ? (int) (got * 100 / total) : 0;
                            if (pct != last) { last = pct; event(id, "download", pct, ""); }
                        }
                        out.close();
                        in.close();
                        h.disconnect();
                        break;
                    }
                    if (!tmp.exists() || tmp.length() < 100000) throw new Exception("下載的檔案不完整");
                    File dst = file(c, id);
                    dst.delete();
                    if (!tmp.renameTo(dst)) throw new Exception("無法儲存字型檔");
                    event(id, "ready", 100, "");
                } catch (Throwable t) {
                    tmp.delete();
                    event(id, "error", 0, t.getMessage() == null ? t.toString() : t.getMessage());
                } finally {
                    synchronized (BUSY) { BUSY.remove(id); }
                }
            }
        }).start();
    }
}
