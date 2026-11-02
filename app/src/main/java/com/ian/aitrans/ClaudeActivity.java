package com.ian.aitrans;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Claude 訂閱模式：用內建瀏覽器開啟 claude.ai 上的網頁版翻譯器（翻譯消耗的是你的 Claude 月訂閱額度）。 */
public class ClaudeActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private static final int REQ_FILE = 2001;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#efe5d3"));
        getWindow().setNavigationBarColor(Color.parseColor("#efe5d3"));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#efe5d3"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#e4d6bb"));
        bar.addView(barBtn("✕ 返回", new View.OnClickListener() { @Override public void onClick(View v) { finish(); } }));
        TextView title = new TextView(this);
        title.setText("Claude 訂閱模式");
        title.setTextColor(Color.parseColor("#3a2e22"));
        title.setTextSize(15);
        title.setGravity(Gravity.CENTER);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(barBtn("⟳ 重新整理", new View.OnClickListener() { @Override public void onClick(View v) { if (web != null) web.reload(); } }));
        root.addView(bar, new LinearLayout.LayoutParams(-1, Util.dp(this, 46)));

        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        // 讓網站把它當成一般的手機版 Chrome（拿掉 WebView 標記）
        s.setUserAgentString(s.getUserAgentString().replace("; wv", "").replace(" Version/4.0", ""));
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Dl(), "AITD");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, android.webkit.WebResourceRequest r) {
                String sch = r.getUrl().getScheme();
                if ("http".equals(sch) || "https".equals(sch) || "blob".equals(sch) || "data".equals(sch) || "about".equals(sch)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Throwable t) { /* ignore */ }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try { startActivityForResult(p.createIntent(), REQ_FILE); } catch (Throwable t) { fileCb = null; return false; }
                return true;
            }
        });
        web.setDownloadListener(new DownloadListener() {
            @Override public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                String name = URLUtil.guessFileName(url, cd, mime);
                if (url.startsWith("blob:")) {
                    String js = "(function(){var x=new XMLHttpRequest();x.open('GET'," + org.json.JSONObject.quote(url) + ",true);x.responseType='blob';" +
                        "x.onload=function(){var r=new FileReader();r.onloadend=function(){AITD.save(" + org.json.JSONObject.quote(name) + "," +
                        org.json.JSONObject.quote(mime == null ? "application/octet-stream" : mime) + ",String(r.result).split(',')[1]||'');};r.readAsDataURL(x.response);};x.send();})();";
                    web.evaluateJavascript(js, null);
                } else if (url.startsWith("data:")) {
                    int c = url.indexOf(',');
                    if (c > 0) new Dl().save(name, mime, url.substring(c + 1));
                } else {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Throwable t) { /* ignore */ }
                }
            }
        });
        String url = getIntent().getStringExtra("url");
        web.loadUrl(url == null || url.isEmpty() ? "https://claude.ai/" : url);
    }

    private TextView barBtn(String t, View.OnClickListener l) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextColor(Color.parseColor("#a2613a"));
        v.setTextSize(14);
        v.setGravity(Gravity.CENTER);
        v.setPadding(Util.dp(this, 14), 0, Util.dp(this, 14), 0);
        v.setOnClickListener(l);
        v.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, -1));
        return v;
    }

    /** 網頁匯出檔案（blob）→ 存到「下載/AI全能翻譯」。 */
    class Dl {
        @JavascriptInterface public String save(String name, String mime, String b64) {
            try {
                byte[] d = Base64.decode(b64, Base64.DEFAULT);
                final String p = Util.saveDownload(ClaudeActivity.this, name, mime, d);
                runOnUiThread(new Runnable() { @Override public void run() { Toast.makeText(ClaudeActivity.this, "已存到：" + p, Toast.LENGTH_LONG).show(); } });
                return "ok";
            } catch (final Throwable t) {
                runOnUiThread(new Runnable() { @Override public void run() { Toast.makeText(ClaudeActivity.this, "儲存失敗：" + t.getMessage(), Toast.LENGTH_LONG).show(); } });
                return "err";
            }
        }
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
        }
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else finish();
    }

    @Override protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
