package com.ian.aitrans;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.util.ArrayList;
import java.util.List;

/**
 * 即時字幕：擷取手機播放的聲音（影片／音檔）或麥克風（通話開擴音／現場），
 * 用離線語音辨識（Vosk）轉成文字，再翻譯，顯示成置頂的懸浮字幕。
 */
public class CaptionService extends Service {
    static volatile boolean running = false;
    private static volatile CaptionService inst;
    static final String CH = "aitrans_caption";
    static final int NID = 7712;
    static final String ACT_STOP = "com.ian.aitrans.CAPTION_STOP";
    private static final int RATE = 16000;

    static void start(Context c, int rc, Intent data, String cfg) {
        Intent i = new Intent(c, CaptionService.class);
        i.putExtra("rc", rc);
        if (data != null) i.putExtra("data", data);
        i.putExtra("cfg", cfg);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) { c.stopService(new Intent(c, CaptionService.class)); }

    /** 執行中即時套用字幕樣式。 */
    static void applyStyle(final String json) {
        final CaptionService s = inst;
        if (s == null || s.ui == null) return;
        s.ui.post(new Runnable() {
            @Override public void run() {
                try { s.style = new JSONObject(json); s.restyle(); } catch (Throwable t) { /* ignore */ }
            }
        });
    }

    private JSONObject cfg = new JSONObject();
    private JSONObject style = new JSONObject();
    private MediaProjection mp;
    private AudioRecord rec;
    private Model model;
    private volatile boolean alive = false, paused = false;
    private Thread audioT, transT;
    private Handler ui;
    private WindowManager wm;
    private int sw, sh;

    /* 字幕狀態（只在主執行緒更改） */
    private static final class Line { String orig = ""; String tr = ""; boolean fin = false; long at = 0; }
    private final ArrayList<Line> lines = new ArrayList<Line>();
    private Line live = null;
    private long lastActive = 0;
    private final Object tq = new Object();
    private String pendText = null;            // 待翻譯的最新一句
    private Line pendLine = null;
    private boolean cjk = false;

