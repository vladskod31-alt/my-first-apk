package app.libo.messenger;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowInsets;
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
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_PHOTO = 100;
    private static final int SAVE_EXPORT = 101;
    private static final int NOTIFY_PERMISSION = 102;
    private static final int BLUETOOTH_PERMISSIONS = 103;
    private static final String CSP = "default-src 'self'; script-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            + "connect-src 'self' https: wss:; font-src 'self'; media-src blob:; "
            + "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
    private WebView webView;
    private FrameLayout root;
    private SplashView splash;
    private BluetoothP2P bluetooth;
    private ValueCallback<Uri[]> photoCallback;
    private byte[] pendingExport;
    private boolean keepAlive;

    @Override
    @SuppressLint("SetJavaScriptEnabled") // Required by the bundled messenger; arbitrary remote pages are never loaded.
    protected void onCreate(Bundle state) {
        // The activity starts in AppLaunchTheme (branded splash window, see styles.xml);
        // switching here keeps every later window in the regular messenger theme.
        setTheme(R.style.AppTheme);
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(247, 247, 251));
        setContentView(root);
        installInsets();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        root.addView(webView, new FrameLayout.LayoutParams(
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
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
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
                pick.setType("image/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"});
                try { startActivityForResult(pick, PICK_PHOTO); }
                catch (ActivityNotFoundException error) {
                    photoCallback.onReceiveValue(null);
                    showToast("На пристрої немає застосунку для вибору фотографій.");
                }
                return true;
            }
        });
        webView.loadUrl(ORIGIN + "/index.html");

        bluetooth = new BluetoothP2P(this, new BluetoothP2P.Listener() {
            @Override public void onEvent(final String json) {
                runOnUiThread(new Runnable() { @Override public void run() {
                    if (webView != null) {
                        webView.evaluateJavascript(
                                "window.LiboBluetooth && window.LiboBluetooth.onEvent(" + json + ")", null);
                    }
                }});
            }
        });
        Notifications.ensureChannels(this);

        // Animated branded overlay above the WebView: no black frame while the page
        // warms up, and a small logo moment on every launch.
        splash = new SplashView(this);
        splash.setOnGone(new Runnable() { @Override public void run() {
            if (splash != null) root.removeView(splash);
            splash = null;
        }});
        root.addView(splash, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.postDelayed(new Runnable() { @Override public void run() {
            if (splash != null) splash.finish();
        }}, 6000);
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
                catch (ActivityNotFoundException error) { showToast("Немає браузера для відкриття посилання."); }
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (splash != null) view.postDelayed(new Runnable() { @Override public void run() {
                if (splash != null) splash.finish();
            }}, 250);
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
        return "application/octet-stream";
    }

    private final class NativeBridge {
        @JavascriptInterface
        public void copyText(String text) {
            if (text == null || text.length() > 1024) return;
            runOnUiThread(new Runnable() { @Override public void run() {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("Особистий код LIBO", text));
            }});
        }

        @JavascriptInterface
        public void shareText(String text) {
            if (text == null || text.length() > 3000) return;
            runOnUiThread(new Runnable() { @Override public void run() {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(send, "Запросити до LIBO")); }
                catch (ActivityNotFoundException error) { showToast("Не вдалося відкрити меню надсилання."); }
            }});
        }

        @JavascriptInterface
        public void saveText(String filename, String content) {
            if (content == null || content.length() > 6_000_000) return;
            final String safe = filename == null ? "LIBO-export.json" : filename.replaceAll("[^a-zA-Z0-9._-]", "_");
            runOnUiThread(new Runnable() { @Override public void run() {
                if (pendingExport != null) { showToast("Спершу завершіть поточний експорт."); return; }
                pendingExport = content.getBytes(StandardCharsets.UTF_8);
                Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                create.addCategory(Intent.CATEGORY_OPENABLE);
                create.setType("application/json");
                create.putExtra(Intent.EXTRA_TITLE, safe.length() > 90 ? "LIBO-export.json" : safe);
                try { startActivityForResult(create, SAVE_EXPORT); }
                catch (ActivityNotFoundException error) {
                    pendingExport = null;
                    showToast("Немає застосунку для збереження файлу.");
                }
            }});
        }

        @JavascriptInterface
        public void setDarkTheme(boolean dark) {
            runOnUiThread(new Runnable() { @Override public void run() {
                root.setBackgroundColor(dark ? Color.rgb(25, 25, 32) : Color.rgb(247, 247, 251));
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

        /** 2.8.7: the web app reports the first meaningful paint; the splash fades out. */
        @JavascriptInterface
        public void uiReady() {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (splash != null) splash.finish();
            }});
        }

        /** 2.8.7: tactile feedback for key actions ("tick", "success", "reject"). */
        @JavascriptInterface
        public void haptic(String kind) {
            runOnUiThread(new Runnable() { @Override public void run() {
                int constant = "success".equals(kind) ? HapticFeedbackConstants.CONFIRM
                        : "reject".equals(kind) ? HapticFeedbackConstants.REJECT
                        : HapticFeedbackConstants.VIRTUAL_KEY;
                if (Build.VERSION.SDK_INT >= 27) root.performHapticFeedback(constant);
                else root.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                if ("success".equals(kind) || "reject".equals(kind)) vibrate(kind);
            }});
        }

        private void vibrate(String kind) {
            Vibrator vibrator = vibrator();
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = "success".equals(kind) ? new long[]{0, 18, 60, 24} : new long[]{0, 40, 50, 40};
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                vibrator.vibrate(pattern, -1);
            }
        }

        /** 2.8.7: system notification for a message received in the background. */
        @JavascriptInterface
        public void notifyMessage(String title, String text, int badge) {
            if (text == null || text.length() > 500) return;
            runOnUiThread(new Runnable() { @Override public void run() {
                Notifications.showMessage(MainActivity.this,
                        title == null || title.isEmpty() ? "LIBO" : title, text, badge);
            }});
        }

        @JavascriptInterface
        public boolean notificationsEnabled() {
            return Notifications.areEnabled(MainActivity.this);
        }

        @JavascriptInterface
        public void requestNotifications() {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (Build.VERSION.SDK_INT >= 33 && !Notifications.permissionGranted(MainActivity.this)) {
                    requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                            NOTIFY_PERMISSION);
                }
            }});
        }

        @JavascriptInterface
        public void clearNotifications() {
            runOnUiThread(new Runnable() { @Override public void run() {
                Notifications.cancelMessages(MainActivity.this);
            }});
        }

        /** 2.8.7: opt-in foreground service so notifications arrive in background. */
        @JavascriptInterface
        public void setKeepAlive(boolean on, String status, int unread) {
            keepAlive = on;
            runOnUiThread(new Runnable() { @Override public void run() {
                if (on) ConnectionService.start(MainActivity.this,
                        status == null || status.isEmpty() ? "Тримаємо з'єднання" : status);
                else ConnectionService.stop(MainActivity.this);
            }});
        }

        @JavascriptInterface
        public void keepAliveStatus(String status, int unread) {
            runOnUiThread(new Runnable() { @Override public void run() {
                ConnectionService.update(MainActivity.this,
                        status == null || status.isEmpty() ? "Тримаємо з'єднання" : status, unread);
            }});
        }

        @JavascriptInterface
        public boolean keepAliveRunning() {
            return keepAlive && ConnectionService.running;
        }

        // ---- Bluetooth P2P (2.8.7) --------------------------------------------
        @JavascriptInterface
        public String btState() {
            return bluetooth.stateJson();
        }

        @JavascriptInterface
        public void btEnable() {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (!bluetooth.isEnabled()) {
                    try { startActivityForResult(new Intent(android.bluetooth.BluetoothAdapter.ACTION_REQUEST_ENABLE), 104); }
                    catch (ActivityNotFoundException error) { showToast("Bluetooth недоступний на цьому пристрої."); }
                }
                bluetooth.broadcastState();
            }});
        }

        @JavascriptInterface
        public void btRequestPermissions() {
            runOnUiThread(new Runnable() { @Override public void run() {
                String[] missing = bluetooth.missingPermissions();
                if (missing.length > 0) requestPermissions(missing, BLUETOOTH_PERMISSIONS);
                else bluetooth.broadcastState();
            }});
        }

        @JavascriptInterface
        public void btListen(String shortId) {
            new Thread(new Runnable() { @Override public void run() {
                bluetooth.startListening(shortId);
            }}, "libo-bt-listen").start();
        }

        @JavascriptInterface
        public void btStopListen() {
            new Thread(new Runnable() { @Override public void run() {
                bluetooth.stopListening();
            }}, "libo-bt-stop-listen").start();
        }

        @JavascriptInterface
        public void btDiscover() {
            runOnUiThread(new Runnable() { @Override public void run() { bluetooth.startDiscovery(); }});
        }

        @JavascriptInterface
        public void btStopDiscover() {
            runOnUiThread(new Runnable() { @Override public void run() { bluetooth.stopDiscovery(); }});
        }

        @JavascriptInterface
        public void btConnect(String address) {
            bluetooth.connect(address);
        }

        @JavascriptInterface
        public void btDisconnect(String address) {
            bluetooth.disconnect(address);
        }

        @JavascriptInterface
        public boolean btSend(String address, String payload) {
            return payload != null && bluetooth.send(address, payload);
        }

        @JavascriptInterface
        public void btStopAll() {
            new Thread(new Runnable() { @Override public void run() { bluetooth.stopAll(); }}, "libo-bt-stop").start();
        }
    }

    private Vibrator vibrator() {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager manager = getSystemService(VibratorManager.class);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return getSystemService(Vibrator.class);
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == BLUETOOTH_PERMISSIONS || request == NOTIFY_PERMISSION) {
            bluetooth.broadcastState();
            if (webView != null) {
                webView.evaluateJavascript("window.LiboNotify && window.LiboNotify.onPermissionChange()", null);
            }
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
        if (request == 104) bluetooth.broadcastState();
        if (request == SAVE_EXPORT) {
            byte[] bytes = pendingExport;
            pendingExport = null;
            if (bytes == null || result != RESULT_OK || data == null || data.getData() == null) return;
            Uri uri = data.getData();
            new Thread(new Runnable() { @Override public void run() {
                try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new IOException("No output stream");
                    output.write(bytes);
                    runOnUiThread(new Runnable() { @Override public void run() { showToast("Текстовий експорт збережено"); }});
                } catch (IOException | SecurityException error) {
                    runOnUiThread(new Runnable() { @Override public void run() { showToast("Не вдалося зберегти файл. Перевірте вільне місце."); }});
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
        super.onPause();
        // With the keep-alive service on, the WebView must keep executing JavaScript in
        // the background: that is what lets incoming messages raise notifications.
        if (webView != null && !keepAlive) webView.onPause();
        if (keepAlive) ConnectionService.update(this, "LIBO у фоні · чекаємо на повідомлення", 0);
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        Notifications.cancelMessages(this);
        if (keepAlive) ConnectionService.update(this, "LIBO відкрито на екрані", 0);
    }
    @Override protected void onDestroy() {
        if (photoCallback != null) { photoCallback.onReceiveValue(null); photoCallback = null; }
        pendingExport = null;
        if (bluetooth != null) bluetooth.stopAll();
        if (webView != null) {
            root.removeView(webView);
            webView.removeJavascriptInterface("LiboAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
    private void showToast(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
}
