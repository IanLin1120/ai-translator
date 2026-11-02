package com.ian.aitrans;

import android.app.Activity;
import android.graphics.Color;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.util.LinkedList;

/**
 * Claude 訂閱引擎：在背景（幾乎看不見）開著你的 claude.ai 網頁版翻譯器，
 * 翻譯請求排進佇列，由網頁版翻譯器（跑在 claude.ai 內、用你的訂閱額度）取走處理後回傳結果。
 */
final class ClaudeEngine {
    private static WebView wv;
    private static String loadedUrl = "";
    private static String state = "none";            // none | loading | login | ready | noaccess
    private static final LinkedList<String[]> QUEUE = new LinkedList<String[]>();

    private ClaudeEngine() { }

    static synchronized String state() { return state; }

    private static void setState(String s) {
        boolean ch;
        synchronized (ClaudeEngine.class) { ch = !s.equals(state); state = s; }
        if (ch) {
            try { MainActivity.emit("ceng", new JSONObject().put("state", s).toString()); } catch (Throwable t) { /* ignore */ }
        }
    }

    /** 主執行緒呼叫：確保背景網頁已載入。 */
    static void start(final Activity a, final String url) {
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    if (wv != null && url.equals(loadedUrl)) return;
                    destroyNow();
                    FrameLayout root = (FrameLayout) a.findViewById(android.R.id.content);
                    wv = new WebView(a);
                    wv.setBackgroundColor(Color.TRANSPARENT);
                    wv.setAlpha(0.02f);
                    WebSettings s = wv.getSettings();
                    s.setJavaScriptEnabled(true);
                    s.setDomStorageEnabled(true);
                    s.setDatabaseEnabled(true);
                    s.setAllowFileAccess(false);
                    s.setMediaPlaybackRequiresUserGesture(false);
                    s.setUserAgentString(s.getUserAgentString().replace("; wv", "").replace(" Version/4.0", ""));
                    CookieManager cm = CookieManager.getInstance();
                    cm.setAcceptCookie(true);
                    cm.setAcceptThirdPartyCookies(wv, true);
                    wv.addJavascriptInterface(new Iface(), "AITE");
                    wv.setWebViewClient(new WebViewClient() {
                        @Override public void onPageFinished(WebView v, String u) {
                            if (u != null && u.contains("claude.ai") && (u.contains("/login") || u.contains("/logout") || u.contains("/signup"))) setState("login");
                        }
                    });
                    int px = Util.dp(a, 2);
                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(px, px);
                    lp.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.START;
                    root.addView(wv, lp);
                    loadedUrl = url;
                    setState("loading");
                    wv.loadUrl(url);
                } catch (Throwable t) {
                    android.util.Log.e("AIT-ceng", "start", t);
                    setState("none");
                }
            }
        });
    }

    static void stop(Activity a) {
        a.runOnUiThread(new Runnable() { @Override public void run() { destroyNow(); } });
    }

    private static void destroyNow() {
        try {
            if (wv != null) {
                if (wv.getParent() instanceof FrameLayout) ((FrameLayout) wv.getParent()).removeView(wv);
                wv.destroy();
            }
        } catch (Throwable t) { /* ignore */ }
        wv = null;
        loadedUrl = "";
        synchronized (QUEUE) { QUEUE.clear(); }
        setState("none");
    }

    static void request(String id, String json) {
        synchronized (QUEUE) { QUEUE.add(new String[] {id, json}); }
    }

    /** 給網頁版翻譯器（iframe 內）呼叫的介面。 */
    static final class Iface {
        @JavascriptInterface public String poll() {
            synchronized (QUEUE) {
                String[] r = QUEUE.poll();
                if (r == null) return "";
                try { return new JSONObject(r[1]).put("id", r[0]).toString(); } catch (Throwable t) { return ""; }
            }
        }

        @JavascriptInterface public void ready(boolean ok) { setState(ok ? "ready" : "noaccess"); }

        @JavascriptInterface public void res(String id, boolean ok, String text) {
            try {
                MainActivity.emit("ceng", new JSONObject().put("id", id).put("ok", ok).put("text", text == null ? "" : text).toString());
            } catch (Throwable t) { /* ignore */ }
        }
    }
}
