package dev.mind.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The server owns the queue; this client only reads it. These tests pin the
 * fields the phone shows and the defaults it applies when the payload is
 * thinner than expected, so a server change is caught here rather than on a
 * phone. All payloads are synthetic.
 */
class MindClientTest {

    @Test
    fun `reads a reply item with its draft and bucket`() {
        val items = MindClient.parseQueue(
            """
            [
              {
                "id": "action:7",
                "type": "reply",
                "actionId": "7",
                "signalId": "sig-9",
                "sender": "ada@example.test",
                "summary": "Can you review the release notes?",
                "draftPreview": "Yes, today.",
                "timing": { "bucket": "now" }
              }
            ]
            """.trimIndent(),
        )

        assertEquals(1, items.size)
        val item = items.single()
        assertEquals("action:7", item.id)
        assertEquals("reply", item.type)
        assertEquals("7", item.actionId)
        assertEquals("sig-9", item.signalId)
        assertEquals("ada@example.test", item.sender)
        assertEquals("Can you review the release notes?", item.summary)
        assertEquals("Yes, today.", item.draftPreview)
        assertEquals("now", item.bucket)
    }

    @Test
    fun `falls back when optional fields are missing or null`() {
        val item = MindClient.parseQueue(
            """
            [
              {
                "id": "signal:3",
                "signalId": "sig-3",
                "actionId": null,
                "draftPreview": null,
                "timing": null
              }
            ]
            """.trimIndent(),
        ).single()

        assertEquals("attention", item.type)
        assertNull(item.actionId)
        assertNull(item.draftPreview)
        assertEquals("", item.sender)
        assertEquals("", item.summary)
        assertEquals("", item.bucket)
    }

    @Test
    fun `an empty queue is an empty list`() {
        assertTrue(MindClient.parseQueue("[]").isEmpty())
    }

    @Test
    fun `keeps the order the server sent`() {
        val items = MindClient.parseQueue(
            """
            [
              { "id": "a1", "type": "reply", "signalId": "s1" },
              { "id": "s2", "type": "attention", "signalId": "s2" },
              { "id": "a3", "type": "reply", "signalId": "s3" }
            ]
            """.trimIndent(),
        )

        assertEquals(listOf("a1", "s2", "a3"), items.map { it.id })
    }

    @Test
    fun `reads a pairing response`() {
        val paired = Minds.parsePair(
            """{ "token": "t0ken", "name": "Pixel", "scopes": ["read", "capture"] }""",
        )

        assertEquals("t0ken", paired.token)
        assertEquals("Pixel", paired.name)
        assertEquals(setOf("read", "capture"), paired.scopes)
    }

    @Test
    fun `pairing defaults the name and tolerates missing scopes`() {
        val paired = Minds.parsePair("""{ "token": "t0ken", "scopes": ["read", "", "send"] }""")

        assertEquals("My Android phone", paired.name)
        assertEquals(setOf("read", "send"), paired.scopes)
    }

    @Test
    fun `pairing without scopes grants none`() {
        assertTrue(Minds.parsePair("""{ "token": "t0ken" }""").scopes.isEmpty())
    }
}
