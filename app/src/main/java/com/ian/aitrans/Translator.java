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
import java.util.Locale;
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
        if ("none".equals(engine)) return new ArrayList<String>(texts);
        if ("claude".equals(engine) || "gemini".equals(engine) || "openai".equals(engine)) return llmTexts(cfg, texts, engine);
        if ("deepl".equals(engine)) return deepl(cfg, texts);
        if ("mlkit".equals(engine)) return Mt.translate(cfg.optString("src", "auto"), cfg.optString("tgt", "zh-TW"), texts);
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

    /* ---------------- Gemini（免費金鑰）／OpenAI 相容（Groq、OpenRouter、Ollama…） ---------------- */
    private static String gemini(JSONObject cfg, String prompt, String imgB64, String mime, boolean json) throws Exception {
        String key = cfg.optString("gemKey", "");
        if (key.isEmpty()) throw new Exception("尚未設定 Gemini API 金鑰");
        String model = cfg.optString("gemModel", "gemini-2.5-flash");
        JSONArray parts = new JSONArray();
        if (imgB64 != null) parts.put(new JSONObject().put("inline_data", new JSONObject().put("mime_type", mime).put("data", imgB64)));
        parts.put(new JSONObject().put("text", prompt));
        JSONObject gc = new JSONObject().put("temperature", 0.2);
        if (json) gc.put("responseMimeType", "application/json");
        JSONObject body = new JSONObject().put("contents", new JSONArray().put(new JSONObject().put("role", "user").put("parts", parts))).put("generationConfig", gc);
        Map<String, String> h = new HashMap<String, String>();
        h.put("content-type", "application/json");
        String r;
        try {
            r = Util.http("POST", "https://generativelanguage.googleapis.com/v1beta/models/" + URLEncoder.encode(model, "UTF-8") + ":generateContent?key=" + URLEncoder.encode(key, "UTF-8"), h, body.toString(), 60000);
        } catch (Exception e) {
            String m = String.valueOf(e.getMessage());
            if (m.contains("HTTP 429")) throw new Exception("Gemini 免費額度或速率已達上限，稍後再試或換較小的模型（flash-lite）");
            if (m.contains("HTTP 400") && m.contains("API key")) throw new Exception("Gemini 金鑰無效");
            throw e;
        }
        JSONObject root = new JSONObject(r);
        JSONArray cands = root.optJSONArray("candidates");
        if (cands == null || cands.length() == 0) throw new Exception("Gemini 沒有回應內容（可能被安全過濾）");
        JSONArray ps = cands.getJSONObject(0).getJSONObject("content").getJSONArray("parts");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ps.length(); i++) sb.append(ps.getJSONObject(i).optString("text"));
        return sb.toString();
    }

    private static String openai(JSONObject cfg, String prompt, String imgB64, String mime) throws Exception {
        String base = cfg.optString("oaiBase", "").trim();
        if (base.isEmpty()) throw new Exception("尚未設定 OpenAI 相容 API 網址");
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        Object content = prompt;
        if (imgB64 != null) {
            content = new JSONArray().put(new JSONObject().put("type", "text").put("text", prompt))
                .put(new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", "data:" + mime + ";base64," + imgB64)));
        }
        JSONObject body = new JSONObject().put("model", cfg.optString("oaiModel", "")).put("temperature", 0.2)
            .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", content)));
        Map<String, String> h = new HashMap<String, String>();
        h.put("content-type", "application/json");
        String k = cfg.optString("oaiKey", "");
        if (!k.isEmpty()) h.put("Authorization", "Bearer " + k);
        String r = Util.http("POST", base + "/chat/completions", h, body.toString(), 90000);
        return new JSONObject(r).getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content");
    }

    private static String callLlm(JSONObject cfg, String engine, String prompt, String imgB64, String mime) throws Exception {
        if ("gemini".equals(engine)) return gemini(cfg, prompt, imgB64, mime, true);
        if ("openai".equals(engine)) return openai(cfg, prompt, imgB64, mime);
        JSONArray content = new JSONArray();
        if (imgB64 != null) content.put(new JSONObject().put("type", "image").put("source", new JSONObject().put("type", "base64").put("media_type", mime).put("data", imgB64)));
        content.put(new JSONObject().put("type", "text").put("text", prompt));
        return claude(cfg, content, 3000);
    }

    private static List<String> llmTexts(JSONObject cfg, List<String> texts, String engine) throws Exception {
        String sn = "auto".equals(cfg.optString("src", "auto")) ? "自動偵測原文語言" : cfg.optString("srcName", "原文");
        String tn = cfg.optString("tgtName", "繁體中文");
        JSONArray in = new JSONArray();
        for (String t : texts) in.put(t);
        String prompt = "你是專業翻譯引擎。把下列 JSON 陣列中的每一段文字從" + sn + "翻譯成" + tn + "，語意自然、專業。" +
            "規則：順序與數量必須完全一致；不要翻譯純數字、代碼、網址；不要加解釋；只回傳 JSON 字串陣列。\n輸入：\n" + in.toString();
        JSONArray res = extractArray(callLlm(cfg, engine, prompt, null, null));
        List<String> out = new ArrayList<String>();
        for (int i = 0; i < texts.size(); i++) out.add(i < res.length() ? res.optString(i, texts.get(i)) : texts.get(i));
        return out;
    }

    /* ---------------- DeepL（免費金鑰；額度 50 萬字／月） ---------------- */
    private static String deeplCode(String c, boolean target) {
        if (c == null || c.isEmpty() || "auto".equals(c)) return null;
        String l = c.toLowerCase(Locale.ROOT);
        if (l.equals("zh-tw") || l.equals("zh-hant")) return target ? "ZH-HANT" : "ZH";
        if (l.startsWith("zh")) return target ? "ZH-HANS" : "ZH";
        String b = l.split("-")[0].toUpperCase(Locale.ROOT);
        if (target && b.equals("EN")) return "EN-US";
        if (target && b.equals("PT")) return "PT-BR";
        return b;
    }

    private static List<String> deepl(JSONObject cfg, List<String> texts) throws Exception {
        String key = cfg.optString("deeplKey", "");
        if (key.isEmpty()) throw new Exception("尚未設定 DeepL 金鑰");
        String host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
        JSONArray arr = new JSONArray();
        for (String t : texts) arr.put(t);
        JSONObject body = new JSONObject().put("text", arr).put("target_lang", deeplCode(cfg.optString("tgt", "zh-TW"), true));
        String sl = deeplCode(cfg.optString("src", "auto"), false);
        if (sl != null) body.put("source_lang", sl);
        Map<String, String> h = new HashMap<String, String>();
        h.put("content-type", "application/json");
        h.put("Authorization", "DeepL-Auth-Key " + key);
        JSONArray tr = new JSONObject(Util.http("POST", host + "/v2/translate", h, body.toString(), 30000)).getJSONArray("translations");
        List<String> out = new ArrayList<String>();
        for (int i = 0; i < texts.size(); i++) out.add(i < tr.length() ? tr.getJSONObject(i).optString("text", texts.get(i)) : texts.get(i));
        return out;
    }

    /** 看圖辨識＋翻譯（Claude／Gemini／OpenAI 相容的視覺模型）：回傳 [原文, 譯文] 清單。 */
    static List<String[]> vision(JSONObject cfg, Bitmap bmp, String engine) throws Exception {
        String sn = "auto".equals(cfg.optString("src", "auto")) ? "自動偵測" : cfg.optString("srcName", "原文");
        String tn = cfg.optString("tgtName", "繁體中文");
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 88, bo);
        String b64 = Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
        String prompt = "請辨識這張圖片中的所有文字（依閱讀順序），來源語言：" + sn + "，並翻譯成" + tn + "。每一句話或每一個獨立文字標籤各一項。" +
            "格式：[{\"original\":\"原文\",\"translated\":\"譯文\"}]。只回傳 JSON 陣列；沒有文字就回傳 []。";
        JSONArray res = extractArray(callLlm(cfg, engine, prompt, b64, "image/jpeg"));
        List<String[]> out = new ArrayList<String[]>();
        for (int i = 0; i < res.length(); i++) {
            JSONObject o = res.optJSONObject(i);
            if (o == null) continue;
            String a = o.optString("original", ""), b = o.optString("translated", "");
            if (!a.trim().isEmpty() || !b.trim().isEmpty()) out.add(new String[] {a, b});
        }
        return out;
    }

    static List<String[]> claudeVision(JSONObject cfg, Bitmap bmp) throws Exception { return vision(cfg, bmp, "claude"); }

    /** 聲音片段（WAV）→ {原文, 譯文}（Gemini 能直接聽音檔；自動辨識語言）。 */
    static String[] geminiAudio(JSONObject cfg, byte[] wav, boolean translate) throws Exception {
        String tn = cfg.optString("tgtName", "繁體中文");
        String prompt = "Transcribe the speech in this audio clip (detect the language automatically)." + (translate ? " Then translate it into " + tn + "." : "") +
            " Reply ONLY with JSON: {\"original\":\"...\"" + (translate ? ",\"translation\":\"...\"" : "") + "}. " +
            "If there is no clear human speech (silence, music, noise), reply {\"original\":\"\"" + (translate ? ",\"translation\":\"\"" : "") + "}. Never invent text.";
        String r = gemini(cfg, prompt, Base64.encodeToString(wav, Base64.NO_WRAP), "audio/wav", true);
        int a = r.indexOf('{'), b = r.lastIndexOf('}');
        if (a < 0 || b <= a) return new String[] {"", ""};
        JSONObject o = new JSONObject(r.substring(a, b + 1));
        return new String[] {o.optString("original", "").trim(), o.optString("translation", "").trim()};
    }
}
