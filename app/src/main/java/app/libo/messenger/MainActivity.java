package app.libo.messenger;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.app.KeyguardManager;
import android.content.Context;
import android.graphics.Insets;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
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
import java.security.KeyStore;
import java.util.HashMap;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/** A small, offline-capable shell. Only bundled application code can access the native bridge. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_PHOTO = 100;
    private static final int SAVE_EXPORT = 101;
    private static final int CONFIRM_CREDENTIAL = 102;
    private static final String VAULT_ALIAS = "libo-vault-v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String CSP = "default-src 'self'; script-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            + "connect-src 'self' https: wss:; font-src 'self'; media-src blob:; "
            + "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
    private WebView webView;
    private FrameLayout root;
    private ValueCallback<Uri[]> photoCallback;
    private byte[] pendingExport;

    @Override
    @SuppressLint("SetJavaScriptEnabled") // Required by the bundled messenger; arbitrary remote pages are never loaded.
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(247, 247, 251));
        setContentView(root);
        // FLAG_SECURE: no screenshots, no preview in the recent-apps switcher, no screen capture.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
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
        return "application/octet-stream";
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
            final String safe = filename == null ? "LIBO-export.json" : filename.replaceAll("[^a-zA-Z0-9._-]", "_");
            runOnUiThread(new Runnable() { @Override public void run() {
                if (pendingExport != null) { showToast("Сначала завершите текущий экспорт."); return; }
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

        // ---- 2.8.2: Android Keystore wrapping for the IndexedDB vault key -------------
        // The web layer generates a random 256-bit vault key and asks the shell to wrap
        // it. The wrapping key is an AES-256-GCM key that never leaves Android Keystore
        // (StrongBox / TEE where available); only the wrapped blob is persisted.
        @JavascriptInterface
        public String keystoreWrap(String rawBase64) {
            try {
                SecretKey key = vaultKey(true);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key);
                byte[] iv = cipher.getIV();
                byte[] sealed = cipher.doFinal(Base64.decode(rawBase64, Base64.DEFAULT));
                byte[] out = new byte[1 + iv.length + sealed.length];
                out[0] = (byte) iv.length;
                System.arraycopy(iv, 0, out, 1, iv.length);
                System.arraycopy(sealed, 0, out, 1 + iv.length, sealed.length);
                return Base64.encodeToString(out, Base64.NO_WRAP);
            } catch (Exception error) { return null; }
        }

        @JavascriptInterface
        public String keystoreUnwrap(String wrappedBase64) {
            try {
                SecretKey key = vaultKey(false);
                if (key == null) return null;
                byte[] blob = Base64.decode(wrappedBase64, Base64.DEFAULT);
                int ivLength = blob[0] & 0xff;
                byte[] iv = new byte[ivLength];
                System.arraycopy(blob, 1, iv, 0, ivLength);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
                byte[] raw = cipher.doFinal(blob, 1 + ivLength, blob.length - 1 - ivLength);
                return Base64.encodeToString(raw, Base64.NO_WRAP);
            } catch (Exception error) { return null; }
        }

        @JavascriptInterface
        public boolean keystoreHardwareBacked() {
            try {
                SecretKey key = vaultKey(false);
                if (key == null) return false;
                SecretKeyFactory factory = SecretKeyFactory.getInstance(key.getAlgorithm(), KEYSTORE);
                KeyInfo info = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);
                if (Build.VERSION.SDK_INT >= 31) {
                    int level = info.getSecurityLevel();
                    return level == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT || level == KeyProperties.SECURITY_LEVEL_STRONGBOX;
                }
                return info.isInsideSecureHardware();
            } catch (Exception error) { return false; }
        }

        @JavascriptInterface
        public boolean biometricAvailable() {
            KeyguardManager keyguard = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            return keyguard != null && keyguard.isDeviceSecure();
        }

        // Biometric or device-credential confirmation. Result goes back through
        // window.Libo.onBiometric(ok). API 28+ uses the system BiometricPrompt; API 26/27
        // fall back to the keyguard credential screen.
        @JavascriptInterface
        public void biometricUnlock() {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (Build.VERSION.SDK_INT >= 30) {
                    BiometricPrompt prompt = new BiometricPrompt.Builder(MainActivity.this)
                            .setTitle("LIBO заблокирован")
                            .setSubtitle("Подтвердите личность, чтобы открыть переписку")
                            .setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG
                                    | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                            .build();
                    prompt.authenticate(new CancellationSignal(), getMainExecutor(), biometricCallback());
                } else if (Build.VERSION.SDK_INT >= 28) {
                    BiometricPrompt prompt = new BiometricPrompt.Builder(MainActivity.this)
                            .setTitle("LIBO заблокирован")
                            .setSubtitle("Подтвердите личность, чтобы открыть переписку")
                            .setDeviceCredentialAllowed(true)
                            .build();
                    prompt.authenticate(new CancellationSignal(), getMainExecutor(), biometricCallback());
                } else {
                    KeyguardManager keyguard = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                    Intent intent = keyguard == null ? null : keyguard.createConfirmDeviceCredentialIntent("LIBO заблокирован", "Подтвердите личность");
                    if (intent == null) { reportBiometric(false); return; }
                    try { startActivityForResult(intent, CONFIRM_CREDENTIAL); }
                    catch (ActivityNotFoundException error) { reportBiometric(false); }
                }
            }});
        }

        @JavascriptInterface
        public void setSecureScreen(boolean secure) {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (secure) getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
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
    }

    private SecretKey vaultKey(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        KeyStore.Entry entry = store.getEntry(VAULT_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        if (!create) return null;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(VAULT_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true);
        if (Build.VERSION.SDK_INT >= 28 && getPackageManager().hasSystemFeature("android.hardware.strongbox_keystore")) {
            try {
                spec.setIsStrongBoxBacked(true);
                generator.init(spec.build());
                return generator.generateKey();
            } catch (Exception strongBoxUnavailable) {
                spec.setIsStrongBoxBacked(false);
            }
        }
        generator.init(spec.build());
        return generator.generateKey();
    }

    private BiometricPrompt.AuthenticationCallback biometricCallback() {
        return new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) { reportBiometric(true); }
            @Override public void onAuthenticationError(int code, CharSequence message) { reportBiometric(false); }
        };
    }

    private void reportBiometric(boolean ok) {
        runOnUiThread(new Runnable() { @Override public void run() {
            if (webView != null) webView.evaluateJavascript("window.Libo && window.Libo.onBiometric(" + ok + ")", null);
        }});
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == CONFIRM_CREDENTIAL) { reportBiometric(result == RESULT_OK); return; }
        if (request == PICK_PHOTO && photoCallback != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            photoCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
            photoCallback = null;
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
        if (webView != null) webView.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }
    @Override protected void onDestroy() {
        if (photoCallback != null) { photoCallback.onReceiveValue(null); photoCallback = null; }
        pendingExport = null;
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
