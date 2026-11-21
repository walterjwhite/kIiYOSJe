package dev.mind.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** The pieces of a queue item this client shows. The server owns the rest. */
data class QueueItem(
    val id: String,
    val type: String,
    val actionId: String?,
    val signalId: String,
    val sender: String,
    val summary: String,
    val draftPreview: String?,
    val bucket: String,
)

data class PairResult(val token: String, val name: String, val scopes: Set<String>)

class MindException(val status: Int, message: String) : Exception(message)

/**
 * The paired client's HTTP surface: what a phone actually does.
 *
 * `read` covers the queue, `capture` covers a thought and acknowledging a
 * signal, and `send` is needed to approve or discard a draft. The server
 * enforces those scopes; this class just uses the token it was given.
 */
class MindClient(private val baseUrl: String, private val token: String) {

    suspend fun queueJson(): String = request("GET", "/queue")

    suspend fun capture(title: String, body: String) {
        val payload = JSONObject()
            .put("title", title)
            .put("body", body)
            .put("directionId", JSONObject.NULL)
            .toString()
        request("POST", "/thoughts", payload)
    }

    suspend fun acknowledge(signalId: String) {
        request("PUT", "/signals/${encode(signalId)}/reviewed")
    }

    suspend fun approve(actionId: String) {
        request("POST", "/actions/${encode(actionId)}/send")
    }

    suspend fun discard(actionId: String) {
        request("POST", "/actions/${encode(actionId)}/discard")
    }

    private suspend fun request(method: String, path: String, body: String? = null): String =
        withContext(Dispatchers.IO) {
            val connection = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10_000
                readTimeout = 20_000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            try {
                if (body != null) {
                    connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
                if (status !in 200..299) {
                    throw MindException(status, "mind API $status: ${text.take(300)}")
                }
                text
            } finally {
                connection.disconnect()
            }
        }

    companion object {
        fun parseQueue(json: String): List<QueueItem> {
            val array = JSONArray(json)
            val items = ArrayList<QueueItem>(array.length())
            for (index in 0 until array.length()) {
                val item = array.getJSONObject(index)
                val timing = item.optJSONObject("timing")
                items.add(
                    QueueItem(
                        id = item.getString("id"),
                        type = item.optString("type", "attention"),
                        actionId = optionalString(item, "actionId"),
                        signalId = item.getString("signalId"),
                        sender = item.optString("sender", ""),
                        summary = item.optString("summary", ""),
                        draftPreview = optionalString(item, "draftPreview"),
                        bucket = timing?.optString("bucket", "") ?: "",
                    ),
                )
            }
            return items
        }

        private fun optionalString(item: JSONObject, key: String): String? {
            if (item.isNull(key)) return null
            val value = item.optString(key, "")
            return value.ifEmpty { null }
        }

        private fun encode(segment: String): String =
            java.net.URLEncoder.encode(segment, "UTF-8")
    }
}

/** Pairing is the only call that does not have a token yet. */
object Minds {
    suspend fun pair(baseUrl: String, code: String): PairResult =
        withContext(Dispatchers.IO) {
            val connection = (URL("$baseUrl/devices/pair").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 20_000
                doOutput = true
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Content-Type", "application/json")
            }
            try {
                // The name was chosen in the editor next to the permissions;
                // sending one here would silently rename the device.
                val payload = JSONObject().put("code", code).toString()
                connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }

                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
                if (status !in 200..299) throw MindException(status, errorMessage(text))

                parsePair(text)
            } finally {
                connection.disconnect()
            }
        }

    /** The pairing response: the device's own token, the name the editor chose, and its scopes. */
    fun parsePair(json: String): PairResult {
        val body = JSONObject(json)
        val scopes = body.optJSONArray("scopes")?.let { array ->
            (0 until array.length())
                .map { index -> array.optString(index) }
                .filter { value -> value.isNotEmpty() }
                .toSet()
        } ?: emptySet()
        return PairResult(
            token = body.getString("token"),
            name = body.optString("name", "My Android phone"),
            scopes = scopes,
        )
    }

    private fun errorMessage(text: String): String =
        try {
            JSONObject(text).optString("error", text.take(300))
        } catch (_: Exception) {
            text.take(300)
        }
}
