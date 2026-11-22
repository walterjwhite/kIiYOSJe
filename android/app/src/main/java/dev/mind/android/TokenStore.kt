package dev.mind.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class Session(
    val baseUrl: String,
    val token: String,
    val scopes: Set<String>,
    val deviceName: String,
)

/**
 * Local session storage.
 *
 * The device token is the only real secret this app holds, so it is encrypted
 * with an AES-256-GCM key that lives in the Android Keystore and never leaves
 * it. Everything else (server URL, granted scopes, the last queue snapshot) is
 * ordinary private storage. Clearing a session removes all of it; the server
 * side is revoked separately in the editor, which is what actually locks the
 * token out.
 */
class TokenStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("mind", Context.MODE_PRIVATE)

    fun session(): Session? {
        val baseUrl = prefs.getString("baseUrl", null) ?: return null
        val encoded = prefs.getString("token", null) ?: return null
        return try {
            Session(
                baseUrl = baseUrl,
                token = decrypt(encoded),
                scopes = scopes().toSet(),
                deviceName = prefs.getString("deviceName", "") ?: "",
            )
        } catch (_: Exception) {
            // A keystore reset (factory reset, app data restore) makes the old
            // ciphertext unreadable; treat that as "not paired" rather than
            // crashing on launch.
            null
        }
    }

    fun save(session: Session) {
        prefs.edit {
            putString("baseUrl", session.baseUrl)
            putString("token", encrypt(session.token))
            putString("scopes", session.scopes.joinToString(","))
            putString("deviceName", session.deviceName)
        }
    }

    fun scopes(): List<String> =
        prefs.getString("scopes", "")?.split(",")?.filter { it.isNotBlank() } ?: emptyList()

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun cacheQueue(json: String) {
        prefs.edit()
            .putString("queueJson", json)
            .putLong("queueAt", System.currentTimeMillis())
            .apply()
    }

    /** Last successful queue payload and when it was fetched, for honest offline display. */
    fun cachedQueue(): Pair<String, Long>? {
        val json = prefs.getString("queueJson", null) ?: return null
        val at = prefs.getLong("queueAt", 0L)
        return if (at > 0L) json to at else null
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(iv + body, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        require(bytes.size > GCM_IV_BYTES) { "stored token is truncated" }
        val iv = bytes.copyOfRange(0, GCM_IV_BYTES)
        val body = bytes.copyOfRange(GCM_IV_BYTES, bytes.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(body), Charsets.UTF_8)
    }

    private companion object {
        const val ALIAS = "mind.android.device-token"
        const val GCM_IV_BYTES = 12
    }
}
