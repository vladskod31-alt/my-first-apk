package app.libo.messenger;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Stores only the notification-scoped token, never message or vault decryption keys. */
final class BackgroundPreferences {
    private static final String ALIAS = "libo.background.notifications.v23";
    static SharedPreferences preferences(Context context) { return context.getSharedPreferences("libo_background_23", Context.MODE_PRIVATE); }
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(false).setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    static JSONObject load(Context context) {
        try {
            SharedPreferences prefs = preferences(context);
            String value = prefs.getString("ciphertext", null), iv = prefs.getString("iv", null);
            if (value == null || iv == null) return null;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            cipher.updateAAD("LIBO-NOTIFICATION-CONFIG-2.3".getBytes(StandardCharsets.UTF_8));
            return new JSONObject(new String(cipher.doFinal(Base64.decode(value, Base64.NO_WRAP)), StandardCharsets.UTF_8));
        } catch (Exception ignored) { return null; }
    }
    static void save(Context context, JSONObject config) throws Exception {
        if (!config.optBoolean("enabled")) { clear(context); return; }
        String server = config.optString("server"), token = config.optString("token"), owner = config.optString("owner");
        URI uri = new URI(server);
        if (server.length() > 1024 || !"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !token.matches("[A-Za-z0-9_-]{43}") || !owner.matches("libo-[a-f0-9]{32}")) throw new IllegalArgumentException("Invalid notification configuration");
        JSONObject previous = load(context);
        boolean sameAccount = previous != null && server.equals(previous.optString("server")) && owner.equals(previous.optString("owner"));
        JSONObject clean = new JSONObject(); clean.put("enabled", true); clean.put("server", server); clean.put("token", token); clean.put("owner", owner);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD("LIBO-NOTIFICATION-CONFIG-2.3".getBytes(StandardCharsets.UTF_8));
        String encrypted = Base64.encodeToString(cipher.doFinal(clean.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        SharedPreferences.Editor editor = preferences(context).edit().putString("ciphertext", encrypted).putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        if (!sameAccount) editor.putLong("cursor", Math.max(0, config.optLong("cursor", 0))).putInt("unread", 0);
        if (!editor.commit()) throw new IllegalStateException("Storage failed");
    }
    static void clear(Context context) { preferences(context).edit().clear().commit(); }
}
