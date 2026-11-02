# AI 全能翻譯

文字／圖片／Excel／Word／PDF／Outlook 郵件／螢幕截圖翻譯，Android APK（內建 WebView + 原生螢幕懸浮即時翻譯），附「版本與更新」系統。

- 網頁版：https://ianlin1120.github.io/ai-translator/
- 每次 push 到 `main` 並改了 `VERSION` / `web/` / `app/`，GitHub Actions 會自動建置簽章 APK，放進 `apk/`，並更新 `apks.json`、`version.json`、`index.html`（App 內的更新就是讀這幾個檔案）。

## 發新版
1. 改 `VERSION`（例如 1.0.1），寫 `RELEASE_NOTES.txt`。
2. push 到 main → 等 Actions 跑完 → App 內「檢查更新」就會看到。
   - 只改網頁介面（`web/`）而沒有改原生程式：手機收到的是「線上更新」，不用重裝 APK。
   - 改了 `app/`（原生）：請同時把 `version.json` 的 `minApk` 調到新版號（或在 Actions 設環境變數 `MIN_APK`），App 會要求安裝新 APK。

## 一次性設定
1. Settings → Pages → Source: `main` / root。
2. Settings → Secrets and variables → Actions，新增：`KEYSTORE_B64`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`（簽章金鑰請自己保管，換金鑰會讓舊版無法覆蓋更新）。
