package com.ian.aitrans;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.nl.languageid.LanguageIdentification;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** 裝置端離線翻譯（Google ML Kit）：免費、不用網路、不用金鑰；每個語言第一次使用時下載約 30 MB 語言包。 */
final class Mt {
    private static final Map<String, Translator> CLIENTS = new HashMap<String, Translator>();

    private Mt() { }

    private static String code(String tag) throws Exception {
        if (tag == null || tag.isEmpty()) return null;
        String l = tag.toLowerCase(Locale.ROOT);
        String base = l.startsWith("zh") ? "zh" : l.split("-")[0];
        String c = TranslateLanguage.fromLanguageTag(base);
        if (c == null) throw new Exception("離線翻譯不支援這個語言（" + tag + "）");
        return c;
    }

    private static synchronized Translator client(String s, String t) {
        String k = s + ">" + t;
        Translator c = CLIENTS.get(k);
        if (c == null) {
            c = Translation.getClient(new TranslatorOptions.Builder().setSourceLanguage(s).setTargetLanguage(t).build());
            CLIENTS.put(k, c);
        }
        return c;
    }

    static void prefetch(String src, String tgt) throws Exception {
        String s = code(src), t = code(tgt);
        if (s == null) throw new Exception("請先選擇原文語言（離線翻譯無法在下載語言包時自動偵測）");
        Tasks.await(client(s, t).downloadModelIfNeeded(new DownloadConditions.Builder().build()), 15, TimeUnit.MINUTES);
    }

    static List<String> translate(String src, String tgt, List<String> texts) throws Exception {
        String t = code(tgt), s = code(src);
        if (s == null) {                                  // 自動偵測：用整批文字判斷
            StringBuilder sb = new StringBuilder();
            for (String x : texts) { if (sb.length() < 400) sb.append(x).append('\n'); }
            String tag = Tasks.await(LanguageIdentification.getClient().identifyLanguage(sb.toString()), 20, TimeUnit.SECONDS);
            if (tag == null || "und".equals(tag)) throw new Exception("無法判斷原文語言，請手動選擇原文語言");
            s = code(tag);
        }
        List<String> out = new ArrayList<String>();
        if (s.equals(t)) { out.addAll(texts); return out; }
        Translator tr = client(s, t);
        Tasks.await(tr.downloadModelIfNeeded(new DownloadConditions.Builder().build()), 15, TimeUnit.MINUTES);
        for (String x : texts) out.add(x == null || x.trim().isEmpty() ? x : Tasks.await(tr.translate(x), 60, TimeUnit.SECONDS));
        return out;
    }

    /** 給網頁呼叫：json = {src,tgt,texts:[...]}，完成後送出 'mt' 事件。 */
    static void run(final String id, final String json) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    JSONObject o = new JSONObject(json);
                    if (o.optBoolean("prefetch", false)) {
                        prefetch(o.optString("src", ""), o.optString("tgt", "zh-TW"));
                        MainActivity.emit("mt", new JSONObject().put("id", id).put("ok", true).toString());
                        return;
                    }
                    JSONArray a = o.getJSONArray("texts");
                    List<String> in = new ArrayList<String>();
                    for (int i = 0; i < a.length(); i++) in.add(a.optString(i));
                    List<String> out = translate(o.optString("src", "auto"), o.optString("tgt", "zh-TW"), in);
                    MainActivity.emit("mt", new JSONObject().put("id", id).put("ok", true).put("out", new JSONArray(out)).toString());
                } catch (Throwable t) {
                    try { MainActivity.emit("mt", new JSONObject().put("id", id).put("ok", false).put("err", String.valueOf(t.getMessage())).toString()); } catch (Throwable e) { /* ignore */ }
                }
            }
        }).start();
    }
}
