package com.ian.aitrans;

import android.graphics.Bitmap;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 懸浮翻譯用的翻譯／看圖辨識（Google 翻譯、Claude API）。 */
final class Translator {
    private static final Map<String, String> CACHE = new LinkedHashMap<String, String>(256, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, String> e) { return size() > 400; }
    };
    private static int ep = 0;

    private Translator() { }

    static List<String> translate(JSONObject cfg, List<String> texts) throws Exception {
        String engine = cfg.optString("engine", "google");
        if ("claude".equals(engine)) return claudeTexts(cfg, texts);
        return google(cfg, texts);
    }

    /* ---------------- Google ---------------- */
    private static List<String> google(JSONObject cfg, List<String> texts) throws Exception {
        String sl = cfg.optString("src", "auto"), tl = cfg.optString("tgt", "zh-TW");
        String gKey = cfg.optString("gKey", "");
        List<String> out = new ArrayList<String>();
        if (!gKey.isEmpty()) {
            // 官方 Cloud Translation v2：一次送多句
            StringBuilder body = new StringBuilder();
            for (String t : texts) body.append("q=").append(URLEncoder.encode(t, "UTF-8")).append('&');
            body.append("target=").append(URLEncoder.encode(tl, "UTF-8")).append("&format=text");
            if (!"auto".equals(sl)) body.append("&source=").append(URLEncoder.encode(sl, "UTF-8"));
            Map<String, String> h = new HashMap<String, String>();
            h.put("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
            String r = Util.http("POST", "https://translation.googleapis.com/language/translate/v2?key=" + URLEncoder.encode(gKey, "UTF-8"), h, body.toString(), 20000);
            JSONArray arr = new JSONObject(r).getJSONObject("data").getJSONArray("translations");
            for (int i = 0; i < arr.length(); i++) out.add(arr.getJSONObject(i).getString("translatedText"));
            return out;
        }
        for (String t : texts) out.add(googleOne(t, sl, tl));
        return out;
    }

    private static String googleOne(String text, String sl, String tl) throws Exception {
        String key = sl + "|" + tl + "|" + text;
        synchronized (CACHE) { String c = CACHE.get(key); if (c != null) return c; }
        String[] bases = {"https://translate.googleapis.com/translate_a/single", "https://translate.google.com/translate_a/single"};
        Exception last = null;
        for (int round = 0; round < 2; round++) {
            for (int k = 0; k < bases.length; k++) {
                String base = bases[(ep + k) % bases.length];
                try {
                    String q = "client=gtx&dt=t&ie=UTF-8&oe=UTF-8&sl=" + URLEncoder.encode(sl, "UTF-8") + "&tl=" + URLEncoder.encode(tl, "UTF-8");
                    String r;
                    String enc = URLEncoder.encode(text, "UTF-8");
                    if (enc.length() < 1800) r = Util.http("GET", base + "?" + q + "&q=" + enc, null, null, 15000);
                    else {
                        Map<String, String> h = new HashMap<String, String>();
                        h.put("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
                        r = Util.http("POST", base + "?" + q, h, "q=" + enc, 15000);
                    }
                    JSONArray root = new JSONArray(r);
                    JSONArray segs = root.getJSONArray(0);
                    StringBuilder sb = new StringBuilder();
                    for (int i = 0; i < segs.length(); i++) {
                        JSONArray s = segs.optJSONArray(i);
                        if (s != null && !s.isNull(0)) sb.append(s.getString(0));
                    }
                    String res = sb.toString();
                    synchronized (CACHE) { CACHE.put(key, res); }
                    ep = (ep + k) % bases.length;
                    return res;
                } catch (Exception e) {
                    last = e;
                }
            }
            try { Thread.sleep(400); } catch (InterruptedException ie) { /* ignore */ }
        }
        throw new Exception("Google 翻譯暫時無法使用（" + (last == null ? "" : last.getMessage()) + "）。可在 App 設定填入 Google Cloud 金鑰，或改用 Claude 翻譯。");
    }

    /* ---------------- Claude ---------------- */
    private static String claude(JSONObject cfg, JSONArray content, int maxTokens) throws Exception {
        String key = cfg.optString("aKey", "");
        if (key.isEmpty()) throw new Exception("尚未設定 Anthropic API 金鑰");
        JSONObject body = new JSONObject();
        body.put("model", cfg.optString("model", "claude-sonnet-5-5"));
        body.put("max_tokens", maxTokens);
        JSONObject msg = new JSONObject();
        msg.put("role", "user");
        msg.put("content", content);
        body.put("messages", new JSONArray().put(msg));
        Map<String, String> h = new HashMap<String, String>();
        h.put("content-type", "application/json");
        h.put("x-api-key", key);
        h.put("anthropic-version", "2023-06-01");
        String r = Util.http("POST", "https://api.anthropic.com/v1/messages", h, body.toString(), 60000);
        JSONArray c = new JSONObject(r).getJSONArray("content");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < c.length(); i++) {
            JSONObject b = c.getJSONObject(i);
            if ("text".equals(b.optString("type"))) sb.append(b.optString("text"));
        }
        return sb.toString();
    }

    private static JSONArray extractArray(String s) throws Exception {
        int a = s.indexOf('['), b = s.lastIndexOf(']');
        if (a < 0 || b <= a) throw new Exception("AI 回應格式不正確");
        return new JSONArray(s.substring(a, b + 1));
    }

    private static List<String> claudeTexts(JSONObject cfg, List<String> texts) throws Exception {
        String sn = "auto".equals(cfg.optString("src", "auto")) ? "自動偵測原文語言" : cfg.optString("srcName", "原文");
        String tn = cfg.optString("tgtName", "繁體中文");
        JSONArray in = new JSONArray();
        for (String t : texts) in.put(t);
        String prompt = "你是專業翻譯引擎。把下列 JSON 陣列中的每一段文字從" + sn + "翻譯成" + tn + "，語意自然、專業。" +
            "規則：順序與數量必須完全一致；不要翻譯純數字、代碼、網址；不要加解釋；只回傳 JSON 字串陣列。\n輸入：\n" + in.toString();
        JSONArray content = new JSONArray().put(new JSONObject().put("type", "text").put("text", prompt));
        JSONArray res = extractArray(claude(cfg, content, 3000));
        List<String> out = new ArrayList<String>();
        for (int i = 0; i < texts.size(); i++) out.add(i < res.length() ? res.optString(i, texts.get(i)) : texts.get(i));
        return out;
    }

    /** Claude 看圖：回傳 [原文, 譯文] 清單。 */
    static List<String[]> claudeVision(JSONObject cfg, Bitmap bmp) throws Exception {
        String sn = "auto".equals(cfg.optString("src", "auto")) ? "自動偵測" : cfg.optString("srcName", "原文");
        String tn = cfg.optString("tgtName", "繁體中文");
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 88, bo);
        String b64 = Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
        String prompt = "請辨識這張圖片中的所有文字（依閱讀順序），來源語言：" + sn + "，並翻譯成" + tn + "。每一句話或每一個獨立文字標籤各一項。" +
            "格式：[{\"original\":\"原文\",\"translated\":\"譯文\"}]。只回傳 JSON 陣列；沒有文字就回傳 []。";
        JSONArray content = new JSONArray();
        content.put(new JSONObject().put("type", "image").put("source", new JSONObject().put("type", "base64").put("media_type", "image/jpeg").put("data", b64)));
        content.put(new JSONObject().put("type", "text").put("text", prompt));
        JSONArray res = extractArray(claude(cfg, content, 3000));
        List<String[]> out = new ArrayList<String[]>();
        for (int i = 0; i < res.length(); i++) {
            JSONObject o = res.optJSONObject(i);
            if (o == null) continue;
            String a = o.optString("original", ""), b = o.optString("translated", "");
            if (!a.trim().isEmpty() || !b.trim().isEmpty()) out.add(new String[] {a, b});
        }
        return out;
    }
}
