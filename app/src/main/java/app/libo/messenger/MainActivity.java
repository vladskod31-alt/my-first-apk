package app.libo.messenger;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import org.json.JSONObject;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** A small, offline-capable shell. Only bundled application code can access the native bridge. */
public final class MainActivity extends Activity {
    public static volatile boolean isForeground = false;
    private static final int REQUEST_NOTIFICATIONS = 2303;
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_PHOTO = 100;
    private static final int SAVE_EXPORT = 101;
    private static final String CSP = "default-src 'self'; script-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            + "connect-src 'self' https: wss:; font-src 'self'; media-src blob:; "
            + "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
    private WebView webView;
    private FrameLayout root;
    private ValueCallback<Uri[]> photoCallback;
    private byte[] pendingExport;
    private String pendingExportAsset;
    private View privacyCover;
    private volatile String appLanguage = "ru";

    @Override
    @SuppressLint("SetJavaScriptEnabled") // Required by the bundled messenger; arbitrary remote pages are never loaded.
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        appLanguage = getSharedPreferences("privacy", MODE_PRIVATE).getString("language", "ru");
        if (getSharedPreferences("privacy", MODE_PRIVATE).getBoolean("vault", false)) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(247, 247, 251));
        setContentView(root);
        installInsets();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        privacyCover = new View(this);
        privacyCover.setBackgroundColor(Color.rgb(247, 247, 251));
        privacyCover.setVisibility(View.GONE);
        root.addView(privacyCover, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // System photo picker grants access only to the chosen content URI.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new NativeBridge(), "LiboAndroid");
        webView.setWebViewClient(new LocalContentClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (photoCallback != null) photoCallback.onReceiveValue(null);
                photoCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                boolean json = false;
                for (String accept : params.getAcceptTypes()) if (accept != null && (accept.contains("json") || accept.contains(".json"))) json = true;
                if (json) {
                    pick.setType("*/*");
                    pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                } else {
                    pick.setType("image/*");
                    pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"});
                }
                try { startActivityForResult(pick, PICK_PHOTO); }
                catch (ActivityNotFoundException error) {
                    photoCallback.onReceiveValue(null);
                    photoCallback = null;
                    showToast("На устройстве нет приложения для выбора фотографий.");
                }
                return true;
            }
        });
        webView.loadUrl(ORIGIN + "/index.html");
    }

    private void installInsets() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
                }
            });
            root.requestApplyInsets();
        }
    }

    private boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private final class LocalContentClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isLocal(uri)) return null;
            String path = uri.getPath();
            if (path == null || "/".equals(path)) path = "/index.html";
            if (path.contains("..") || path.contains("\\") || !"GET".equals(request.getMethod())) {
                return missing();
            }
            try {
                InputStream content = getAssets().open(path.substring(1));
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Security-Policy", CSP);
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Cache-Control", "no-store");
                return new WebResourceResponse(mimeType(path), "UTF-8", 200, "OK", headers, content);
            } catch (IOException error) { return missing(); }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isLocal(uri)) return false;
            // Never run remote HTML alongside the native JavascriptInterface.
            if (request.isForMainFrame() && request.hasGesture()
                    && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (ActivityNotFoundException error) { showToast("Нет браузера для открытия ссылки."); }
            }
            return true;
        }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
                new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));
    }

    private static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".zip")) return "application/zip";
        if (path.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    private final class NativeBridge {
        @JavascriptInterface
        public void copyText(String text) {
            if (text == null || text.length() > 1024) return;
            runOnUiThread(new Runnable() { @Override public void run() {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("LIBO", text));
            }});
        }

        @JavascriptInterface
        public void saveText(String filename, String content) {
            if (content == null || content.length() > 6_000_000) return;
            final String safe = filename == null ? "LIBO-export.json" : filename.replaceAll("[^a-zA-Z0-9._-]", "_");
            runOnUiThread(new Runnable() { @Override public void run() {
                if (pendingExport != null || pendingExportAsset != null) { showToast("Сначала завершите текущий экспорт."); return; }
                pendingExport = content.getBytes(StandardCharsets.UTF_8);
                Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                create.addCategory(Intent.CATEGORY_OPENABLE);
                create.setType("application/json");
                create.putExtra(Intent.EXTRA_TITLE, safe.length() > 90 ? "LIBO-export.json" : safe);
                try { startActivityForResult(create, SAVE_EXPORT); }
                catch (ActivityNotFoundException error) {
                    pendingExport = null;
                    showToast("Нет приложения для сохранения файла.");
                }
            }});
        }

        @JavascriptInterface
        public void saveEmojiPack() {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (pendingExport != null || pendingExportAsset != null) { showToast("Сначала завершите текущий экспорт."); return; }
                // Fixed bundled asset: the bridge never accepts an arbitrary filesystem path.
                pendingExportAsset = "emoji/libo-emoji-svg.zip";
                Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                create.addCategory(Intent.CATEGORY_OPENABLE);
                create.setType("application/zip");
                create.putExtra(Intent.EXTRA_TITLE, "LIBO-Emoji-15.0-SVG.zip");
                try { startActivityForResult(create, SAVE_EXPORT); }
                catch (ActivityNotFoundException error) { pendingExportAsset = null; showToast("Нет приложения для сохранения файла."); }
            }});
        }

        @JavascriptInterface
        public void setLanguage(String language) {
            if (!"ru".equals(language) && !"uk".equals(language) && !"en".equals(language)) return;
            appLanguage = language;
            getSharedPreferences("privacy", MODE_PRIVATE).edit().putString("language", language).apply();
        }

        @JavascriptInterface
        public void setSecureWindow(boolean enabled) {
            runOnUiThread(new Runnable() { @Override public void run() {
                getSharedPreferences("privacy", MODE_PRIVATE).edit().putBoolean("vault", enabled).apply();
                if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }});
        }

        @JavascriptInterface
        public String notificationStatus() {
            try {
                JSONObject info = new JSONObject(); info.put("available", true);
                info.put("permission", MessageSyncService.notificationPermission(MainActivity.this) ? "granted" : "denied");
                info.put("running", MessageSyncService.running); info.put("connected", MessageSyncService.connected); return info.toString();
            } catch (Exception ignored) { return "{}"; }
        }

        @JavascriptInterface
        public void requestNotifications() {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    boolean asked = getSharedPreferences("privacy", MODE_PRIVATE).getBoolean("notificationAsked", false);
                    if (asked && !shouldShowRequestPermissionRationale("android.permission.POST_NOTIFICATIONS")) {
                        try { startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())); }
                        catch (ActivityNotFoundException ignored) { showToast("Настройки Android недоступны."); }
                    } else {
                        getSharedPreferences("privacy", MODE_PRIVATE).edit().putBoolean("notificationAsked", true).apply();
                        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQUEST_NOTIFICATIONS);
                    }
                } else {
                    try { startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())); }
                    catch (ActivityNotFoundException ignored) { showToast("Настройки Android недоступны."); }
                }
            }});
        }

        @JavascriptInterface
        public void openBatterySettings() {
            runOnUiThread(new Runnable() { @Override public void run() {
                try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
                catch (ActivityNotFoundException ignored) { showToast("Настройки Android недоступны."); }
            }});
        }

        @JavascriptInterface
        public void configureBackground(String value) {
            if (value == null || value.length() > 4096) return;
            runOnUiThread(new Runnable() { @Override public void run() {
                try {
                    JSONObject config = new JSONObject(value);
                    if (!config.optBoolean("enabled")) { MessageSyncService.stop(MainActivity.this); BackgroundPreferences.clear(MainActivity.this); return; }
                    if (!MessageSyncService.notificationPermission(MainActivity.this)) return;
                    BackgroundPreferences.save(MainActivity.this, config); MessageSyncService.start(MainActivity.this);
                } catch (Exception ignored) { showToast("Не удалось включить фоновую доставку."); }
            }});
        }

        @JavascriptInterface
        public void setDarkTheme(boolean dark) {
            runOnUiThread(new Runnable() { @Override public void run() {
                root.setBackgroundColor(dark ? Color.rgb(25, 25, 32) : Color.rgb(247, 247, 251));
                privacyCover.setBackgroundColor(dark ? Color.rgb(25, 25, 32) : Color.rgb(247, 247, 251));
                if (Build.VERSION.SDK_INT >= 30) {
                    WindowInsetsController controller = getWindow().getInsetsController();
                    if (controller != null) {
                        int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                        controller.setSystemBarsAppearance(dark ? 0 : light, light);
                    }
                } else {
                    getWindow().setStatusBarColor(dark ? Color.rgb(25, 25, 32) : Color.rgb(247, 247, 251));
                    getWindow().setNavigationBarColor(dark ? Color.rgb(25, 25, 32) : Color.WHITE);
                    getWindow().getDecorView().setSystemUiVisibility(dark ? 0
                            : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
                }
            }});
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_PHOTO && photoCallback != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            photoCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
            photoCallback = null;
        }
        if (request == SAVE_EXPORT) {
            byte[] bytes = pendingExport;
            String asset = pendingExportAsset;
            pendingExport = null; pendingExportAsset = null;
            if ((bytes == null && asset == null) || result != RESULT_OK || data == null || data.getData() == null) return;
            Uri uri = data.getData();
            new Thread(new Runnable() { @Override public void run() {
                try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new IOException("No output stream");
                    if (asset != null) {
                        try (InputStream input = getAssets().open(asset)) {
                            byte[] buffer = new byte[8192]; int count;
                            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                        }
                    } else output.write(bytes);
                    runOnUiThread(new Runnable() { @Override public void run() { showToast("Файл сохранён"); }});
                } catch (IOException | SecurityException error) {
                    runOnUiThread(new Runnable() { @Override public void run() { showToast("Не удалось сохранить файл. Проверьте свободное место."); }});
                }
            }}, "libo-export").start();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) { finish(); return; }
        webView.evaluateJavascript("Boolean(window.Libo && window.Libo.handleBack())", new ValueCallback<String>() {
            @Override public void onReceiveValue(String result) {
                if (!"true".equals(result)) finish();
            }
        });
    }

    @Override protected void onPause() {
        isForeground = false;
        super.onPause();
        if (privacyCover != null) privacyCover.setVisibility(View.VISIBLE);
        if (webView != null) {
            webView.evaluateJavascript("window.Libo && window.Libo.onBackground()", null);
            webView.onPause();
        }
    }
    @Override protected void onResume() {
        super.onResume(); isForeground = true; MessageSyncService.clearMessages(this);
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.Libo && window.Libo.onForeground()", new ValueCallback<String>() {
                @Override public void onReceiveValue(String ignored) {
                    if (privacyCover != null) privacyCover.setVisibility(View.GONE);
                }
            });
        }
    }
    @Override protected void onDestroy() {
        isForeground = false;
        if (photoCallback != null) { photoCallback.onReceiveValue(null); photoCallback = null; }
        pendingExport = null; pendingExportAsset = null;
        if (webView != null) {
            root.removeView(webView);
            webView.removeJavascriptInterface("LiboAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == REQUEST_NOTIFICATIONS && webView != null) webView.evaluateJavascript("window.Libo && window.Libo.onNotificationPermission()", null);
    }

    private void showToast(String text) {
        String value = text;
        if ("uk".equals(appLanguage)) {
            if (text.equals("Настройки Android недоступны.")) value = "Налаштування Android недоступні.";
            if (text.equals("Не удалось включить фоновую доставку.")) value = "Не вдалося ввімкнути фонову доставку.";
            if (text.equals("На устройстве нет приложения для выбора фотографий.")) value = "Немає застосунку для вибору фотографій.";
            if (text.equals("Нет браузера для открытия ссылки.")) value = "Немає браузера для відкриття посилання.";
            if (text.equals("Сначала завершите текущий экспорт.")) value = "Спочатку завершіть поточний експорт.";
            if (text.equals("Нет приложения для сохранения файла.")) value = "Немає застосунку для збереження файлу.";
            if (text.equals("Файл сохранён")) value = "Файл збережено";
            if (text.equals("Не удалось сохранить файл. Проверьте свободное место.")) value = "Не вдалося зберегти файл. Перевірте вільне місце.";
        } else if ("en".equals(appLanguage)) {
            if (text.equals("Настройки Android недоступны.")) value = "Android settings are unavailable.";
            if (text.equals("Не удалось включить фоновую доставку.")) value = "Could not enable background delivery.";
            if (text.equals("На устройстве нет приложения для выбора фотографий.")) value = "No photo picker is available on this device.";
            if (text.equals("Нет браузера для открытия ссылки.")) value = "No browser is available to open the link.";
            if (text.equals("Сначала завершите текущий экспорт.")) value = "Finish the current export first.";
            if (text.equals("Нет приложения для сохранения файла.")) value = "No app is available to save this file.";
            if (text.equals("Файл сохранён")) value = "File saved";
            if (text.equals("Не удалось сохранить файл. Проверьте свободное место.")) value = "Could not save the file. Check your device’s free space.";
        }
        Toast.makeText(this, value, Toast.LENGTH_LONG).show();
    }
}
