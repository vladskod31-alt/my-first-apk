package app.libo.android.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.libo.android.data.AssistantMessage
import app.libo.android.data.Contact
import app.libo.android.data.Profile
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object SecurityTools {
    private const val PASSWORD_ITERATIONS = 600_000
    private const val AES_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val KEY_ALIAS = "libo_ai_api_key_v1"

    data class PasswordCredentials(val salt: String, val hash: String)

    fun createPasswordCredentials(password: String): PasswordCredentials {
        val salt = ByteArray(16).also(SecureRandom()::nextBytes)
        val hash = derivePasswordKey(password, salt)
        return PasswordCredentials(encode(salt), encode(hash))
    }

    fun verifyPassword(password: String, salt: String, expectedHash: String): Boolean {
        return try {
            val saltBytes = decode(salt)
            val expected = decode(expectedHash)
            MessageDigest.isEqual(expected, derivePasswordKey(password, saltBytes))
        } catch (_: Exception) {
            false
        }
    }

    fun encryptBackup(json: String, password: String): ByteArray {
        val salt = ByteArray(16).also(SecureRandom()::nextBytes)
        val iv = ByteArray(12).also(SecureRandom()::nextBytes)
        val key = deriveAesKey(password, salt)
        val cipher = Cipher.getInstance(AES_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val encrypted = cipher.doFinal(json.toByteArray(Charsets.UTF_8))
        return JSONObject()
            .put("format", "LIBO_ENCRYPTED_BACKUP")
            .put("version", "2.10.9.3")
            .put("algorithm", "AES-256-GCM")
            .put("kdf", "PBKDF2WithHmacSHA256")
            .put("iterations", PASSWORD_ITERATIONS)
            .put("salt", encode(salt))
            .put("iv", encode(iv))
            .put("ciphertext", encode(encrypted))
            .toString(2)
            .toByteArray(Charsets.UTF_8)
    }

    fun decryptBackup(bytes: ByteArray, password: String): String {
        require(bytes.size <= 32 * 1024 * 1024) { "Backup is too large." }
        val envelope = JSONObject(bytes.toString(Charsets.UTF_8))
        require(envelope.optString("format") == "LIBO_ENCRYPTED_BACKUP") { "This is not a LIBO backup." }
        require(envelope.optString("algorithm") == "AES-256-GCM") { "Unsupported backup encryption." }
        val iterations = envelope.optInt("iterations", PASSWORD_ITERATIONS)
        require(iterations in 100_000..1_000_000) { "Unsupported key derivation settings." }
        val salt = decode(envelope.getString("salt"))
        val iv = decode(envelope.getString("iv"))
        val encrypted = decode(envelope.getString("ciphertext"))
        val key = deriveAesKey(password, salt, iterations)
        val cipher = Cipher.getInstance(AES_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        return cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }

    private fun derivePasswordKey(password: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(password.toCharArray(), salt, PASSWORD_ITERATIONS, 256)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private fun deriveAesKey(password: String, salt: ByteArray, iterations: Int = PASSWORD_ITERATIONS): SecretKey {
        val spec = PBEKeySpec(password.toCharArray(), salt, iterations, 256)
        return try {
            val raw = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            SecretKeySpec(raw, "AES")
        } finally {
            spec.clearPassword()
        }
    }

    private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    fun encryptApiKey(value: String): Pair<String, String> {
        if (value.isBlank()) return "" to ""
        val cipher = Cipher.getInstance(AES_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKeystoreKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return encode(cipher.iv) to encode(encrypted)
    }

    fun decryptApiKey(iv: String, encryptedValue: String): String {
        if (iv.isBlank() || encryptedValue.isBlank()) return ""
        val cipher = Cipher.getInstance(AES_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKeystoreKey(), GCMParameterSpec(128, decode(iv)))
        return cipher.doFinal(decode(encryptedValue)).toString(Charsets.UTF_8)
    }

    private fun getOrCreateKeystoreKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    fun makeContactCode(profile: Profile): String {
        val payload = JSONObject()
            .put("version", 1)
            .put("name", profile.name.trim().ifBlank { "LIBO user" })
            .put("username", profile.username.trim())
            .put("about", profile.about.trim())
            .toString()
            .toByteArray(Charsets.UTF_8)
        return "LIBO1:" + Base64.encodeToString(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    fun parseContactCode(code: String): Contact? {
        return try {
            val normalized = code.trim()
            require(normalized.startsWith("LIBO1:"))
            require(normalized.length <= 4096)
            val raw = Base64.decode(
                normalized.removePrefix("LIBO1:"),
                Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
            )
            val json = JSONObject(raw.toString(Charsets.UTF_8))
            require(json.optInt("version") == 1)
            val name = json.optString("name").trim()
            require(name.isNotBlank())
            Contact(
                id = "invite-${java.util.UUID.randomUUID()}",
                name = name,
                username = json.optString("username").trim(),
                about = json.optString("about").trim(),
            )
        } catch (_: Exception) {
            null
        }
    }
}

object AiApiClient {
    fun request(
        endpoint: String,
        model: String,
        apiKey: String,
        history: List<AssistantMessage>,
    ): String {
        require(endpoint.isNotBlank()) { "API URL is missing." }
        require(model.isNotBlank()) { "Model is missing." }
        require(apiKey.isNotBlank()) { "API key is missing." }
        val base = endpoint.trim().trimEnd('/')
        val urlText = if (base.endsWith("/chat/completions")) base else "$base/chat/completions"
        val url = URL(urlText)
        require(url.protocol.equals("https", ignoreCase = true)) { "Use an HTTPS endpoint." }

        val messages = JSONArray().apply {
            put(JSONObject().put("role", "system").put("content", "You are LIBO AI, a concise and helpful assistant."))
            history.takeLast(20).forEach { message ->
                put(
                    JSONObject()
                        .put("role", if (message.fromUser) "user" else "assistant")
                        .put("content", message.text),
                )
            }
        }
        val body = JSONObject().put("model", model).put("messages", messages).toString().toByteArray(Charsets.UTF_8)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 60_000
            doOutput = true
            setRequestProperty("Authorization", "Bearer $apiKey")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
        }
        return try {
            connection.outputStream.use { it.write(body) }
            val code = connection.responseCode
            val response = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)
                ?.use { it.readText() }
                .orEmpty()
            if (code !in 200..299) {
                val message = runCatching { JSONObject(response).optJSONObject("error")?.optString("message") }.getOrNull()
                throw IllegalStateException(message?.takeIf { it.isNotBlank() } ?: "AI API returned HTTP $code.")
            }
            val content = JSONObject(response)
                .optJSONArray("choices")
                ?.optJSONObject(0)
                ?.optJSONObject("message")
                ?.opt("content")
            when (content) {
                is String -> content.trim()
                is JSONArray -> buildString {
                    for (index in 0 until content.length()) {
                        val part = content.optJSONObject(index)?.optString("text")
                        if (!part.isNullOrBlank()) append(part)
                    }
                }.trim()
                else -> ""
            }.ifBlank { "The AI provider returned an empty response." }
        } finally {
            connection.disconnect()
        }
    }
}
