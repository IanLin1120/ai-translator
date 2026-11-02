package com.ian.aitrans;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/** 網頁 ⇄ 原生的橋：window.AIT */
public class Bridge {
    private final MainActivity act;

    Bridge(MainActivity a) { act = a; }

    @JavascriptInterface public String version() {
        try {
            PackageInfo p = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            return p.versionName == null ? "" : p.versionName;
        } catch (Throwable t) { return ""; }
    }

    @JavascriptInterface public void openUrl(final String u) {
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u))); } catch (Throwable t) { /* ignore */ }
            }
        });
    }

    @JavascriptInterface public void hideKeyboard() {
        act.runOnUiThread(new Runnable() { @Override public void run() { act.hideKeyboard(); } });
    }

    /* ---------- App 內更新 ---------- */
    @JavascriptInterface public boolean canInstall() { return act.getPackageManager().canRequestPackageInstalls(); }

    @JavascriptInterface public void askInstall() {
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName())));
                } catch (Throwable t) { /* ignore */ }
            }
        });
    }

    @JavascriptInterface public void installApk(String url) { Updater.start(act, url); }

    /* ---------- 檔案儲存 ---------- */
    @JavascriptInterface public String saveFile(String name, String mime, String b64) {
        try {
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            String path = Util.saveDownload(act, name, mime, data);
            return new JSONObject().put("ok", true).put("path", path).toString();
        } catch (Throwable t) {
            try { return new JSONObject().put("ok", false).put("err", String.valueOf(t.getMessage())).toString(); } catch (Throwable e) { return "{\"ok\":false}"; }
        }
    }

    /* ---------- 權限 ---------- */
    @JavascriptInterface public boolean canOverlay() { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(act); }

    @JavascriptInterface public void askOverlay() {
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    act.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + act.getPackageName())));
                } catch (Throwable t) { /* ignore */ }
            }
        });
    }

    @JavascriptInterface public boolean canNotif() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return act.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface public void askNotif() {
        act.runOnUiThread(new Runnable() { @Override public void run() { act.askNotifPermission(); } });
    }

    /* ---------- 懸浮即時翻譯 ---------- */
    @JavascriptInterface public void startFloat(final String cfgJson) {
        act.runOnUiThread(new Runnable() { @Override public void run() { act.startProjection(cfgJson); } });
    }

    @JavascriptInterface public void stopFloat() { FloatService.stop(act); }

    @JavascriptInterface public boolean floatRunning() { return FloatService.running; }

    /* ---------- Claude 訂閱模式（內建瀏覽器） ---------- */
    @JavascriptInterface public void openClaude(final String url) {
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                Intent i = new Intent(act, ClaudeActivity.class);
                i.putExtra("url", url);
                act.startActivity(i);
            }
        });
    }

    /* ---------- 裝置端文字辨識（圖片／截圖） ---------- */
    @JavascriptInterface public boolean hasOcr() { return true; }

    @JavascriptInterface public void ocr(final String id, final String b64, final String lang) {
        new Thread(new Runnable() {
            @Override public void run() {
                JSONObject o = new JSONObject();
                try {
                    byte[] d = Base64.decode(b64, Base64.DEFAULT);
                    Bitmap bmp = BitmapFactory.decodeByteArray(d, 0, d.length);
                    if (bmp == null) throw new Exception("無法讀取圖片");
                    List<String> lines = Ocr.recognize(bmp, lang);
                    bmp.recycle();
                    JSONArray arr = new JSONArray();
                    for (String s : lines) arr.put(s);
                    o.put("id", id).put("ok", true).put("lines", arr);
                } catch (Throwable t) {
                    try { o.put("id", id).put("ok", false).put("err", t.getMessage() == null ? t.toString() : t.getMessage()); } catch (Throwable e) { /* ignore */ }
                }
                MainActivity.emit("ocr", o.toString());
            }
        }).start();
    }
}
