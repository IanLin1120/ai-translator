package com.ian.aitrans;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

public class MainActivity extends Activity {
    static MainActivity cur;
    static final int REQ_FILE = 1001, REQ_PROJ = 1002, REQ_NOTIF = 1003;

    WebView web;
    private ValueCallback<Uri[]> fileCb;
    String pendingCfg;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        cur = this;
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#efe5d3"));
        w.setNavigationBarColor(Color.parseColor("#efe5d3"));
        if (Build.VERSION.SDK_INT >= 23) {
            int f = w.getDecorView().getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) f |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            w.getDecorView().setSystemUiVisibility(f);
        }
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#efe5d3"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#efe5d3"));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);   // 本機頁面直接呼叫 Google／Anthropic API 不受 CORS 限制
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(this), "AIT");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, android.webkit.WebResourceRequest r) {
                String u = r.getUrl().toString();
                if (u.startsWith("file:") || u.startsWith("about:") || u.startsWith("blob:") || u.startsWith("data:")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Throwable t) { /* ignore */ }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(p.createIntent(), REQ_FILE);
                } catch (Throwable t) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("AIT-web", m.message() + " @" + m.lineNumber());
                return true;
            }
        });
        web.loadUrl("file:///android_asset/index.html");
    }

    /** 呼叫網頁的 JS（任何執行緒皆可）。 */
    void js(final String code) {
        runOnUiThread(new Runnable() {
            @Override public void run() { if (web != null) web.evaluateJavascript(code, null); }
        });
    }

    /** 對網頁送出原生事件：onNativeEvent(type, jsonString)。 */
    static void emit(String type, String json) {
        MainActivity a = cur;
        if (a == null) return;
        a.js("window.onNativeEvent&&onNativeEvent(" + JSONObject.quote(type) + "," + JSONObject.quote(json) + ")");
    }

    void startProjection(String cfgJson) {
        pendingCfg = cfgJson;
        MediaProjectionManager m = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(m.createScreenCaptureIntent(), REQ_PROJ);
    }

    void askNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
    }

    void hideKeyboard() {
        InputMethodManager im = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (im != null && web != null) im.hideSoftInputFromWindow(web.getWindowToken(), 0);
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE) {
            if (fileCb != null) {
                fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
                fileCb = null;
            }
        } else if (req == REQ_PROJ) {
            if (res == RESULT_OK && data != null && pendingCfg != null) {
                FloatService.start(this, res, data, pendingCfg);
            } else {
                emit("float", "{\"state\":\"denied\"}");
            }
            pendingCfg = null;
        }
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == REQ_NOTIF) emit("perm", "");
    }

    @Override protected void onResume() {
        super.onResume();
        emit("perm", "");
    }

    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("(window.onNativeBack&&onNativeBack())?'1':'0'", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) {
                if (!"\"1\"".equals(v)) moveTaskToBack(true);
            }
        });
    }

    @Override protected void onDestroy() {
        if (cur == this) { cur = null; ClaudeEngine.stop(this); }
        super.onDestroy();
    }
}
