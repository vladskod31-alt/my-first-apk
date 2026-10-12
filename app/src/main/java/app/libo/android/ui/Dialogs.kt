package app.libo.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.libo.android.data.AppState
import app.libo.android.data.Chat
import app.libo.android.data.ChatKind
import app.libo.android.data.Contact
import app.libo.android.data.Profile

@Composable
fun CreateContactDialog(language: String, onDismiss: () -> Unit, onCreate: (String, String, String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "newContact")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text(tr(language, "name")) }, singleLine = true)
                OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text(tr(language, "username")) }, singleLine = true)
                OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text(tr(language, "phone")) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
            }
        },
        confirmButton = { Button(onClick = { onCreate(name, username, phone) }, enabled = name.isNotBlank()) { Text(tr(language, "create")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun CreateGroupOrChannelDialog(
    language: String,
    kind: ChatKind,
    onDismiss: () -> Unit,
    onCreate: (String, String) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var details by rememberSaveable { mutableStateOf("") }
    val title = if (kind == ChatKind.GROUP) tr(language, "newGroup") else tr(language, "newChannel")
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text(tr(language, "name")) }, singleLine = true)
                OutlinedTextField(
                    value = details,
                    onValueChange = { details = it },
                    label = { Text(if (kind == ChatKind.GROUP) tr(language, "newGroupHint") else tr(language, "channelAboutHint")) },
                    minLines = 2,
                    maxLines = 3,
                )
            }
        },
        confirmButton = { Button(onClick = { onCreate(name, details) }, enabled = name.isNotBlank()) { Text(tr(language, "create")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun ContactPickerDialog(language: String, contacts: List<Contact>, onDismiss: () -> Unit, onSelect: (Contact) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val results = contacts.filter { query.isBlank() || it.name.contains(query, true) || it.username.contains(query, true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "chooseContact")) },
        text = {
            Column {
                OutlinedTextField(value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(tr(language, "search")) }, leadingIcon = { Icon(Icons.Filled.Search, null) })
                LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(results, key = { it.id }) { contact ->
                        Row(modifier = Modifier.fillMaxWidth().clickable { onSelect(contact) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            DialogAvatar(contact.name)
                            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                                Text(contact.name, fontWeight = FontWeight.Medium)
                                Text(contact.username.ifBlank { contact.phone }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (results.isEmpty()) item { Text(tr(language, "noResults"), modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun ProfileEditorDialog(profile: Profile, language: String, onDismiss: () -> Unit, onSave: (Profile) -> Unit) {
    var name by remember(profile) { mutableStateOf(profile.name) }
    var username by remember(profile) { mutableStateOf(profile.username) }
    var about by remember(profile) { mutableStateOf(profile.about) }
    var wallpaper by remember(profile) { mutableStateOf(profile.wallpaper) }
    val wallpapers = listOf("violet", "dark", "midnight", "ocean", "rose", "sunset", "blue", "mono")
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "profileEdit")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text(tr(language, "name")) }, singleLine = true)
                OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text(tr(language, "username")) }, singleLine = true)
                OutlinedTextField(value = about, onValueChange = { about = it }, label = { Text(tr(language, "about")) }, minLines = 2, maxLines = 3)
                Text(tr(language, "wallpaper"), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    wallpapers.forEach { id ->
                        Box(
                            modifier = Modifier.size(24.dp).background(Brush.linearGradient(wallpaperColors(id)), CircleShape)
                                .clickable { wallpaper = id },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (wallpaper == id) Box(Modifier.size(8.dp).background(Color.White, CircleShape))
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                val cleanUsername = username.trim().replace(Regex("\\s+"), "_").let { if (it.isNotBlank() && !it.startsWith('@')) "@$it" else it }
                onSave(Profile(name = name.trim().ifBlank { "LIBO user" }, username = cleanUsername.ifBlank { "@username" }, about = about.trim(), wallpaper = wallpaper))
            }, enabled = name.isNotBlank()) { Text(tr(language, "save")) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun ContactCodeDialog(code: String, language: String, onDismiss: () -> Unit, onCopy: () -> Unit, onShare: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "contactCode")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(tr(language, "contactCodeHint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                    SelectionContainer { Text(code, modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall) }
                }
            }
        },
        confirmButton = { Button(onClick = onShare) { Text(tr(language, "share")) } },
        dismissButton = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onCopy) { Text(tr(language, "copy")) }
                TextButton(onClick = onDismiss) { Text(tr(language, "close")) }
            }
        },
    )
}

@Composable
fun ImportContactCodeDialog(language: String, onDismiss: () -> Unit, onImport: (String) -> Unit) {
    var code by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "addByCode")) },
        text = { OutlinedTextField(value = code, onValueChange = { code = it }, modifier = Modifier.fillMaxWidth(), label = { Text(tr(language, "importCode")) }, minLines = 2, maxLines = 4) },
        confirmButton = { Button(onClick = { onImport(code) }, enabled = code.isNotBlank()) { Text(tr(language, "add")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun TextInputDialog(title: String, hint: String, language: String, onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var value by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(value = value, onValueChange = { value = it }, modifier = Modifier.fillMaxWidth(), label = { Text(hint) }, singleLine = true) },
        confirmButton = { Button(onClick = { onSubmit(value) }, enabled = value.isNotBlank()) { Text(tr(language, "add")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun PasswordSetupDialog(
    language: String,
    hasExistingPassword: Boolean,
    onDismiss: () -> Unit,
    onSave: (currentPassword: String, newPassword: String, confirmation: String) -> Unit,
    onRemove: (currentPassword: String) -> Unit,
) {
    var current by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var confirmation by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "passwordLock")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (hasExistingPassword) OutlinedTextField(value = current, onValueChange = { current = it; error = "" }, modifier = Modifier.fillMaxWidth(), label = { Text(tr(language, "currentPassword")) }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                OutlinedTextField(value = password, onValueChange = { password = it; error = "" }, modifier = Modifier.fillMaxWidth(), label = { Text(tr(language, "newPassword")) }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                OutlinedTextField(value = confirmation, onValueChange = { confirmation = it; error = "" }, modifier = Modifier.fillMaxWidth(), label = { Text(tr(language, "confirmPassword")) }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                Text("Пароль не зберігається у відкритому вигляді.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            Button(onClick = {
                when {
                    password.length < 8 -> error = tr(language, "passwordShort")
                    password != confirmation -> error = tr(language, "passwordMismatch")
                    else -> onSave(current, password, confirmation)
                }
            }) { Text(tr(language, "save")) }
        },
        dismissButton = {
            Row {
                if (hasExistingPassword) TextButton(onClick = { onRemove(current) }) { Text("Вимкнути") }
                TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) }
            }
        },
    )
}

@Composable
fun BackupPasswordDialog(language: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var password by rememberSaveable { mutableStateOf("") }
    var confirm by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "backup")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(tr(language, "backupPassword"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(value = password, onValueChange = { password = it; error = "" }, modifier = Modifier.fillMaxWidth(), label = { Text(tr(language, "password")) }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                OutlinedTextField(value = confirm, onValueChange = { confirm = it; error = "" }, modifier = Modifier.fillMaxWidth(), label = { Text(tr(language, "confirmPassword")) }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            Button(onClick = {
                when {
                    password.length < 8 -> error = tr(language, "passwordShort")
                    password != confirm -> error = tr(language, "passwordMismatch")
                    else -> onConfirm(password)
                }
            }) { Text(tr(language, "continue")) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun RestorePasswordDialog(language: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var password by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "restore")) },
        text = { OutlinedTextField(value = password, onValueChange = { password = it }, modifier = Modifier.fillMaxWidth(), label = { Text(tr(language, "password")) }, singleLine = true, visualTransformation = PasswordVisualTransformation()) },
        confirmButton = { Button(onClick = { onConfirm(password) }, enabled = password.isNotBlank()) { Text(tr(language, "continue")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun SearchDialog(
    state: AppState,
    onDismiss: () -> Unit,
    onOpenChat: (Chat) -> Unit,
    onOpenContact: (Contact) -> Unit,
) {
    val language = state.settings.language
    var query by rememberSaveable { mutableStateOf("") }
    val chats = state.chats.filter { query.isBlank() || it.name.contains(query, true) || it.preview.contains(query, true) }
    val contacts = state.contacts.filter { query.isBlank() || it.name.contains(query, true) || it.username.contains(query, true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "search")) },
        text = {
            Column {
                OutlinedTextField(value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(tr(language, "searchHint")) }, leadingIcon = { Icon(Icons.Filled.Search, null) })
                LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 440.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (chats.isNotEmpty()) item { Text(tr(language, "chats"), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 6.dp, bottom = 2.dp)) }
                    items(chats, key = { "chat-${it.id}" }) { chat -> SearchResultRow(chat.name, chat.preview, isChat = true) { onOpenChat(chat) } }
                    if (contacts.isNotEmpty()) item { Text(tr(language, "contacts"), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 6.dp, bottom = 2.dp)) }
                    items(contacts, key = { "contact-${it.id}" }) { contact -> SearchResultRow(contact.name, contact.username.ifBlank { contact.phone }, isChat = false) { onOpenContact(contact) } }
                    if (chats.isEmpty() && contacts.isEmpty()) item { Text(tr(language, "noResults"), modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(tr(language, "close")) } },
    )
}

@Composable
private fun SearchResultRow(title: String, subtitle: String, isChat: Boolean, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (isChat) Icons.Filled.Chat else Icons.Filled.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Text(title, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun ConfirmDialog(title: String, message: String, language: String, confirmLabel: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { Button(onClick = onConfirm) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
private fun DialogAvatar(name: String) {
    Box(modifier = Modifier.size(38.dp).background(Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFF42329B))), CircleShape), contentAlignment = Alignment.Center) {
        Text(name.firstOrNull()?.uppercase() ?: "L", color = Color.White, fontWeight = FontWeight.Bold)
    }
}
