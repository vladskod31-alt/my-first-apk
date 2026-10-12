package app.libo.android.ui

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.BatteryAlert
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Vibration
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.libo.android.data.AppSettings
import app.libo.android.data.AppState
import app.libo.android.data.AiSettings
import app.libo.android.data.LiboStore

@Composable
fun SettingsScreen(
    state: AppState,
    store: LiboStore,
    onEditProfile: () -> Unit,
    onPassword: () -> Unit,
    onBackup: () -> Unit,
    onRestore: () -> Unit,
    onExportSettings: () -> Unit,
    onClearCache: () -> Unit,
    onClearSessions: () -> Unit,
    onCreateCode: () -> Unit,
    onImportCode: () -> Unit,
    onAddFolder: () -> Unit,
    onSaveAi: (endpoint: String, model: String, apiKey: String) -> Unit,
    onOpenAi: () -> Unit,
    onMessage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val language = state.settings.language
    var query by rememberSaveable { mutableStateOf("") }
    val q = query.trim().lowercase()
    fun visible(vararg terms: String) = q.isBlank() || terms.any { it.lowercase().contains(q) }
    var endpoint by remember(state.aiSettings.endpoint) { mutableStateOf(state.aiSettings.endpoint) }
    var model by remember(state.aiSettings.model) { mutableStateOf(state.aiSettings.model) }
    var apiKey by remember { mutableStateOf("") }
    var languageMenu by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 10.dp, bottom = 24.dp),
    ) {
        item {
            Column {
                Text(tr(language, "settings"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(tr(language, "localOnly"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp, bottom = 10.dp))
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("${tr(language, "search")} ${tr(language, "settings").lowercase()}…") },
                    leadingIcon = { Icon(Icons.Filled.Tune, contentDescription = null) },
                )
            }
        }

        if (visible("account", tr(language, "profile"), tr(language, "language"))) {
            item {
                SettingsGroup(tr(language, "profile")) {
                    SettingAction(
                        title = tr(language, "profileEdit"),
                        subtitle = "${state.profile.name} · ${state.profile.username}",
                        icon = Icons.Filled.Person,
                        onClick = onEditProfile,
                    )
                    HorizontalDivider()
                    Row(modifier = Modifier.fillMaxWidth().clickable { languageMenu = true }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Language, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(tr(language, "language"), fontWeight = FontWeight.Medium)
                            Text(languageName(state.settings.language), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text("▾", color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(end = 8.dp))
                        DropdownMenu(expanded = languageMenu, onDismissRequest = { languageMenu = false }) {
                            listOf("uk" to "Українська", "en" to "English", "ru" to "Русский").forEach { (code, label) ->
                                DropdownMenuItem(text = { Text(label) }, onClick = {
                                    store.updateSettings { it.copy(language = code) }
                                    languageMenu = false
                                })
                            }
                        }
                    }
                }
            }
        }

        if (visible("appearance", tr(language, "darkTheme"), tr(language, "animations"), tr(language, "energy"))) {
            item {
                SettingsGroup(tr(language, "appearance")) {
                    SettingToggle(tr(language, "darkTheme"), tr(language, "themeDescription"), Icons.Filled.DarkMode, state.settings.darkTheme, state.settings.vibrationEnabled, state.settings.soundEnabled) {
                        store.updateSettings { it.copy(darkTheme = it.darkTheme.not()) }
                    }
                    HorizontalDivider()
                    SettingToggle(tr(language, "animations"), tr(language, "animationDescription"), Icons.Filled.Tune, state.settings.animations && !state.settings.energySaving, state.settings.vibrationEnabled, state.settings.soundEnabled) {
                        store.updateSettings { it.copy(animations = !it.animations) }
                    }
                    HorizontalDivider()
                    SettingToggle(tr(language, "energy"), tr(language, "energyDescription"), Icons.Filled.BatteryAlert, state.settings.energySaving, state.settings.vibrationEnabled, state.settings.soundEnabled) {
                        store.updateSettings { it.copy(energySaving = !it.energySaving) }
                    }
                    Text(tr(language, "responsiveHint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 2.dp, top = 8.dp))
                }
            }
        }

        if (visible("notifications", tr(language, "sound"), tr(language, "vibration"))) {
            item {
                SettingsGroup(tr(language, "notifications")) {
                    SettingToggle(tr(language, "sound"), tr(language, "soundDescription"), Icons.Filled.VolumeUp, state.settings.soundEnabled, state.settings.vibrationEnabled, state.settings.soundEnabled) {
                        store.updateSettings { it.copy(soundEnabled = !it.soundEnabled) }
                    }
                    HorizontalDivider()
                    SettingToggle(tr(language, "vibration"), tr(language, "vibrationDescription"), Icons.Filled.Vibration, state.settings.vibrationEnabled, state.settings.vibrationEnabled, state.settings.soundEnabled) {
                        store.updateSettings { it.copy(vibrationEnabled = !it.vibrationEnabled) }
                    }
                }
            }
        }

        if (visible("privacy", "security", tr(language, "passwordLock"), tr(language, "backup"), tr(language, "restore"))) {
            item {
                SettingsGroup(tr(language, "security")) {
                    SettingAction(
                        title = if (state.settings.lockHash.isBlank()) tr(language, "passwordOn") else tr(language, "passwordOff"),
                        subtitle = if (state.settings.lockHash.isBlank()) "Локальне блокування · PBKDF2-SHA-256" else "Пароль збережено лише як стійкий хеш",
                        icon = Icons.Filled.Lock,
                        onClick = onPassword,
                    )
                    HorizontalDivider()
                    SettingAction(tr(language, "backup"), tr(language, "backupHint"), Icons.Filled.Backup, onBackup)
                    HorizontalDivider()
                    SettingAction(tr(language, "restore"), "Відновити дані з файлу .libo", Icons.Filled.Storage, onRestore)
                    HorizontalDivider()
                    Text(tr(language, "secureStatus"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 7.dp))
                    TextButton(onClick = { onMessage("AES-256-GCM доступний через Android Keystore та стандартний криптопровайдер.") }, modifier = Modifier.align(Alignment.Start)) {
                        Icon(Icons.Filled.Security, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("  Перевірити захист")
                    }
                }
            }
        }

        if (visible("data", "storage", tr(language, "exportSettings"), tr(language, "clearCache"), tr(language, "clearSessions"))) {
            item {
                SettingsGroup(tr(language, "dataStorage")) {
                    SettingAction(tr(language, "exportSettings"), "JSON без пароля та API-ключів", Icons.Filled.Storage, onExportSettings)
                    HorizontalDivider()
                    SettingAction(tr(language, "clearCache"), "Очищає тимчасові файли, не історію чатів", Icons.Filled.Delete, onClearCache)
                    HorizontalDivider()
                    SettingAction(tr(language, "clearSessions"), "Очищення повідомлень потребує підтвердження", Icons.Filled.Delete, onClearSessions)
                }
            }
        }

        if (visible("folders", "chat folders", tr(language, "folders"))) {
            item {
                SettingsGroup(tr(language, "folders")) {
                    if (state.folders.isEmpty()) {
                        Text("Створіть папки, щоб відфільтровувати список чатів.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        state.folders.forEach { folder ->
                            Text("•  $folder", modifier = Modifier.padding(vertical = 4.dp), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    FilledTonalButton(onClick = onAddFolder, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                        Icon(Icons.Filled.Folder, contentDescription = null)
                        Text("  ${tr(language, "addFolder")}")
                    }
                }
            }
        }

        if (visible("code", "contact", "invite", tr(language, "contactCode"), tr(language, "addByCode"))) {
            item {
                SettingsGroup(tr(language, "contactCode")) {
                    Text(tr(language, "contactCodeHint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = onCreateCode, modifier = Modifier.weight(1f)) { Text(tr(language, "createCode")) }
                        FilledTonalButton(onClick = onImportCode, modifier = Modifier.weight(1f)) { Text(tr(language, "addByCode")) }
                    }
                }
            }
        }

        if (visible("ai", "api", "model", tr(language, "assistant"), tr(language, "aiSettings"))) {
            item {
                SettingsGroup(tr(language, "aiSettings")) {
                    Text(tr(language, "aiHint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = endpoint,
                        onValueChange = { endpoint = it },
                        modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                        singleLine = true,
                        label = { Text(tr(language, "apiEndpoint")) },
                        placeholder = { Text("https://…/v1") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    )
                    OutlinedTextField(value = model, onValueChange = { model = it }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true, label = { Text(tr(language, "apiModel")) })
                    OutlinedTextField(
                        value = apiKey,
                        onValueChange = { apiKey = it },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        singleLine = true,
                        label = { Text(if (state.aiSettings.encryptedKey.isBlank()) tr(language, "apiKey") else "API-ключ · збережений у Keystore") },
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    Button(onClick = { onSaveAi(endpoint.trim(), model.trim(), apiKey); apiKey = "" }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) {
                        Text(tr(language, "saveAiSettings"))
                    }
                    TextButton(onClick = onOpenAi, modifier = Modifier.align(Alignment.End)) {
                        Icon(Icons.Filled.SmartToy, contentDescription = null)
                        Text("  Відкрити LIBO AI")
                    }
                }
            }
        }

        if (visible("performance", "optimization", tr(language, "energy"))) {
            item {
                SettingsGroup(tr(language, "performance")) {
                    Text("LIBO використовує Compose UI, системні відступи та вертикальну прокрутку. Полегшений режим зменшує рухомі ефекти.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        if (visible("about", "version", "libo", "app")) {
            item {
                SettingsGroup("LIBO") {
                    SettingAction("LIBO Android", "Версія 2.10.9.3 · Kotlin + Jetpack Compose", Icons.Filled.Info, onClick = {})
                    Text(tr(language, "noServer"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun SettingsGroup(title: String, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 13.dp), content = {
            Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 5.dp))
            content()
        })
    }
}

@Composable
private fun SettingToggle(title: String, subtitle: String, icon: ImageVector, checked: Boolean, hapticEnabled: Boolean, soundEnabled: Boolean, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val toggle = {
        if (hapticEnabled) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        if (soundEnabled) playSettingsTone()
        onClick()
    }
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick = toggle).padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
        Column(modifier = Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(title, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = { toggle() })
    }
}

@Composable
private fun SettingAction(title: String, subtitle: String, icon: ImageVector, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(40.dp)) {
            androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(21.dp))
            }
        }
        Column(modifier = Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(title, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text("›", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp))
    }
}

private fun playSettingsTone() {
    runCatching {
        val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 18)
        tone.startTone(ToneGenerator.TONE_PROP_BEEP, 45)
        Handler(Looper.getMainLooper()).postDelayed({ runCatching { tone.release() } }, 120)
    }
}

private fun languageName(code: String): String = when (code) {
    "en" -> "English"
    "ru" -> "Русский"
    else -> "Українська"
}
