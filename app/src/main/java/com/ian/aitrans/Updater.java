package com.ian.aitrans;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.os.Build;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** App 內下載並安裝新版 APK（PackageInstaller；系統會跳出「要更新這個應用程式嗎？」，直接覆蓋舊版）。 */
final class Updater {
    static final String ACT_STATUS = "com.ian.aitrans.INSTALL_STATUS";
    private static boolean rcvReg = false;

    private Updater() { }

    static void report(String state, double pct, String msg) {
        try {
            JSONObject o = new JSONObject();
            o.put("state", state);
            o.put("pct", pct);
            o.put("msg", msg == null ? "" : msg);
            MainActivity.emit("apk", o.toString());
        } catch (Throwable t) { /* ignore */ }
    }

    static void start(final Context ctx, final String url) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    File f = new File(ctx.getCacheDir(), "update.apk");
                    report("download", 0, null);
                    download(url, f);
                    install(ctx, f);
                } catch (Throwable t) {
                    report("error", 0, t.getMessage() == null ? t.toString() : t.getMessage());
                }
            }
        }).start();
    }

    private static void download(String url, File out) throws Exception {
        String u = url;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                u = new URL(new URL(u), c.getHeaderField("Location")).toString();
                c.disconnect();
                continue;
            }
            if (code != 200) throw new Exception("HTTP " + code);
            long len = c.getContentLengthLong(), got = 0, last = 0;
            InputStream in = c.getInputStream();
            OutputStream os = new FileOutputStream(out);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                got += n;
                long now = System.currentTimeMillis();
                if (now - last > 400) { last = now; report("download", len > 0 ? (double) got / len : -1, null); }
            }
            os.close();
            in.close();
            c.disconnect();
            if (len > 0 && got != len) throw new Exception("下載不完整");
            return;
        }
        throw new Exception("轉址太多次");
    }

    private static void install(Context ctx, File f) throws Exception {
        final Context app = ctx.getApplicationContext();
        if (!rcvReg) {
            BroadcastReceiver r = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) {
                    int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
                    if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        Intent conf = (Intent) i.getParcelableExtra(Intent.EXTRA_INTENT);
                        if (conf != null) {
                            conf.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            try { c.startActivity(conf); } catch (Throwable t) { report("error", 0, t.toString()); }
                        }
                        report("confirm", 1, null);
                    } else if (st == PackageInstaller.STATUS_SUCCESS) {
                        report("done", 1, null);
                    } else {
                        report("error", 0, i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
                    }
                }
            };
            IntentFilter flt = new IntentFilter(ACT_STATUS);
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(r, flt, Context.RECEIVER_EXPORTED);
            else app.registerReceiver(r, flt);
            rcvReg = true;
        }
        PackageInstaller pi = app.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(app.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) sp.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = pi.createSession(sp);
        PackageInstaller.Session s = pi.openSession(id);
        OutputStream os = s.openWrite("app.apk", 0, f.length());
        InputStream in = new FileInputStream(f);
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        s.fsync(os);
        os.close();
        in.close();
        Intent it = new Intent(ACT_STATUS).setPackage(app.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pin = PendingIntent.getBroadcast(app, id, it, flags);
        report("installing", 1, null);
        s.commit(pin.getIntentSender());
        s.close();
    }
}
