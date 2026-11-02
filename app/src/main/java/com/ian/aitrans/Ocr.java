package com.ian.aitrans;

import android.graphics.Bitmap;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** 裝置端文字辨識（ML Kit，離線、免費）。回傳「段落」清單。 */
final class Ocr {
    private static final Map<String, TextRecognizer> CACHE = new HashMap<String, TextRecognizer>();

    private Ocr() { }

    private static synchronized TextRecognizer client(String kind) {
        TextRecognizer r = CACHE.get(kind);
        if (r != null) return r;
        if ("zh".equals(kind)) r = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        else if ("ja".equals(kind)) r = TextRecognition.getClient(new JapaneseTextRecognizerOptions.Builder().build());
        else if ("ko".equals(kind)) r = TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
        else r = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        CACHE.put(kind, r);
        return r;
    }

    /** 依來源語言決定嘗試哪些辨識器。 */
    static String[] kinds(String lang) throws Exception {
        if (lang == null || lang.isEmpty() || "auto".equals(lang)) return new String[] {"zh", "ja", "ko"};
        if (lang.startsWith("zh")) return new String[] {"zh"};
        if (lang.startsWith("ja")) return new String[] {"ja"};
        if (lang.startsWith("ko")) return new String[] {"ko"};
        if (lang.equals("ru") || lang.equals("ar") || lang.equals("th"))
            throw new Exception("裝置端辨識不支援這個語言的文字，請改用「Claude 看圖」辨識，或把來源語言設為「自動偵測」。");
        return new String[] {"latin"};
    }

    static List<String> recognize(Bitmap bmp, String lang) throws Exception {
        String[] ks = kinds(lang);
        for (String k : ks) {
            Text t = Tasks.await(client(k).process(InputImage.fromBitmap(bmp, 0)), 40, TimeUnit.SECONDS);
            List<String> out = new ArrayList<String>();
            for (Text.TextBlock b : t.getTextBlocks()) {
                String s = joinLines(b);
                if (hasLetter(s)) out.add(s);
            }
            if (!out.isEmpty()) return out;
        }
        return new ArrayList<String>();
    }

    private static boolean isCjk(char c) {
        return (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x3000 && c <= 0x303f);
    }

    private static boolean hasLetter(String s) {
        for (int i = 0; i < s.length(); i++) if (Character.isLetter(s.charAt(i))) return true;
        return false;
    }

    private static String joinLines(Text.TextBlock b) {
        StringBuilder sb = new StringBuilder();
        for (Text.Line l : b.getLines()) {
            String s = l.getText().trim();
            if (s.isEmpty()) continue;
            if (sb.length() > 0) {
                char a = sb.charAt(sb.length() - 1), c = s.charAt(0);
                if (!(isCjk(a) || isCjk(c))) sb.append(' ');
            }
            sb.append(s);
        }
        return sb.toString();
    }
}
