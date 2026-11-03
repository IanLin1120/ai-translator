package com.ian.aitrans;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 螢幕懸浮即時翻譯：
 *  - MediaProjection 擷取螢幕、使用者框選區域
 *  - 區域畫面一有變化（等畫面穩定後）就用 ML Kit（或 Claude 看圖）辨識，再用 Google／Claude 翻譯
 *  - 譯文顯示在置頂的懸浮小視窗（可拖曳、縮放字體、暫停、顯示原文）
 */
public class FloatService extends Service {
    static volatile boolean running = false;
    static final String CH = "aitrans_float";
    static final int NID = 7711;
    static final String ACT_STOP = "com.ian.aitrans.FLOAT_STOP";

    static void start(Context c, int resultCode, Intent data, String cfg) {
        Intent i = new Intent(c, FloatService.class);
        i.putExtra("rc", resultCode);
        i.putExtra("data", data);
        i.putExtra("cfg", cfg);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) { c.stopService(new Intent(c, FloatService.class)); }

    /* ---- 設定 ---- */
    private JSONObject cfg = new JSONObject();
    private boolean showOrig = true;
    private double thr = 0.015;
    private long gapMs = 2500;
    private static final long SETTLE_MS = 1200, MAXWAIT_MS = 6000, TICK_MS = 700;

