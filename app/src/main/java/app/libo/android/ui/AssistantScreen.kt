package app.libo.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.libo.android.data.AppState
import app.libo.android.data.AssistantMessage
import app.libo.android.data.LiboStore
import app.libo.android.security.AiApiClient
import app.libo.android.security.SecurityTools
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun AssistantScreen(
    state: AppState,
    store: LiboStore,
    onOpenSettings: () -> Unit,
    onMessage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val language = state.settings.language
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var input by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    val configured = state.aiSettings.endpoint.isNotBlank() && state.aiSettings.model.isNotBlank() && state.aiSettings.encryptedKey.isNotBlank()

    val submit: () -> Unit = {
        val prompt = input.trim()
        if (prompt.isNotBlank() && !isLoading) {
            if (!configured) {
                onOpenSettings()
            } else {
                input = ""
                isLoading = true
                val userMessage = AssistantMessage(text = prompt, fromUser = true)
                val history = state.assistantMessages + userMessage
                store.addAssistantMessage(userMessage)
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            val key = SecurityTools.decryptApiKey(state.aiSettings.keyIv, state.aiSettings.encryptedKey)
                            AiApiClient.request(state.aiSettings.endpoint, state.aiSettings.model, key, history)
                        }
                    }.onSuccess { answer ->
                        store.addAssistantMessage(AssistantMessage(text = answer, fromUser = false))
                    }.onFailure { error ->
                        store.addAssistantMessage(AssistantMessage(text = "${tr(language, "aiError")}: ${error.message ?: "API error"}", fromUser = false))
                        onMessage(tr(language, "aiError"))
                    }
                    isLoading = false
                }
            }
        }
    }

    LaunchedEffect(state.assistantMessages.size, isLoading) {
        if (state.assistantMessages.isNotEmpty()) listState.animateScrollToItem(state.assistantMessages.lastIndex)
    }

    Column(modifier = modifier.fillMaxSize()) {
        if (!configured) {
            Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), shape = RoundedCornerShape(20.dp)) {
                Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.SmartToy, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                    Column(modifier = Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(tr(language, "assistantReady"), fontWeight = FontWeight.SemiBold)
                        Text(tr(language, "apiMissing"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                    }
                    TextButton(onClick = onOpenSettings) { Text(tr(language, "settings")) }
                }
            }
        }

        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            state = listState,
            verticalArrangement = Arrangement.spacedBy(9.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        ) {
            items(state.assistantMessages, key = { it.id }) { message ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = if (message.fromUser) Arrangement.End else Arrangement.Start) {
                    Surface(
                        shape = RoundedCornerShape(18.dp),
                        color = if (message.fromUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                        modifier = Modifier.fillMaxWidth(.88f),
                    ) {
                        Text(message.text, modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp), style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
            if (isLoading) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 4.dp, top = 4.dp)) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text("  LIBO AI…", modifier = Modifier.padding(start = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text(tr(language, "sendAiHint")) },
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { submit() }),
                shape = RoundedCornerShape(22.dp),
            )
            Button(
                onClick = submit,
                enabled = input.isNotBlank() && !isLoading,
                shape = CircleShape,
                modifier = Modifier.size(52.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            ) {
                Icon(Icons.Filled.Send, contentDescription = tr(language, "send"))
            }
        }
        Text(
            tr(language, "aiHint"),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        )
    }
}
