package dev.mind.android

import java.net.URLDecoder

/** What a scanned pairing code carries: where the server is, and the code to claim. */
data class PairingScan(val baseUrl: String, val code: String)

/**
 * The payload the editor's Devices panel puts in its QR code:
 *
 *     mind://pair?server=http%3A%2F%2F192.168.1.20%3A8787&code=123456
 *
 * The address is percent-encoded because it carries slashes and colons of its
 * own. Parsing is pure and side-effect free, so the format is pinned by JVM
 * tests rather than by pointing a camera at a screen.
 */
object PairingQr {
    const val PREFIX = "mind://pair"

    private val SIX_DIGITS = Regex("^\\d{6}$")

    fun parse(text: String): PairingScan? {
        val trimmed = text.trim()
        if (!trimmed.startsWith(PREFIX)) return null

        val query = trimmed.substring(PREFIX.length)
        if (!query.startsWith("?")) return null

        val params = query.substring(1)
            .split("&")
            .mapNotNull { part ->
                val separator = part.indexOf('=')
                if (separator <= 0) null
                else decode(part.substring(0, separator)) to decode(part.substring(separator + 1))
            }
            .toMap()

        val server = params["server"]?.trim()?.trimEnd('/') ?: return null
        val code = params["code"]?.trim() ?: return null
        if (!server.startsWith("http://") && !server.startsWith("https://")) return null
        if (!SIX_DIGITS.matches(code)) return null
        return PairingScan(server, code)
    }

    private fun decode(value: String): String = URLDecoder.decode(value, "UTF-8")
}