    /* ---- 擷取 ---- */
    private WindowManager wm;
    private MediaProjection mp;
    private VirtualDisplay vd;
    private ImageReader reader;
    private int sw, sh, dens;
    private HandlerThread ht;
    private Handler bg, ui;
    private Bitmap lastFrame;
    private volatile Rect region;
    private volatile boolean paused = false, busy = false, forceNow = false;
    private int[] prevSig, doneSig;
    private long lastChangeAt = 0, chgStart = 0, lastTranslateAt = 0;
    private String lastKey = "";
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running) return;
            try { if (!paused && region != null && !busy) step(); } catch (Throwable t) { android.util.Log.e("AIT-float", "step", t); }
            if (bg != null && running) bg.postDelayed(this, TICK_MS);
        }
    };

    /* ---- 介面 ---- */
    private TextView bubble;
    private WindowManager.LayoutParams bubbleLp;
    private LinearLayout panel;
    private WindowManager.LayoutParams panelLp;
    private LinearLayout content;
    private ScrollView scroll;
    private TextView status, btnPause, btnOrig;
    private SelectView selector;
    private float textSp = 15f;
    private int panelHeightMode = 1;                       // 0 小 / 1 中 / 2 大
    private volatile Rect panelRect, bubbleRect;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACT_STOP.equals(intent.getAction())) {
            if (intent != null) { startFg(); }
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;
        startFg();
        try {
            cfg = new JSONObject(intent.getStringExtra("cfg"));
            showOrig = cfg.optBoolean("showOrig", true);
            String sens = cfg.optString("sens", "mid");
            thr = "high".equals(sens) ? 0.006 : "low".equals(sens) ? 0.04 : 0.015;
            gapMs = Math.max(1000, cfg.optLong("gap", 2500));
            int rc = intent.getIntExtra("rc", 0);
            Intent data = (Intent) intent.getParcelableExtra("data");
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            mp = mpm.getMediaProjection(rc, data);
            if (mp == null) throw new Exception("無法取得螢幕錄製權限");
            ui = new Handler(Looper.getMainLooper());
            ht = new HandlerThread("aitrans-float");
            ht.start();
            bg = new Handler(ht.getLooper());
            mp.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { ui.post(new Runnable() { @Override public void run() { stopSelf(); } }); }
            }, ui);
            wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            setupCapture();
            buildBubble();
            buildPanel();
            running = true;
            MainActivity.emit("float", "{\"state\":\"started\"}");
            bg.postDelayed(tick, TICK_MS);
            // 回到桌面／其他 App，讓使用者去選要翻譯的畫面
            if (MainActivity.cur != null) MainActivity.cur.moveTaskToBack(true);
            showToastText("點懸浮的「譯」圓球開始框選");
        } catch (Throwable t) {
            android.util.Log.e("AIT-float", "start", t);
            try { MainActivity.emit("float", new JSONObject().put("state", "error").put("msg", String.valueOf(t.getMessage())).toString()); } catch (Throwable e) { /* ignore */ }
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void startFg() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            NotificationChannel c = new NotificationChannel(CH, "懸浮即時翻譯", NotificationManager.IMPORTANCE_LOW);
            nm.createNotificationChannel(c);
        }
        Intent stopI = new Intent(this, FloatService.class).setAction(ACT_STOP);
        PendingIntent sp = PendingIntent.getService(this, 1, stopI, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent openI = new Intent(this, MainActivity.class);
        PendingIntent op = PendingIntent.getActivity(this, 2, openI, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setContentTitle("AI 全能翻譯：懸浮翻譯執行中").setContentText("點「停止」結束；點通知回到 App")
            .setSmallIcon(R.mipmap.ic_launcher).setContentIntent(op).setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "停止", sp).build());
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        else startForeground(NID, n);
    }

    /* ================= 螢幕擷取 ================= */
    private void setupCapture() {
        DisplayMetrics dm = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        sw = dm.widthPixels; sh = dm.heightPixels; dens = dm.densityDpi;
        reader = ImageReader.newInstance(sw, sh, PixelFormat.RGBA_8888, 2);
        vd = mp.createVirtualDisplay("aitrans", sw, sh, dens, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, bg);
    }

    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (!running || bg == null) return;
        bg.post(new Runnable() {
            @Override public void run() {
                try {
                    DisplayMetrics dm = new DisplayMetrics();
                    wm.getDefaultDisplay().getRealMetrics(dm);
                    if (dm.widthPixels == sw && dm.heightPixels == sh) return;
                    if (vd != null) vd.release();
                    if (reader != null) reader.close();
                    if (lastFrame != null) { lastFrame.recycle(); lastFrame = null; }
                    setupCapture();
                    region = null; prevSig = null; doneSig = null;
                    ui.post(new Runnable() { @Override public void run() { setStatus("畫面轉向了，請重新框選"); layoutPanel(); placeBubbleInside(); } });
                } catch (Throwable t) { android.util.Log.e("AIT-float", "rotate", t); }
            }
        });
    }

    /** 取得最新畫面（螢幕沒變化時沿用上一張）。僅在背景執行緒呼叫。 */
    private Bitmap grab() {
        Image img = null;
        try { img = reader.acquireLatestImage(); } catch (Throwable t) { /* ignore */ }
        if (img != null) {
            try {
                Image.Plane p = img.getPlanes()[0];
                ByteBuffer buf = p.getBuffer();
                int ps = p.getPixelStride(), rs = p.getRowStride();
                int w = rs / ps;
                Bitmap bm = Bitmap.createBitmap(w, sh, Bitmap.Config.ARGB_8888);
                bm.copyPixelsFromBuffer(buf);
                Bitmap full = bm;
                if (w != sw) { full = Bitmap.createBitmap(bm, 0, 0, sw, sh); bm.recycle(); }
                if (lastFrame != null) lastFrame.recycle();
                lastFrame = full;
            } finally { img.close(); }
        }
        return lastFrame;
    }

    /** 裁出所選區域；自己的懸浮視窗所在的部分塗成灰色，避免把自己的譯文又翻一次。 */
    private Bitmap cropRegion() {
        Rect rg = region;
        Bitmap frame = grab();
        if (frame == null || rg == null) return null;
        Rect r = new Rect(rg);
        if (!r.intersect(0, 0, sw, sh) || r.width() < 8 || r.height() < 8) return null;
        Bitmap c = Bitmap.createBitmap(r.width(), r.height(), Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(c);
        cv.drawBitmap(frame, r, new Rect(0, 0, r.width(), r.height()), null);
        Paint gray = new Paint();
        gray.setColor(0xFF808080);
        Rect[] mine = {panelRect, bubbleRect};
        for (Rect m : mine) {
            if (m == null) continue;
            Rect x = new Rect(m);
            if (x.intersect(r)) cv.drawRect(x.left - r.left, x.top - r.top, x.right - r.left, x.bottom - r.top, gray);
        }
        return c;
    }

    private static int[] signature(Bitmap c) {
        Bitmap s = Bitmap.createScaledBitmap(c, 96, 54, true);
        int[] px = new int[96 * 54];
        s.getPixels(px, 0, 96, 0, 0, 96, 54);
        if (s != c) s.recycle();
        int[] g = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            g[i] = (((p >> 16) & 255) * 30 + ((p >> 8) & 255) * 59 + (p & 255) * 11) / 100;
        }
        return g;
    }

    private static double diff(int[] a, int[] b) {
        if (a == null || b == null) return 1;
        int n = 0;
        for (int i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 16) n++;
        return (double) n / a.length;
    }

    private void step() {
        Bitmap c = cropRegion();
        if (c == null) return;
        long now = SystemClock.uptimeMillis();
        int[] sig = signature(c);
        if (forceNow) {
            forceNow = false;
            prevSig = sig;
            runTranslate(c, sig, now);
            return;
        }
        boolean moving = prevSig != null && diff(prevSig, sig) > thr;
        prevSig = sig;
        if (moving) { if (chgStart == 0) chgStart = now; lastChangeAt = now; }
        boolean needs = doneSig == null || diff(doneSig, sig) > thr;
        boolean settled = (now - lastChangeAt >= SETTLE_MS) || (chgStart > 0 && now - chgStart >= MAXWAIT_MS);
        if (needs && settled && now - lastTranslateAt >= gapMs) runTranslate(c, sig, now);
        else c.recycle();
    }

    private void runTranslate(final Bitmap c, final int[] sig, long now) {
        busy = true;
        lastTranslateAt = now;
        chgStart = 0;
        ui.post(new Runnable() { @Override public void run() { setStatus("辨識中…"); } });
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    List<String[]> pairs = new ArrayList<String[]>();
                    String ocrMode = cfg.optString("ocr", "mlkit");
                    if (!"mlkit".equals(ocrMode)) {
                        pairs = Translator.vision(cfg, c, ocrMode);
                    } else {
                        List<String> blocks = Ocr.recognize(c, cfg.optString("src", "auto"));
                        String key = String.valueOf(blocks.hashCode());
                        if (blocks.isEmpty()) {
                            lastKey = "";
                        } else if (key.equals(lastKey)) {
                            doneSig = sig;
                            busy = false;
                            ui.post(new Runnable() { @Override public void run() { setStatus("✓ " + new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date())); } });
                            return;
                        } else {
                            ui.post(new Runnable() { @Override public void run() { setStatus("翻譯中…"); } });
                            List<String> tr = Translator.translate(cfg, blocks);
                            for (int i = 0; i < blocks.size(); i++) pairs.add(new String[] {blocks.get(i), i < tr.size() ? tr.get(i) : ""});
                            lastKey = key;
                        }
                    }
                    doneSig = sig;
                    final List<String[]> res = pairs;
                    ui.post(new Runnable() {
                        @Override public void run() {
                            render(res);
                            setStatus("✓ " + new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date()));
                        }
                    });
                } catch (final Throwable t) {
                    android.util.Log.e("AIT-float", "translate", t);
                    doneSig = sig;                          // 失敗也不要每 2.5 秒狂重試同一個畫面
                    ui.post(new Runnable() { @Override public void run() { setStatus("⚠ " + shortMsg(t)); } });
                } finally {
                    if (!c.isRecycled()) c.recycle();
                    busy = false;
                }
            }
        }).start();
    }

    private static String shortMsg(Throwable t) {
        String m = t.getMessage() == null ? t.toString() : t.getMessage();
        return m.length() > 90 ? m.substring(0, 90) + "…" : m;
    }

    /* ================= 懸浮介面 ================= */
    private int dp(float v) { return Util.dp(this, v); }

    private void setStatus(String s) { if (status != null) status.setText(s); }

    private void showToastText(String s) { android.widget.Toast.makeText(this, s, android.widget.Toast.LENGTH_LONG).show(); }

    private WindowManager.LayoutParams overlayLp(int w, int h) {
        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(w, h, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        return lp;
    }

    private void buildBubble() {
        bubble = new TextView(this);
        bubble.setText("譯");
        bubble.setTextColor(Color.WHITE);
        bubble.setTextSize(20);
        bubble.setTypeface(Typeface.DEFAULT_BOLD);
        bubble.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(0xF2A2613A);
        g.setStroke(dp(2), 0xAAFFFFFF);
        bubble.setBackground(g);
        bubble.setElevation(dp(6));
        bubbleLp = overlayLp(dp(54), dp(54));
        bubbleLp.x = sw - dp(54) - dp(8);
        bubbleLp.y = (int) (sh * 0.35f);
        wm.addView(bubble, bubbleLp);
        bubble.setOnTouchListener(new DragTouch(bubbleLp, bubble, true) {
            @Override void onTap() {
                if (region == null) startSelect();
                else togglePanel();
            }
        });
        updateRects();
    }

    private TextView tool(String t, View.OnClickListener l) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextColor(0xFFF3E7D0);
        v.setTextSize(13);
        v.setGravity(Gravity.CENTER);
        v.setPadding(dp(8), dp(5), dp(8), dp(5));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(10));
        g.setColor(0x33FFFFFF);
        v.setBackground(g);
        v.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.setMargins(dp(2), 0, dp(2), 0);
        v.setLayoutParams(lp);
        return v;
    }

    private void buildPanel() {
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bgd = new GradientDrawable();
        bgd.setCornerRadius(dp(18));
        bgd.setColor(0xEE1D1812);
        bgd.setStroke(dp(1), 0x55FFFFFF);
        panel.setBackground(bgd);
        panel.setElevation(dp(8));
        panel.setPadding(dp(8), dp(6), dp(8), dp(8));

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        status = new TextView(this);
        status.setTextColor(0xFFCDBB97);
        status.setTextSize(12);
        status.setSingleLine(true);
        status.setText("請先框選要翻譯的區域");
        head.addView(status, new LinearLayout.LayoutParams(0, -2, 1f));
        head.addView(tool("✕", new View.OnClickListener() { @Override public void onClick(View v) { hidePanel(); } }));
        panel.addView(head);

        LinearLayout tools = new LinearLayout(this);
        tools.setOrientation(LinearLayout.HORIZONTAL);
        tools.setGravity(Gravity.CENTER_VERTICAL);
        tools.setPadding(0, dp(5), 0, dp(5));
        btnPause = tool("⏸", new View.OnClickListener() { @Override public void onClick(View v) { paused = !paused; btnPause.setText(paused ? "▶" : "⏸"); setStatus(paused ? "已暫停" : "繼續偵測"); } });
        tools.addView(btnPause);
        tools.addView(tool("⟳", new View.OnClickListener() { @Override public void onClick(View v) { if (region == null) startSelect(); else { forceNow = true; lastKey = ""; } } }));
        tools.addView(tool("▭ 框選", new View.OnClickListener() { @Override public void onClick(View v) { startSelect(); } }));
        btnOrig = tool(showOrig ? "原文✓" : "原文", new View.OnClickListener() {
            @Override public void onClick(View v) { showOrig = !showOrig; btnOrig.setText(showOrig ? "原文✓" : "原文"); lastRender(); }
        });
        tools.addView(btnOrig);
        tools.addView(tool("A−", new View.OnClickListener() { @Override public void onClick(View v) { textSp = Math.max(10f, textSp - 1.5f); lastRender(); } }));
        tools.addView(tool("A+", new View.OnClickListener() { @Override public void onClick(View v) { textSp = Math.min(30f, textSp + 1.5f); lastRender(); } }));
        tools.addView(tool("⇕", new View.OnClickListener() { @Override public void onClick(View v) { panelHeightMode = (panelHeightMode + 1) % 3; layoutPanel(); } }));
        tools.addView(tool("■", new View.OnClickListener() { @Override public void onClick(View v) { stopSelf(); } }));
        panel.addView(tools);

        scroll = new ScrollView(this);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content);
        panel.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        int w = Math.min(sw - dp(16), dp(430));
        panelLp = overlayLp(w, panelHeight());
        panelLp.x = (sw - w) / 2;
        panelLp.y = (int) (sh * 0.55f);
        wm.addView(panel, panelLp);
        panel.setVisibility(View.GONE);
        // 標題列（狀態文字）可拖曳移動整個視窗
        head.setOnTouchListener(new DragTouch(panelLp, panel, false) { @Override void onTap() { } });
        tools.setOnTouchListener(new DragTouch(panelLp, panel, false) { @Override void onTap() { } });
        updateRects();
    }

    private int panelHeight() {
        float f = panelHeightMode == 0 ? 0.22f : panelHeightMode == 2 ? 0.5f : 0.34f;
        return (int) (sh * f);
    }

    private void layoutPanel() {
        if (panel == null) return;
        int w = Math.min(sw - dp(16), dp(430));
        panelLp.width = w;
        panelLp.height = panelHeight();
        panelLp.x = Math.max(0, Math.min(panelLp.x, sw - w));
        panelLp.y = Math.max(0, Math.min(panelLp.y, sh - panelLp.height));
        try { wm.updateViewLayout(panel, panelLp); } catch (Throwable t) { /* ignore */ }
        updateRects();
    }

    private void placeBubbleInside() {
        if (bubbleLp == null) return;
        bubbleLp.x = Math.max(0, Math.min(bubbleLp.x, sw - dp(54)));
        bubbleLp.y = Math.max(0, Math.min(bubbleLp.y, sh - dp(54)));
        try { wm.updateViewLayout(bubble, bubbleLp); } catch (Throwable t) { /* ignore */ }
        updateRects();
    }

    private void togglePanel() {
        if (panel.getVisibility() == View.VISIBLE) hidePanel(); else showPanel();
    }

    private void showPanel() { panel.setVisibility(View.VISIBLE); layoutPanel(); }

    private void hidePanel() { panel.setVisibility(View.GONE); updateRects(); }

    /** 記錄自己的懸浮視窗位置，擷取時要塗掉。 */
    private void updateRects() {
        if (bubbleLp != null && bubble != null) bubbleRect = new Rect(bubbleLp.x, bubbleLp.y, bubbleLp.x + bubbleLp.width, bubbleLp.y + bubbleLp.height);
        if (panelLp != null && panel != null) {
            panelRect = panel.getVisibility() == View.VISIBLE ? new Rect(panelLp.x, panelLp.y, panelLp.x + panelLp.width, panelLp.y + panelLp.height) : null;
        }
    }

    private List<String[]> lastPairs = new ArrayList<String[]>();

    private void lastRender() { render(lastPairs); }

    private void render(List<String[]> pairs) {
        lastPairs = pairs;
        if (content == null) return;
        content.removeAllViews();
        if (pairs.isEmpty()) {
            TextView e = new TextView(this);
            e.setText("（這個區域沒有偵測到文字）");
            e.setTextColor(0xFFA8977E);
            e.setTextSize(13);
            e.setPadding(dp(4), dp(8), dp(4), dp(8));
            content.addView(e);
            return;
        }
        for (String[] p : pairs) {
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setPadding(dp(4), dp(6), dp(4), dp(6));
            if (showOrig && p[0] != null && !p[0].isEmpty()) {
                TextView o = new TextView(this);
                o.setText(p[0]);
                o.setTextColor(0xFFA8977E);
                o.setTextSize(Math.max(10f, textSp - 3f));
                box.addView(o);
            }
            TextView t = new TextView(this);
            t.setText(p[1]);
            t.setTextColor(0xFFF3E7D0);
            t.setTextSize(textSp);
            t.setTypeface(Typeface.DEFAULT_BOLD);
            box.addView(t);
            content.addView(box);
            View line = new View(this);
            line.setBackgroundColor(0x22FFFFFF);
            content.addView(line, new LinearLayout.LayoutParams(-1, 1));
        }
        scroll.scrollTo(0, 0);
    }

    /* ---- 拖曳（也能處理點一下） ---- */
    private abstract class DragTouch implements View.OnTouchListener {
        private final WindowManager.LayoutParams lp;
        private final View target;
        private final boolean snap;
        private float dx, dy, sx, sy;
        private boolean moved;

        DragTouch(WindowManager.LayoutParams lp, View target, boolean snap) { this.lp = lp; this.target = target; this.snap = snap; }

        abstract void onTap();

        @Override public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    sx = e.getRawX(); sy = e.getRawY(); dx = lp.x - sx; dy = lp.y - sy; moved = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (Math.abs(e.getRawX() - sx) > dp(6) || Math.abs(e.getRawY() - sy) > dp(6)) moved = true;
                    if (moved) {
                        lp.x = (int) (e.getRawX() + dx);
                        lp.y = (int) (e.getRawY() + dy);
                        lp.x = Math.max(0, Math.min(lp.x, sw - lp.width));
                        lp.y = Math.max(0, Math.min(lp.y, sh - lp.height));
                        try { wm.updateViewLayout(target, lp); } catch (Throwable t) { /* ignore */ }
                        updateRects();
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!moved) onTap();
                    else if (snap) {
                        lp.x = lp.x + lp.width / 2 < sw / 2 ? dp(4) : sw - lp.width - dp(4);
                        try { wm.updateViewLayout(target, lp); } catch (Throwable t) { /* ignore */ }
                        updateRects();
                    }
                    return true;
                default:
                    return true;
            }
        }
    }

    /* ---- 框選 ---- */
    private void startSelect() {
        if (selector != null) return;
        final boolean panelWas = panel.getVisibility() == View.VISIBLE;
        bubble.setVisibility(View.GONE);
        panel.setVisibility(View.GONE);
        updateRects();
        selector = new SelectView(this, new SelectView.Done() {
            @Override public void onDone(Rect r) {
                removeSelector();
                bubble.setVisibility(View.VISIBLE);
                if (r != null) {
                    region = r;
                    prevSig = null; doneSig = null; lastKey = "";
                    forceNow = true;
                    render(new ArrayList<String[]>());
                    setStatus("辨識中…");
                    showPanel();
                } else if (panelWas) showPanel();
                updateRects();
            }
        });
        WindowManager.LayoutParams lp = overlayLp(sw, sh);
        lp.x = 0; lp.y = 0;
        lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        wm.addView(selector, lp);
    }

    private void removeSelector() {
        if (selector != null) {
            try { wm.removeView(selector); } catch (Throwable t) { /* ignore */ }
            selector = null;
        }
    }

    /** 全螢幕暗幕＋拖曳框選。 */
    static class SelectView extends View {
        interface Done { void onDone(Rect r); }
        private final Done done;
        private final Paint dim = new Paint(), line = new Paint(), txt = new Paint();
        private float x0, y0, x1, y1;
        private boolean has;

        SelectView(Context c, Done d) {
            super(c);
            done = d;
            dim.setColor(0x88000000);
            line.setColor(0xFFE0A066);
            line.setStyle(Paint.Style.STROKE);
            line.setStrokeWidth(Util.dp(c, 2));
            txt.setColor(Color.WHITE);
            txt.setTextSize(Util.dp(c, 16));
            txt.setTextAlign(Paint.Align.CENTER);
            txt.setShadowLayer(6, 0, 0, Color.BLACK);
        }

        @Override protected void onDraw(Canvas cv) {
            int w = getWidth(), h = getHeight();
            if (!has) {
                cv.drawRect(0, 0, w, h, dim);
                cv.drawText("拖曳框選要翻譯的區域（點一下取消）", w / 2f, h * 0.2f, txt);
                return;
            }
            float l = Math.min(x0, x1), t = Math.min(y0, y1), r = Math.max(x0, x1), b = Math.max(y0, y1);
            cv.drawRect(0, 0, w, t, dim);
            cv.drawRect(0, b, w, h, dim);
            cv.drawRect(0, t, l, b, dim);
            cv.drawRect(r, t, w, b, dim);
            cv.drawRect(l, t, r, b, line);
        }

        @Override public boolean onTouchEvent(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    x0 = x1 = e.getRawX(); y0 = y1 = e.getRawY(); has = true; invalidate(); return true;
                case MotionEvent.ACTION_MOVE:
                    x1 = e.getRawX(); y1 = e.getRawY(); invalidate(); return true;
                case MotionEvent.ACTION_UP:
                    x1 = e.getRawX(); y1 = e.getRawY();
                    Rect r = new Rect((int) Math.min(x0, x1), (int) Math.min(y0, y1), (int) Math.max(x0, x1), (int) Math.max(y0, y1));
                    int min = Util.dp(getContext(), 28);
                    done.onDone(r.width() >= min && r.height() >= min ? r : null);
                    return true;
                default:
                    return true;
            }
        }
    }

    /* ================= 結束 ================= */
    @Override public void onDestroy() {
        running = false;
        try { if (bg != null) bg.removeCallbacksAndMessages(null); } catch (Throwable t) { /* ignore */ }
        removeSelector();
        try { if (bubble != null) wm.removeView(bubble); } catch (Throwable t) { /* ignore */ }
        try { if (panel != null) wm.removeView(panel); } catch (Throwable t) { /* ignore */ }
        try { if (vd != null) vd.release(); } catch (Throwable t) { /* ignore */ }
        try { if (reader != null) reader.close(); } catch (Throwable t) { /* ignore */ }
        try { if (mp != null) mp.stop(); } catch (Throwable t) { /* ignore */ }
        try { if (ht != null) ht.quitSafely(); } catch (Throwable t) { /* ignore */ }
        if (lastFrame != null) { lastFrame.recycle(); lastFrame = null; }
        MainActivity.emit("float", "{\"state\":\"stopped\"}");
        super.onDestroy();
    }
}