    /* 介面 */
    private LinearLayout box, ctl;
    private TextView tvOrig, tvTr, tvHint;
    private WindowManager.LayoutParams lp;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACT_STOP.equals(intent.getAction())) { if (intent != null) fg(false); stopSelf(); return START_NOT_STICKY; }
        if (running) return START_NOT_STICKY;
        try {
            cfg = new JSONObject(intent.getStringExtra("cfg"));
            style = cfg.optJSONObject("style") == null ? new JSONObject() : cfg.optJSONObject("style");
            boolean media = !"mic".equals(cfg.optString("source", "media"));
            fg(media);
            ui = new Handler(Looper.getMainLooper());
            wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            DisplayMetrics dm = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(dm);
            sw = dm.widthPixels; sh = dm.heightPixels;
            String code = cfg.optString("code", "en");
            cjk = "cn".equals(code) || "ja".equals(code);
            if (!Models.ready(this, code)) throw new Exception("還沒有下載這個語言的語音模型");
            if (media) {
                if (Build.VERSION.SDK_INT < 29) throw new Exception("擷取手機播放的聲音需要 Android 10 以上，可改用麥克風");
                MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                Intent data = (Intent) intent.getParcelableExtra("data");
                mp = mpm.getMediaProjection(intent.getIntExtra("rc", 0), data);
                if (mp == null) throw new Exception("無法取得錄製權限");
                mp.registerCallback(new MediaProjection.Callback() {
                    @Override public void onStop() { ui.post(new Runnable() { @Override public void run() { stopSelf(); } }); }
                }, ui);
            }
            buildOverlay();
            alive = true;
            running = true;
            inst = this;
            audioT = new Thread(new Runnable() { @Override public void run() { audioLoop(); } }, "cap-audio");
            audioT.start();
            transT = new Thread(new Runnable() { @Override public void run() { transLoop(); } }, "cap-trans");
            transT.start();
            ui.postDelayed(idleCheck, 1000);
            MainActivity.emit("cap", "{\"state\":\"started\"}");
            if (MainActivity.cur != null) MainActivity.cur.moveTaskToBack(true);
        } catch (Throwable t) {
            android.util.Log.e("AIT-cap", "start", t);
            try { MainActivity.emit("cap", new JSONObject().put("state", "error").put("msg", String.valueOf(t.getMessage())).toString()); } catch (Throwable e) { /* ignore */ }
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void fg(boolean media) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            nm.createNotificationChannel(new NotificationChannel(CH, "即時字幕", NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent sp = PendingIntent.getService(this, 3, new Intent(this, CaptionService.class).setAction(ACT_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent op = PendingIntent.getActivity(this, 4, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setContentTitle("AI 全能翻譯：即時字幕執行中").setContentText("點「停止」結束")
            .setSmallIcon(R.mipmap.ic_launcher).setContentIntent(op).setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "停止", sp).build());
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 30) {
            int type = media ? (ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) : ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            startForeground(NID, n, type);
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NID, n, media ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0);
        } else startForeground(NID, n);
    }

    /* ================= 聲音 → 文字 ================= */
    private void audioLoop() {
        Recognizer rg = null;
        try {
            LibVosk.setLogLevel(LogLevel.WARNINGS);
            model = new Model(Models.dir(this, cfg.optString("code", "en")).getAbsolutePath());
            rg = new Recognizer(model, RATE);
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufSize = Math.max(min, RATE * 2);
            AudioFormat fmt = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
            if (!"mic".equals(cfg.optString("source", "media"))) {
                AudioPlaybackCaptureConfiguration c = new AudioPlaybackCaptureConfiguration.Builder(mp)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME).addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build();
                rec = new AudioRecord.Builder().setAudioFormat(fmt).setBufferSizeInBytes(bufSize).setAudioPlaybackCaptureConfig(c).build();
            } else {
                rec = new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION).setAudioFormat(fmt).setBufferSizeInBytes(bufSize).build();
            }
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new Exception("無法開始錄音（可能沒有錄音權限）");
            rec.startRecording();
            ui.post(new Runnable() { @Override public void run() { setHint("正在聆聽…（開始播放聲音就會出現字幕）"); } });
            byte[] buf = new byte[4096];
            long silentSince = System.currentTimeMillis();
            boolean gotAny = false;
            while (alive) {
                int n = rec.read(buf, 0, buf.length);
                if (n <= 0) { try { Thread.sleep(20); } catch (InterruptedException e) { break; } continue; }
                if (paused) continue;
                if (!gotAny) {                                                    // 受保護的 App 會回傳全 0 的聲音
                    boolean nz = false;
                    for (int i = 0; i < n; i++) if (buf[i] != 0) { nz = true; break; }
                    if (nz) gotAny = true;
                    else if (System.currentTimeMillis() - silentSince > 15000) {
                        silentSince = Long.MAX_VALUE;
                        ui.post(new Runnable() { @Override public void run() { setHint("15 秒都沒有收到聲音：這個 App 可能禁止擷取聲音（例如通話、部分串流），請改用「麥克風」並開擴音"); } });
                    }
                }
                if (rg.acceptWaveForm(buf, n)) onText(new JSONObject(rg.getResult()).optString("text", ""), true);
                else onText(new JSONObject(rg.getPartialResult()).optString("partial", ""), false);
            }
        } catch (final Throwable t) {
            android.util.Log.e("AIT-cap", "audio", t);
            ui.post(new Runnable() {
                @Override public void run() {
                    try { MainActivity.emit("cap", new JSONObject().put("state", "error").put("msg", String.valueOf(t.getMessage())).toString()); } catch (Throwable e) { /* ignore */ }
                    stopSelf();
                }
            });
        } finally {
            try { if (rec != null) { rec.stop(); rec.release(); } } catch (Throwable t) { /* ignore */ }
            try { if (rg != null) rg.close(); } catch (Throwable t) { /* ignore */ }
            try { if (model != null) model.close(); } catch (Throwable t) { /* ignore */ }
        }
    }

    private String clean(String s) {
        s = s == null ? "" : s.trim();
        if (cjk) s = s.replaceAll("(?<=[\\u3000-\\u9fff\\uff00-\\uffef]) +(?=[\\u3000-\\u9fff\\uff00-\\uffef])", "");
        return s;
    }

    private void onText(final String raw, final boolean fin) {
        final String text = clean(raw);
        if (text.isEmpty()) return;
        ui.post(new Runnable() {
            @Override public void run() {
                lastActive = System.currentTimeMillis();
                if (live == null) { live = new Line(); lines.add(live); while (lines.size() > 4) lines.remove(0); }
                boolean changed = !text.equals(live.orig);
                live.orig = text;
                live.at = lastActive;
                if (fin) { live.fin = true; Line l = live; live = null; queue(l, true); }
                else if (changed) queue(live, false);
                render();
            }
        });
    }

    /* ================= 翻譯 ================= */
    private void queue(Line l, boolean fin) {
        synchronized (tq) { pendLine = l; pendText = l.orig; tq.notifyAll(); }
    }

    private void transLoop() {
        long lastCall = 0;
        while (alive) {
            final Line l; final String t;
            synchronized (tq) {
                while (alive && pendText == null) { try { tq.wait(500); } catch (InterruptedException e) { return; } }
                if (!alive) return;
                l = pendLine; t = pendText; pendText = null; pendLine = null;
            }
            long wait = 700 - (System.currentTimeMillis() - lastCall);       // 句子還在變動時，最多每 0.7 秒翻一次
            if (wait > 0 && !l.fin) { try { Thread.sleep(wait); } catch (InterruptedException e) { return; } }
            lastCall = System.currentTimeMillis();
            try {
                JSONObject c = new JSONObject(cfg.toString());
                List<String> in = new ArrayList<String>();
                in.add(t);
                final List<String> out = Translator.translate(c, in);
                if (!out.isEmpty()) ui.post(new Runnable() { @Override public void run() { l.tr = out.get(0); render(); } });
            } catch (final Throwable e) {
                ui.post(new Runnable() { @Override public void run() { setHint("⚠ 翻譯失敗：" + shortMsg(e)); } });
            }
        }
    }

    private static String shortMsg(Throwable t) {
        String m = t.getMessage() == null ? t.toString() : t.getMessage();
        return m.length() > 80 ? m.substring(0, 80) + "…" : m;
    }

    /* ================= 字幕視窗 ================= */
    private int dp(float v) { return Util.dp(this, v); }

    private final Runnable idleCheck = new Runnable() {
        @Override public void run() {
            if (!alive) return;
            if (!lines.isEmpty() && System.currentTimeMillis() - lastActive > 7000) { lines.clear(); live = null; render(); }
            ui.postDelayed(this, 1000);
        }
    };

    private void setHint(String s) {
        if (tvHint == null) return;
        tvHint.setText(s);
        tvHint.setVisibility(s == null || s.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private static int col(JSONObject o, String k, int def) {
        try { return Color.parseColor(o.optString(k, "")); } catch (Throwable t) { return def; }
    }

    private Typeface face() {
        String f = style.optString("font", "sans");
        boolean b = style.optBoolean("bold", true);
        int st = b ? Typeface.BOLD : Typeface.NORMAL;
        if ("serif".equals(f)) return Typeface.create(Typeface.SERIF, st);
        if ("mono".equals(f)) return Typeface.create(Typeface.MONOSPACE, st);
        if ("casual".equals(f)) return Typeface.create("casual", st);
        if ("cursive".equals(f)) return Typeface.create("cursive", st);
        return Typeface.create(Typeface.SANS_SERIF, st);
    }

    private void buildOverlay() {
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(14), dp(8), dp(14), dp(8));
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        tvHint = new TextView(this);
        tvHint.setTextColor(0xFFFFD27F);
        tvHint.setTextSize(13);
        tvHint.setGravity(Gravity.CENTER);
        tvHint.setText("正在準備語音辨識…");
        box.addView(tvHint, new LinearLayout.LayoutParams(-1, -2));
        tvOrig = new TextView(this);
        tvOrig.setGravity(Gravity.CENTER);
        box.addView(tvOrig, new LinearLayout.LayoutParams(-1, -2));
        tvTr = new TextView(this);
        tvTr.setGravity(Gravity.CENTER);
        box.addView(tvTr, new LinearLayout.LayoutParams(-1, -2));

        ctl = new LinearLayout(this);
        ctl.setOrientation(LinearLayout.HORIZONTAL);
        ctl.setGravity(Gravity.CENTER);
        ctl.setVisibility(View.GONE);
        ctl.addView(tool("A−", new View.OnClickListener() { @Override public void onClick(View v) { bump("size", -2); } }));
        ctl.addView(tool("A+", new View.OnClickListener() { @Override public void onClick(View v) { bump("size", 2); } }));
        ctl.addView(tool("原文", new View.OnClickListener() { @Override public void onClick(View v) { try { style.put("showOrig", !style.optBoolean("showOrig", true)); } catch (Throwable t) { /* ignore */ } restyle(); } }));
        ctl.addView(tool("⏸", new View.OnClickListener() { @Override public void onClick(View v) { paused = !paused; ((TextView) v).setText(paused ? "▶" : "⏸"); setHint(paused ? "已暫停" : ""); } }));
        ctl.addView(tool("■", new View.OnClickListener() { @Override public void onClick(View v) { stopSelf(); } }));
        box.addView(ctl, new LinearLayout.LayoutParams(-2, -2));

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(Math.min(sw - dp(12), dp(720)), WindowManager.LayoutParams.WRAP_CONTENT, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = (sw - lp.width) / 2;
        lp.y = (int) (sh * (style.optDouble("posY", 0.72)));
        wm.addView(box, lp);
        box.setOnTouchListener(new View.OnTouchListener() {
            float dx, dy, sx, sy; boolean moved;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN: sx = e.getRawX(); sy = e.getRawY(); dx = lp.x - sx; dy = lp.y - sy; moved = false; return true;
                    case MotionEvent.ACTION_MOVE:
                        if (Math.abs(e.getRawX() - sx) > dp(6) || Math.abs(e.getRawY() - sy) > dp(6)) moved = true;
                        if (moved) {
                            lp.x = Math.max(0, Math.min((int) (e.getRawX() + dx), sw - lp.width));
                            lp.y = Math.max(0, Math.min((int) (e.getRawY() + dy), sh - box.getHeight()));
                            try { wm.updateViewLayout(box, lp); } catch (Throwable t) { /* ignore */ }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) ctl.setVisibility(ctl.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
                        return true;
                    default: return true;
                }
            }
        });
        restyle();
    }

    private TextView tool(String t, View.OnClickListener l) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextColor(Color.WHITE);
        v.setTextSize(14);
        v.setGravity(Gravity.CENTER);
        v.setPadding(dp(12), dp(6), dp(12), dp(6));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(10));
        g.setColor(0x55FFFFFF);
        v.setBackground(g);
        v.setOnClickListener(l);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
        p.setMargins(dp(3), dp(6), dp(3), 0);
        v.setLayoutParams(p);
        return v;
    }

    private void bump(String k, int d) {
        try { style.put(k, Math.max(10, Math.min(60, style.optInt(k, 20) + d))); style.put("osize", Math.max(9, Math.min(44, style.optInt("osize", 13) + d))); } catch (Throwable t) { /* ignore */ }
        restyle();
    }

    private void restyle() {
        if (box == null) return;
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(14));
        int bg = col(style, "bg", Color.BLACK);
        int a = (int) Math.round(255 * Math.max(0, Math.min(1, style.optDouble("bgA", 0.6))));
        g.setColor((bg & 0x00FFFFFF) | (a << 24));
        box.setBackground(g);
        Typeface f = face();
        boolean ol = style.optBoolean("outline", true);
        tvTr.setTypeface(f);
        tvTr.setTextColor(col(style, "txt", Color.WHITE));
        tvTr.setTextSize(style.optInt("size", 20));
        tvOrig.setTypeface(Typeface.create(f, Typeface.NORMAL));
        tvOrig.setTextColor(col(style, "orig", 0xFFFFD27F));
        tvOrig.setTextSize(style.optInt("osize", 13));
        if (ol) {
            tvTr.setShadowLayer(dp(3), 0, 0, Color.BLACK);
            tvOrig.setShadowLayer(dp(2), 0, 0, Color.BLACK);
        } else {
            tvTr.setShadowLayer(0, 0, 0, 0);
            tvOrig.setShadowLayer(0, 0, 0, 0);
        }
        render();
    }

    private void render() {
        if (box == null) return;
        int max = Math.max(1, Math.min(3, style.optInt("lines", 2)));
        StringBuilder o = new StringBuilder(), t = new StringBuilder();
        int from = Math.max(0, lines.size() - max);
        for (int i = from; i < lines.size(); i++) {
            Line l = lines.get(i);
            if (o.length() > 0) { o.append('\n'); t.append('\n'); }
            o.append(l.orig);
            t.append(l.tr.isEmpty() ? "…" : l.tr);
        }
        boolean has = !lines.isEmpty();
        if (has && tvHint.getVisibility() == View.VISIBLE && !paused) setHint("");
        tvOrig.setText(o.toString());
        tvTr.setText(t.toString());
        tvOrig.setVisibility(has && style.optBoolean("showOrig", true) ? View.VISIBLE : View.GONE);
        tvTr.setVisibility(has ? View.VISIBLE : View.GONE);
        // 沒有字幕也沒有提示時把背景收起來，不擋畫面
        box.setAlpha(has || tvHint.getVisibility() == View.VISIBLE || ctl.getVisibility() == View.VISIBLE ? 1f : 0.0f);
    }

    @Override public void onDestroy() {
        alive = false;
        running = false;
        inst = null;
        synchronized (tq) { tq.notifyAll(); }
        try { if (ui != null) ui.removeCallbacksAndMessages(null); } catch (Throwable t) { /* ignore */ }
        try { if (box != null) wm.removeView(box); } catch (Throwable t) { /* ignore */ }
        try { if (mp != null) mp.stop(); } catch (Throwable t) { /* ignore */ }
        MainActivity.emit("cap", "{\"state\":\"stopped\"}");
        super.onDestroy();
    }
}
