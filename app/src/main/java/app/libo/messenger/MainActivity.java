package app.libo.messenger;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** A small offline-capable shell. Only bundled application code can access the native bridge. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_FILE = 100;
    private static final int SAVE_EXPORT = 101;
    private static final int SAVE_ATTACHMENT = 102;
    private static final int REQUEST_NOTIFICATIONS = 103;
    private static final int REQUEST_MEDIA = 104;
    private static final long MAX_SAVE_BYTES = 100L * 1024L * 1024L;
    private static final String CSP = "default-src 'self'; script-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            + "connect-src 'self' https: wss:; font-src 'self'; media-src blob:; "
            + "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
    private WebView webView;
    private FrameLayout root;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingMediaPermission;
    private byte[] pendingExport;
    private final Object saveLock = new Object();
    private OutputStream pendingSaveOutput;
    private String pendingSaveName;
    private long pendingSaveExpectedBytes;
    private long pendingSaveWrittenBytes;
    private String pendingDeepLink;
    private String pendingReminderChat;
    private String pendingReminderMessage;

    @Override
    @SuppressLint("SetJavaScriptEnabled") // Required by the bundled messenger; arbitrary remote pages are never loaded.
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(247, 247, 251));
        setContentView(root);
        installInsets();
        captureIncomingIntent(getIntent());

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // System picker grants access only to the chosen content URI.
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
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                String[] accepts = safeAcceptTypes(params == null ? null : params.getAcceptTypes());
                boolean photosOnly = accepts.length > 0;
                for (String accept : accepts) if (!accept.startsWith("image/")) photosOnly = false;
                if (photosOnly) {
                    pick.setType("image/*");
                    pick.putExtra(Intent.EXTRA_MIME_TYPES, accepts);
                } else {
                    pick.setType("*/*");
                    if (accepts.length > 0) pick.putExtra(Intent.EXTRA_MIME_TYPES, accepts);
                }
                try { startActivityForResult(pick, PICK_FILE); }
                catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    showToast("На устройстве нет приложения для выбора файлов.");
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (request == null || request.getOrigin() == null || !isLocal(request.getOrigin())) {
                    if (request != null) request.deny();
                    return;
                }
                boolean wantsAudio = false;
                boolean wantsVideo = false;
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) wantsAudio = true;
                    else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsVideo = true;
                    else { request.deny(); return; }
                }
                if (!wantsAudio && !wantsVideo) { request.deny(); return; }
                if (pendingMediaPermission != null) { request.deny(); return; }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        && ((wantsAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                        || (wantsVideo && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED))) {
                    pendingMediaPermission = request;
                    ArrayList<String> permissions = new ArrayList<>();
                    if (wantsAudio) permissions.add(Manifest.permission.RECORD_AUDIO);
                    if (wantsVideo) permissions.add(Manifest.permission.CAMERA);
                    requestPermissions(permissions.toArray(new String[0]), REQUEST_MEDIA);
                    return;
                }
                grantMediaPermission(request);
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMediaPermission == request) pendingMediaPermission = null;
                super.onPermissionRequestCanceled(request);
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
            if (path.contains("..") || path.contains("\\") || !"GET".equals(request.getMethod())) return missing();
            try {
                InputStream content = getAssets().open(path.substring(1));
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Security-Policy", CSP);
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Cache-Control", "no-store");
                return new WebResourceResponse(mimeType(path), "UTF-8", 200, "OK", headers, content);
            } catch (IOException error) { return missing(); }
        }

        @Override public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            dispatchIncomingIntent();
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
        return "application/octet-stream";
    }

    // Only grant WebRTC capture resources requested by the bundled app origin and only
    // after the matching Android runtime permission has been granted by the user.
    private void grantMediaPermission(PermissionRequest request) {
        if (request == null || request.getOrigin() == null || !isLocal(request.getOrigin())) { if (request != null) request.deny(); return; }
        ArrayList<String> grants = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)) {
                grants.add(resource);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)) {
                grants.add(resource);
            }
        }
        if (grants.isEmpty()) request.deny();
        else request.grant(grants.toArray(new String[0]));
    }

    private static String[] safeAcceptTypes(String[] values) {
        if (values == null) return new String[0];
        ArrayList<String> accepted = new ArrayList<>();
        for (String value : values) {
            if (value == null) continue;
            String mime = value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
            if (mime.matches("(?:audio|video|image|application|text)/[a-z0-9.+*-]{1,64}") && !accepted.contains(mime)) accepted.add(mime);
            if (accepted.size() >= 16) break;
        }
        return accepted.toArray(new String[0]);
    }

    private static String safeFilename(String value, String fallback) {
        if (value == null) return fallback;
        String clean = value.replaceAll("[^\\p{L}\\p{N}._-]", "_");
        if (clean.isEmpty() || clean.length() > 90) return fallback;
        return clean;
    }

    private static boolean safeMime(String value) {
        return value != null && value.matches("[a-zA-Z0-9.+-]{1,64}/[a-zA-Z0-9.+-]{1,64}");
    }

    private static boolean safeId(String value) {
        return value != null && value.matches("[a-zA-Z0-9-]{1,128}");
    }

    private final class NativeBridge {
        @JavascriptInterface
        public void copyText(String text) {
            if (text == null || text.length() > 1024) return;
            runOnUiThread(new Runnable() { @Override public void run() {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("Личный код LIBO", text));
            }});
        }

        @JavascriptInterface
        public void shareText(String text) {
            if (text == null || text.length() > 3000) return;
            runOnUiThread(new Runnable() { @Override public void run() {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(send, "Пригласить в LIBO")); }
                catch (ActivityNotFoundException error) { showToast("Не удалось открыть меню отправки."); }
            }});
        }

        @JavascriptInterface
        public void saveText(String filename, String content) {
            if (content == null || content.length() > 6_000_000) return;
            final String safe = safeFilename(filename, "LIBO-export.json");
            runOnUiThread(new Runnable() { @Override public void run() {
                if (pendingExport != null) { showToast("Сначала завершите текущий экспорт."); return; }
                pendingExport = content.getBytes(StandardCharsets.UTF_8);
                Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                create.addCategory(Intent.CATEGORY_OPENABLE);
                create.setType("application/json");
                create.putExtra(Intent.EXTRA_TITLE, safe);
                try { startActivityForResult(create, SAVE_EXPORT); }
                catch (ActivityNotFoundException error) {
                    pendingExport = null;
                    showToast("Нет приложения для сохранения файла.");
                }
            }});
        }

        // A blob is never exposed as a file:// URL. JS sends one bounded Base64 chunk
        // only after Java has durably written the previous one, preserving backpressure.
        @JavascriptInterface
        public void startSaveFile(String filename, String mime, long size) {
            if (size < 0 || size > MAX_SAVE_BYTES || !safeMime(mime)) { signalJs("onNativeSaveReady", false, "Недопустимый файл для сохранения."); return; }
            final String safe = safeFilename(filename, "LIBO-file");
            runOnUiThread(new Runnable() { @Override public void run() {
                synchronized (saveLock) {
                    if (pendingSaveName != null || pendingSaveOutput != null) { signalJs("onNativeSaveReady", false, "Уже идёт сохранение файла."); return; }
                    pendingSaveName = safe;
                    pendingSaveExpectedBytes = size;
                    pendingSaveWrittenBytes = 0;
                }
                Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                create.addCategory(Intent.CATEGORY_OPENABLE);
                create.setType(mime);
                create.putExtra(Intent.EXTRA_TITLE, safe);
                try { startActivityForResult(create, SAVE_ATTACHMENT); }
                catch (ActivityNotFoundException error) { clearPendingSave(); signalJs("onNativeSaveReady", false, "Нет приложения для сохранения файла."); }
            }});
        }

        @JavascriptInterface
        public void writeSaveChunk(String base64) {
            if (base64 == null || base64.length() < 4 || base64.length() > 40_000 || !base64.matches("[A-Za-z0-9+/]+={0,2}")) {
                signalJs("onNativeSaveChunkWritten", false, "Некорректная часть файла."); return;
            }
            new Thread(new Runnable() { @Override public void run() {
                try {
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                    synchronized (saveLock) {
                        if (pendingSaveOutput == null) throw new IOException("Output is not open");
                        if (bytes.length > pendingSaveExpectedBytes - pendingSaveWrittenBytes) {
                            throw new IOException("Save size exceeds declared Blob size");
                        }
                        pendingSaveOutput.write(bytes);
                        pendingSaveWrittenBytes += bytes.length;
                    }
                    signalJs("onNativeSaveChunkWritten", true, "");
                } catch (IllegalArgumentException | IOException error) {
                    clearPendingSave();
                    signalJs("onNativeSaveChunkWritten", false, "Не удалось записать часть файла.");
                }
            }}, "libo-save-chunk").start();
        }

        @JavascriptInterface
        public void finishSaveFile() {
            new Thread(new Runnable() { @Override public void run() {
                boolean success = false;
                try {
                    synchronized (saveLock) {
                        if (pendingSaveOutput == null) throw new IOException("Output is not open");
                        if (pendingSaveWrittenBytes != pendingSaveExpectedBytes) {
                            throw new IOException("Save size does not match declared Blob size");
                        }
                        pendingSaveOutput.flush();
                        pendingSaveOutput.close();
                        pendingSaveOutput = null;
                        pendingSaveName = null;
                        pendingSaveExpectedBytes = 0;
                        pendingSaveWrittenBytes = 0;
                    }
                    success = true;
                } catch (IOException error) { clearPendingSave(); }
                signalJs("onNativeSaveFinished", success, success ? "" : "Не удалось завершить сохранение файла.");
            }}, "libo-save-finish").start();
        }

        @JavascriptInterface
        public void scheduleReminder(String id, String title, String body, long at, String chatId, String messageId) {
            if (!safeId(id) || !safeId(chatId) || !safeId(messageId) || at < System.currentTimeMillis() + 5_000L || at > System.currentTimeMillis() + 3660L * 24L * 60L * 60L) return;
            String cleanTitle = title == null ? "LIBO: напоминание" : title.substring(0, Math.min(80, title.length()));
            String cleanBody = body == null ? "Откройте сообщение в LIBO." : body.substring(0, Math.min(220, body.length()));
            Intent intent = new Intent(MainActivity.this, ReminderReceiver.class)
                    .putExtra("reminderId", id).putExtra("title", cleanTitle).putExtra("body", cleanBody)
                    .putExtra(ReminderReceiver.EXTRA_CHAT_ID, chatId).putExtra(ReminderReceiver.EXTRA_MESSAGE_ID, messageId);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent alarmIntent = PendingIntent.getBroadcast(MainActivity.this, id.hashCode(), intent, flags);
            AlarmManager alarms = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (alarms != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent);
                else alarms.set(AlarmManager.RTC_WAKEUP, at, alarmIntent);
            }
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(new Runnable() { @Override public void run() { requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS); }});
            }
        }

        @JavascriptInterface
        public void setDarkTheme(boolean dark) {
            runOnUiThread(new Runnable() { @Override public void run() {
                root.setBackgroundColor(dark ? Color.rgb(25, 25, 32) : Color.rgb(247, 247, 251));
                if (Build.VERSION.SDK_INT >= 30) {
                    WindowInsetsController controller = getWindow().getInsetsController();
                    if (controller != null) {
                        int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                        controller.setSystemBarsAppearance(dark ? 0 : light, light);
                    }
                } else {
                    getWindow().setStatusBarColor(dark ? Color.rgb(25, 25, 32) : Color.rgb(247, 247, 251));
                    getWindow().setNavigationBarColor(dark ? Color.rgb(25, 25, 32) : Color.WHITE);
                    getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
                }
            }});
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_MEDIA) return;
        PermissionRequest request = pendingMediaPermission;
        pendingMediaPermission = null;
        if (request == null) return;
        boolean granted = true;
        for (int result : grantResults) if (result != PackageManager.PERMISSION_GRANTED) { granted = false; break; }
        if (granted) grantMediaPermission(request); else request.deny();
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && fileCallback != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
            fileCallback = null;
        }
        if (request == SAVE_EXPORT) {
            byte[] bytes = pendingExport;
            pendingExport = null;
            if (bytes == null || result != RESULT_OK || data == null || data.getData() == null) return;
            Uri uri = data.getData();
            new Thread(new Runnable() { @Override public void run() {
                try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new IOException("No output stream");
                    output.write(bytes);
                    runOnUiThread(new Runnable() { @Override public void run() { showToast("Текстовый экспорт сохранён"); }});
                } catch (IOException | SecurityException error) {
                    runOnUiThread(new Runnable() { @Override public void run() { showToast("Не удалось сохранить файл. Проверьте свободное место."); }});
                }
            }}, "libo-export").start();
        }
        if (request == SAVE_ATTACHMENT) {
            if (result != RESULT_OK || data == null || data.getData() == null) {
                clearPendingSave(); signalJs("onNativeSaveReady", false, "Сохранение файла отменено."); return;
            }
            Uri uri = data.getData();
            new Thread(new Runnable() { @Override public void run() {
                try {
                    OutputStream output = getContentResolver().openOutputStream(uri);
                    if (output == null) throw new IOException("No output stream");
                    synchronized (saveLock) { pendingSaveOutput = output; }
                    signalJs("onNativeSaveReady", true, "");
                } catch (IOException | SecurityException error) {
                    clearPendingSave(); signalJs("onNativeSaveReady", false, "Не удалось открыть файл для записи.");
                }
            }}, "libo-save-open").start();
        }
    }

    private void clearPendingSave() {
        synchronized (saveLock) {
            if (pendingSaveOutput != null) {
                try { pendingSaveOutput.close(); } catch (IOException ignored) { }
            }
            pendingSaveOutput = null;
            pendingSaveName = null;
            pendingSaveExpectedBytes = 0;
            pendingSaveWrittenBytes = 0;
        }
    }

    private void signalJs(String callback, boolean ok, String detail) {
        runOnUiThread(new Runnable() { @Override public void run() {
            if (webView == null) return;
            webView.evaluateJavascript("window.Libo&&window.Libo." + callback + "(" + ok + "," + JSONObject.quote(detail == null ? "" : detail) + ")", null);
        }});
    }

    private void captureIncomingIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && "libo".equalsIgnoreCase(data.getScheme()) && data.getHost() != null
                && data.getHost().matches("(?i)user|chat|channel|message|file") && data.getQuery() == null && data.getFragment() == null) {
            pendingDeepLink = data.toString();
        }
        String chat = intent.getStringExtra(ReminderReceiver.EXTRA_CHAT_ID);
        String message = intent.getStringExtra(ReminderReceiver.EXTRA_MESSAGE_ID);
        if (safeId(chat) && safeId(message)) { pendingReminderChat = chat; pendingReminderMessage = message; }
    }

    private void dispatchIncomingIntent() {
        if (webView == null) return;
        if (pendingDeepLink != null) {
            String link = pendingDeepLink; pendingDeepLink = null;
            webView.evaluateJavascript("window.Libo&&window.Libo.openLink(" + JSONObject.quote(link) + ")", null);
        }
        if (pendingReminderChat != null && pendingReminderMessage != null) {
            String chat = pendingReminderChat, message = pendingReminderMessage;
            pendingReminderChat = null; pendingReminderMessage = null;
            webView.evaluateJavascript("window.Libo&&window.Libo.onNativeReminder(" + JSONObject.quote(chat) + "," + JSONObject.quote(message) + ")", null);
        }
    }

    @Override public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureIncomingIntent(intent);
        dispatchIncomingIntent();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) { finish(); return; }
        webView.evaluateJavascript("Boolean(window.Libo && window.Libo.handleBack())", new ValueCallback<String>() {
            @Override public void onReceiveValue(String result) { if (!"true".equals(result)) finish(); }
        });
    }

    @Override protected void onPause() { super.onPause(); if (webView != null) webView.onPause(); }
    @Override protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); }
    @Override protected void onDestroy() {
        if (pendingMediaPermission != null) { pendingMediaPermission.deny(); pendingMediaPermission = null; }
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        pendingExport = null;
        clearPendingSave();
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
