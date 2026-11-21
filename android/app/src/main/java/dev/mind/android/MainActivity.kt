package dev.mind.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = TokenStore(this)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MindApp(store)
                }
            }
        }
    }
}

@Composable
private fun MindApp(store: TokenStore) {
    var session by remember { mutableStateOf(store.session()) }

    val current = session
    if (current == null) {
        PairScreen(
            onPaired = { paired ->
                store.save(paired)
                session = paired
            },
        )
    } else {
        QueueScreen(
            store = store,
            session = current,
            onUnpaired = {
                store.clear()
                session = null
            },
        )
    }
}

@Composable
private fun PairScreen(onPaired: (Session) -> Unit) {
    var baseUrl by remember { mutableStateOf("http://192.168.1.20:8787") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Pair this phone", style = MaterialTheme.typography.headlineSmall)
        Text(
            "In VS Code open mind → Devices → Show pairing code, then enter the six digits here. " +
                "The phone gets its own token, with the permissions chosen there.",
            style = MaterialTheme.typography.bodySmall,
        )

        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = { Text("Server address") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = code,
            onValueChange = { entered -> code = entered.filter { it.isDigit() }.take(6) },
            label = { Text("Six-digit code") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Button(
            enabled = !busy && code.length == 6 && baseUrl.isNotBlank(),
            onClick = {
                busy = true
                error = null
                val normalized = baseUrl.trim().trimEnd('/')
                scope.launch {
                    try {
                        val result = Minds.pair(normalized, code)
                        onPaired(Session(normalized, result.token, result.scopes, result.name))
                    } catch (e: Exception) {
                        error = e.message ?: "Pairing failed"
                    } finally {
                        busy = false
                    }
                }
            },
        ) {
            Text(if (busy) "Pairing…" else "Pair")
        }

        Text(
            "Cleartext HTTP is only permitted to private addresses. If this phone is not on " +
                "the same private network as the server, use a VPN or an HTTPS tunnel.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QueueScreen(store: TokenStore, session: Session, onUnpaired: () -> Unit) {
    val client = remember(session.baseUrl, session.token) { MindClient(session.baseUrl, session.token) }
    var queue by remember { mutableStateOf<List<QueueItem>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var staleAt by remember { mutableStateOf<Long?>(null) }
    var busy by remember { mutableStateOf(false) }
    var showCapture by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun load() {
        scope.launch {
            busy = true
            try {
                val json = client.queueJson()
                store.cacheQueue(json)
                queue = MindClient.parseQueue(json)
                staleAt = null
                error = null
            } catch (e: Exception) {
                val cached = store.cachedQueue()
                if (cached != null) {
                    queue = MindClient.parseQueue(cached.first)
                    staleAt = cached.second
                }
                error = e.message ?: "Could not reach the server"
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Queue") },
                actions = {
                    TextButton(onClick = { load() }, enabled = !busy) {
                        Text(if (busy) "…" else "Refresh")
                    }
                    TextButton(onClick = { showCapture = true }) { Text("Capture") }
                    TextButton(onClick = { onUnpaired() }) { Text("Unpair") }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            val stale = staleAt
            if (stale != null) {
                Text(
                    "Offline — showing the queue cached " +
                        DateFormat.getDateTimeInstance().format(Date(stale)),
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            } else {
                error?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            }

            if (queue.isEmpty()) {
                Text(
                    if (busy) "Loading…" else "Nothing is waiting.",
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(queue, key = { it.id }) { item ->
                        QueueCard(
                            item = item,
                            canCapture = session.scopes.contains("capture"),
                            canSend = session.scopes.contains("send"),
                            onDone = { load() },
                            onAcknowledge = {
                                scope.launch {
                                    try {
                                        client.acknowledge(item.signalId)
                                        load()
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            },
                            onApprove = {
                                item.actionId?.let { actionId ->
                                    scope.launch {
                                        try {
                                            client.approve(actionId)
                                            load()
                                        } catch (e: Exception) {
                                            error = e.message
                                        }
                                    }
                                }
                            },
                            onDiscard = {
                                item.actionId?.let { actionId ->
                                    scope.launch {
                                        try {
                                            client.discard(actionId)
                                            load()
                                        } catch (e: Exception) {
                                            error = e.message
                                        }
                                    }
                                }
                            },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }

    if (showCapture) {
        CaptureDialog(
            onDismiss = { showCapture = false },
            onSave = { title, body ->
                showCapture = false
                scope.launch {
                    try {
                        client.capture(title, body)
                        load()
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            },
        )
    }
}

@Composable
private fun QueueCard(
    item: QueueItem,
    canCapture: Boolean,
    canSend: Boolean,
    onDone: () -> Unit,
    onAcknowledge: () -> Unit,
    onApprove: () -> Unit,
    onDiscard: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(item.sender.ifBlank { "mind" }, style = MaterialTheme.typography.titleSmall)
            Text(item.summary, style = MaterialTheme.typography.bodyMedium)
            item.draftPreview?.let {
                Text("Draft: $it", style = MaterialTheme.typography.bodySmall)
            }
            if (item.bucket.isNotBlank()) {
                Text(item.bucket, style = MaterialTheme.typography.labelSmall)
            }

            val actionId = item.actionId
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canSend && item.type == "reply" && actionId != null) {
                    TextButton(onClick = onApprove) { Text("Approve") }
                    TextButton(onClick = onDiscard) { Text("Discard") }
                }
                if (canCapture && item.type == "attention") {
                    TextButton(onClick = onAcknowledge) { Text("Acknowledge") }
                }
                TextButton(onClick = onDone) { Text("Reload") }
            }
        }
    }
}

@Composable
private fun CaptureDialog(onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Capture a thought") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("Body (optional)") },
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = title.isNotBlank(),
                onClick = { onSave(title.trim(), body) },
            ) { Text("Capture") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
