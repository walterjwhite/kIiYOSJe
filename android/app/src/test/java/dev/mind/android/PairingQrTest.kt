package dev.mind.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The editor writes these payloads and the phone reads them, so the format is a
 * contract between two codebases. Every payload here is synthetic.
 */
class PairingQrTest {

    @Test
    fun `reads the payload the editor writes`() {
        val scanned = PairingQr.parse(
            "mind://pair?server=http%3A%2F%2F192.168.1.20%3A8787&code=042731",
        )

        assertEquals("http://192.168.1.20:8787", scanned?.baseUrl)
        assertEquals("042731", scanned?.code)
    }

    @Test
    fun `reads the loopback address used over USB`() {
        val scanned = PairingQr.parse(
            "mind://pair?server=http%3A%2F%2F127.0.0.1%3A8787&code=123456",
        )

        assertEquals("http://127.0.0.1:8787", scanned?.baseUrl)
        assertEquals("123456", scanned?.code)
    }

    @Test
    fun `reads https and ignores unknown parameters`() {
        val scanned = PairingQr.parse(
            "mind://pair?code=111222&server=https%3A%2F%2Fmind.example.test%3A443&name=Phone",
        )

        assertEquals("https://mind.example.test:443", scanned?.baseUrl)
        assertEquals("111222", scanned?.code)
    }

    @Test
    fun `drops a trailing slash from the server address`() {
        val scanned = PairingQr.parse(
            "mind://pair?server=http%3A%2F%2F10.0.0.5%3A8787%2F&code=999999",
        )

        assertEquals("http://10.0.0.5:8787", scanned?.baseUrl)
    }

    @Test
    fun `tolerates surrounding whitespace`() {
        val scanned = PairingQr.parse(
            "  mind://pair?server=http%3A%2F%2F10.0.0.5%3A8787&code=000001\n",
        )

        assertEquals("000001", scanned?.code)
    }

    @Test
    fun `rejects a bare six-digit code`() {
        assertNull(PairingQr.parse("123456"))
        assertNull(PairingQr.parse("123 456"))
    }

    @Test
    fun `rejects a payload without the scheme`() {
        assertNull(PairingQr.parse("http://10.0.0.5:8787/?code=123456"))
    }

    @Test
    fun `rejects a missing or malformed code`() {
        assertNull(PairingQr.parse("mind://pair?server=http%3A%2F%2F10.0.0.5%3A8787"))
        assertNull(PairingQr.parse("mind://pair?server=http%3A%2F%2F10.0.0.5%3A8787&code=12345"))
        assertNull(PairingQr.parse("mind://pair?server=http%3A%2F%2F10.0.0.5%3A8787&code=1234567"))
        assertNull(PairingQr.parse("mind://pair?server=http%3A%2F%2F10.0.0.5%3A8787&code=12a456"))
    }

    @Test
    fun `rejects a missing or non-web server address`() {
        assertNull(PairingQr.parse("mind://pair?code=123456"))
        assertNull(PairingQr.parse("mind://pair?server=10.0.0.5%3A8787&code=123456"))
        assertNull(PairingQr.parse("mind://pair?server=ftp%3A%2F%2F10.0.0.5&code=123456"))
    }

    @Test
    fun `rejects a different scheme and an empty query`() {
        assertNull(PairingQr.parse("mind://other?server=http%3A%2F%2F10.0.0.5&code=123456"))
        assertNull(PairingQr.parse("mind://pair"))
        assertNull(PairingQr.parse(""))
    }
}
