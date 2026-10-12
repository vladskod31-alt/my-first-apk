package app.libo.android.ui

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Reply
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import android.Manifest
import android.content.pm.PackageManager
import app.libo.android.data.AppState
import app.libo.android.data.Attachment
import app.libo.android.data.Chat
import app.libo.android.data.ChatKind
import app.libo.android.data.ChatMessage
import app.libo.android.data.Contact
import app.libo.android.data.LiboStore
import app.libo.android.data.Profile
import app.libo.android.data.SavedMessage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val purpleGradient = listOf(Color(0xFF7B5CFF), Color(0xFF4C36B8))

@Composable
fun ChatListScreen(
    state: AppState,
    store: LiboStore,
    onOpenChat: (Chat) -> Unit,
    modifier: Modifier = Modifier,
) {
    val language = state.settings.language
    var selectedFolder by rememberSaveable { mutableStateOf(ALL_FOLDER) }
    val folders = listOf(ALL_FOLDER) + state.folders
    val chats = state.chats
        .filter { selectedFolder == ALL_FOLDER || it.folder == selectedFolder }
        .sortedWith(compareByDescending<Chat> { it.pinned }.thenByDescending { it.updatedAt })

    Column(modifier = modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(tr(language, "chats"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(tr(language, "localOnly"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            AssistChip(onClick = { selectedFolder = ALL_FOLDER }, label = { Text("${state.chats.size}") }, leadingIcon = {
                Icon(Icons.Filled.Folder, contentDescription = null, modifier = Modifier.size(16.dp))
            })
        }
        if (folders.size > 1) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 10.dp)) {
                items(folders, key = { it }) { folder ->
                    FilterChip(
                        selected = selectedFolder == folder,
                        onClick = { selectedFolder = folder },
                        label = { Text(if (folder == ALL_FOLDER) tr(language, "all") else folder) },
                    )
                }
            }
        }
        if (chats.isEmpty()) {
            EmptyState(
                title = tr(language, "emptyChats"),
                subtitle = tr(language, "noServer"),
                modifier = Modifier.weight(1f),
            )
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 2.dp, bottom = 24.dp),
            ) {
                items(chats, key = { it.id }) { chat ->
                    ChatListRow(
                        chat = chat,
                        folders = state.folders,
                        language = language,
                        onClick = { onOpenChat(chat) },
                        onPin = { store.setChatPinned(chat.id, !chat.pinned) },
                        onMove = { store.moveChat(chat.id, it) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatListRow(
    chat: Chat,
    folders: List<String>,
    language: String,
    onClick: () -> Unit,
    onPin: () -> Unit,
    onMove: (String?) -> Unit,
) {
    var menuExpanded by remember { mutableStateOf(false) }
    var folderMenu by remember { mutableStateOf(false) }
    Card(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChatAvatar(chat.name, chat.kind, size = 52.dp)
            Column(modifier = Modifier.weight(1f).padding(start = 12.dp, end = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(chat.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                    if (chat.pinned) Icon(Icons.Filled.PushPin, contentDescription = tr(language, "pin"), modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                }
                Text(
                    text = chat.preview.ifBlank { tr(language, "typeMessage") },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 3.dp),
                )
                if (chat.folder != null) {
                    Text(chat.folder, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 4.dp))
                }
            }
            Box {
                IconButton(onClick = { menuExpanded = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = tr(language, "settings"), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false; folderMenu = false }) {
                    DropdownMenuItem(
                        text = { Text(if (chat.pinned) tr(language, "unpin") else tr(language, "pin")) },
                        leadingIcon = { Icon(Icons.Filled.PushPin, contentDescription = null) },
                        onClick = { onPin(); menuExpanded = false },
                    )
                    DropdownMenuItem(
                        text = { Text(tr(language, "moveToFolder")) },
                        leadingIcon = { Icon(Icons.Filled.Folder, contentDescription = null) },
                        onClick = { folderMenu = true },
                    )
                    if (folderMenu) {
                        DropdownMenuItem(text = { Text(tr(language, "noFolder")) }, onClick = { onMove(null); menuExpanded = false; folderMenu = false })
                        folders.forEach { folder ->
                            DropdownMenuItem(text = { Text(folder) }, onClick = { onMove(folder); menuExpanded = false; folderMenu = false })
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ContactsScreen(
    state: AppState,
    onAddContact: () -> Unit,
    onCreateCode: () -> Unit,
    onImportCode: () -> Unit,
    onOpenChat: (Contact) -> Unit,
    modifier: Modifier = Modifier,
) {
    val language = state.settings.language
    var query by rememberSaveable { mutableStateOf("") }
    val contacts = state.contacts.filter {
        query.isBlank() || listOf(it.name, it.username, it.phone, it.about).any { text -> text.contains(query, ignoreCase = true) }
    }
    Column(modifier = modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(tr(language, "contacts"), modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            IconButton(onClick = onAddContact) { Icon(Icons.Filled.PersonAdd, contentDescription = tr(language, "newContact"), tint = MaterialTheme.colorScheme.primary) }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilledTonalButton(onClick = onCreateCode, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.ContentCopy, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(tr(language, "contactCode"), maxLines = 1)
            }
            FilledTonalButton(onClick = onImportCode, modifier = Modifier.weight(1f)) {
                Icon(Icons.Filled.Person, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(tr(language, "addByCode"), maxLines = 1)
            }
        }
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
            singleLine = true,
            placeholder = { Text(tr(language, "searchHint")) },
            leadingIcon = { Icon(Icons.Filled.Person, contentDescription = null) },
        )
        if (contacts.isEmpty()) {
            EmptyState(tr(language, "emptyContacts"), tr(language, "contactCodeHint"), Modifier.weight(1f))
        } else {
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
                items(contacts, key = { it.id }) { contact ->
                    ContactRow(contact = contact, language = language, onClick = { onOpenChat(contact) })
                }
            }
        }
    }
}

@Composable
private fun ContactRow(contact: Contact, language: String, onClick: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick), shape = RoundedCornerShape(18.dp)) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            ChatAvatar(contact.name, ChatKind.DIRECT, size = 48.dp)
            Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
                Text(contact.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(contact.username.ifBlank { contact.phone.ifBlank { contact.about.ifBlank { tr(language, "noDescription") } } }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Filled.MoreHoriz, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun ConversationScreen(
    chat: Chat,
    state: AppState,
    store: LiboStore,
    draft: String,
    onDraftChange: (String) -> Unit,
    onSaveDraft: () -> Unit,
    modifier: Modifier = Modifier,
    embeddedHeader: Boolean = false,
    onBack: (() -> Unit)? = null,
    onMessage: (String) -> Unit,
) {
    val language = state.settings.language
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val messages = state.messages[chat.id].orEmpty()
    val listState = rememberLazyListState()
    var replyToId by rememberSaveable(chat.id) { mutableStateOf<String?>(null) }
    var selectedMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var editingMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var forwardMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var recording by rememberSaveable(chat.id) { mutableStateOf(false) }
    val recorder = remember(context) { VoiceNoteRecorder(context) }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    DisposableEffect(chat.id) {
        onDispose { recorder.stopAndDiscard() }
    }

    val openDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            val attachment = runCatching { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            val name = queryDisplayName(context, uri)
            val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
            store.sendMessage(chat.id, "", Attachment(displayName = name, mimeType = mime, contentUri = uri.toString()), replyToId)
            performInputFeedback(state.settings.soundEnabled, state.settings.vibrationEnabled, haptics)
            replyToId = null
            if (attachment.isFailure) Unit
        }
    }
    val startRecording = {
        runCatching { recorder.start() }
            .onSuccess { recording = true }
            .onFailure { onMessage("Не вдалося почати запис: ${it.message ?: "перевірте дозвіл на мікрофон"}") }
    }
    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecording() else onMessage("Для голосового повідомлення потрібен доступ до мікрофона.")
    }

    Column(modifier = modifier.fillMaxSize()) {
        if (embeddedHeader) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.Filled.Close, contentDescription = tr(language, "back")) }
                ChatAvatar(chat.name, chat.kind, 42.dp)
                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                    Text(chat.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(tr(language, "localChat"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = onSaveDraft) { Icon(Icons.Filled.BookmarkBorder, contentDescription = tr(language, "saveMessage")) }
            }
            HorizontalDivider()
        }

        if (messages.isEmpty()) {
            EmptyState(tr(language, "typeMessage"), tr(language, "localChat"), Modifier.weight(1f))
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 14.dp),
            ) {
                items(messages, key = { it.id }) { message ->
                    MessageBubble(
                        message = message,
                        replyMessage = messages.firstOrNull { it.id == message.replyToId },
                        language = language,
                        onLongClick = { selectedMessage = message },
                        onAttachmentClick = { message.attachment?.let { openAttachment(context, it) } },
                    )
                }
            }
        }

        val reply = messages.firstOrNull { it.id == replyToId }
        if (reply != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(start = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f).padding(vertical = 7.dp)) {
                    Text(tr(language, "reply"), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall)
                    Text(reply.text.ifBlank { reply.attachment?.displayName.orEmpty() }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = { replyToId = null }) { Icon(Icons.Filled.Close, contentDescription = tr(language, "close"), modifier = Modifier.size(18.dp)) }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            IconButton(onClick = { openDocument.launch(arrayOf("*/*")) }) {
                Icon(Icons.Filled.AttachFile, contentDescription = tr(language, "attach"), tint = MaterialTheme.colorScheme.primary)
            }
            OutlinedTextField(
                value = draft,
                onValueChange = onDraftChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text(if (recording) tr(language, "recording") else tr(language, "messageHint")) },
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = {
                    if (draft.isNotBlank()) {
                        store.sendMessage(chat.id, draft, replyToId = replyToId)
                        performInputFeedback(state.settings.soundEnabled, state.settings.vibrationEnabled, haptics)
                        onDraftChange("")
                        replyToId = null
                    }
                }),
                shape = RoundedCornerShape(22.dp),
            )
            if (draft.isBlank() || recording) {
                IconButton(onClick = {
                    if (recording) {
                        val file = recorder.stop()
                        recording = false
                        if (file != null) {
                            store.sendMessage(chat.id, "", Attachment(file.name, "audio/mp4", localPath = file.absolutePath), replyToId)
                            performInputFeedback(state.settings.soundEnabled, state.settings.vibrationEnabled, haptics)
                            replyToId = null
                        } else onMessage("Запис закороткий або не вдалося зберегти аудіо.")
                    } else {
                        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                        if (granted) startRecording() else microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }) {
                    Icon(if (recording) Icons.Filled.Close else Icons.Filled.Mic, contentDescription = tr(language, "voice"), tint = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                }
            } else {
                IconButton(onClick = {
                    store.sendMessage(chat.id, draft, replyToId = replyToId)
                    performInputFeedback(state.settings.soundEnabled, state.settings.vibrationEnabled, haptics)
                    onDraftChange("")
                    replyToId = null
                }) { Icon(Icons.Filled.Send, contentDescription = tr(language, "send"), tint = MaterialTheme.colorScheme.primary) }
            }
        }
    }

    selectedMessage?.let { message ->
        MessageActionsDialog(
            message = message,
            language = language,
            onDismiss = { selectedMessage = null },
            onReply = { replyToId = message.id; selectedMessage = null },
            onSave = { store.saveMessage(message, chat.name); selectedMessage = null; onMessage(tr(language, "messageSaved")) },
            onPin = { store.toggleMessagePin(chat.id, message.id); selectedMessage = null },
            onEdit = { editingMessage = message; selectedMessage = null },
            onDelete = { store.deleteMessage(chat.id, message.id); selectedMessage = null },
            onCopy = {
                val text = message.text.ifBlank { message.attachment?.displayName.orEmpty() }
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("LIBO", text))
                selectedMessage = null
                onMessage(tr(language, "copy"))
            },
            onForward = { forwardMessage = message; selectedMessage = null },
        )
    }
    editingMessage?.let { message ->
        EditMessageDialog(
            message = message,
            language = language,
            onDismiss = { editingMessage = null },
            onSave = { text -> store.editMessage(chat.id, message.id, text); editingMessage = null },
        )
    }
    forwardMessage?.let { message ->
        ForwardMessageDialog(
            chats = state.chats.filterNot { it.id == chat.id },
            message = message,
            language = language,
            onDismiss = { forwardMessage = null },
            onForward = { targetId ->
                store.sendMessage(targetId, message.text, message.attachment)
                forwardMessage = null
                onMessage(tr(language, "forward"))
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageBubble(
    message: ChatMessage,
    replyMessage: ChatMessage?,
    language: String,
    onLongClick: () -> Unit,
    onAttachmentClick: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = if (message.isMine) Arrangement.End else Arrangement.Start) {
        Surface(
            color = if (message.isMine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
            contentColor = if (message.isMine) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = if (message.isMine) 5.dp else 18.dp, bottomStart = if (message.isMine) 18.dp else 5.dp),
            modifier = Modifier.fillMaxWidth(0.86f).combinedClickable(onClick = onAttachmentClick, onLongClick = onLongClick),
        ) {
            Column(Modifier.padding(horizontal = 13.dp, vertical = 9.dp)) {
                if (replyMessage != null) {
                    Text(
                        text = "↳ ${replyMessage.text.ifBlank { replyMessage.attachment?.displayName.orEmpty() }}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(bottom = 5.dp),
                    )
                }
                if (message.attachment != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = if (message.text.isBlank()) 0.dp else 5.dp)) {
                        Icon(
                            if (message.attachment.mimeType.startsWith("audio/")) Icons.Filled.VolumeUp else Icons.Filled.AttachFile,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Text(message.attachment.displayName, modifier = Modifier.padding(start = 7.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (message.text.isNotBlank()) Text(message.text, style = MaterialTheme.typography.bodyLarge)
                Row(modifier = Modifier.align(Alignment.End).padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (message.pinned) Icon(Icons.Filled.PushPin, contentDescription = tr(language, "pin"), modifier = Modifier.size(12.dp).padding(end = 2.dp))
                    if (message.edited) Text("${tr(language, "edit")} · ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(formatMessageTime(message.sentAt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (message.isMine) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(13.dp).padding(start = 2.dp), tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

@Composable
private fun MessageActionsDialog(
    message: ChatMessage,
    language: String,
    onDismiss: () -> Unit,
    onReply: () -> Unit,
    onSave: () -> Unit,
    onPin: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onCopy: () -> Unit,
    onForward: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(message.text.ifBlank { message.attachment?.displayName.orEmpty() }.ifBlank { tr(language, "saved") }, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                DialogAction(tr(language, "reply"), Icons.Filled.Reply, onReply)
                DialogAction(tr(language, "saveMessage"), Icons.Filled.BookmarkBorder, onSave)
                DialogAction(if (message.pinned) tr(language, "unpin") else tr(language, "pin"), Icons.Filled.PushPin, onPin)
                DialogAction(tr(language, "forward"), Icons.Filled.Send, onForward)
                DialogAction(tr(language, "copy"), Icons.Filled.ContentCopy, onCopy)
                if (message.isMine && message.text.isNotBlank()) DialogAction(tr(language, "edit"), Icons.Filled.Edit, onEdit)
                if (message.isMine) DialogAction(tr(language, "delete"), Icons.Filled.Delete, onDelete, danger = true)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(tr(language, "close")) } },
    )
}

@Composable
private fun DialogAction(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit, danger: Boolean = false) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Icon(icon, contentDescription = null, tint = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        Text(label, modifier = Modifier.weight(1f).padding(start = 12.dp), color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun EditMessageDialog(message: ChatMessage, language: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var value by remember(message.id) { mutableStateOf(message.text) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "editMessage")) },
        text = { OutlinedTextField(value = value, onValueChange = { value = it }, modifier = Modifier.fillMaxWidth(), minLines = 2) },
        confirmButton = { Button(onClick = { onSave(value.trim()) }, enabled = value.isNotBlank()) { Text(tr(language, "save")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
private fun ForwardMessageDialog(
    chats: List<Chat>,
    message: ChatMessage,
    language: String,
    onDismiss: () -> Unit,
    onForward: (String) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr(language, "forward")) },
        text = {
            if (chats.isEmpty()) Text(tr(language, "emptyChats")) else Column {
                chats.take(8).forEach { chat ->
                    TextButton(onClick = { onForward(chat.id) }, modifier = Modifier.fillMaxWidth()) {
                        ChatAvatar(chat.name, chat.kind, 34.dp)
                        Text(chat.name, modifier = Modifier.weight(1f).padding(start = 10.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(tr(language, "cancel")) } },
    )
}

@Composable
fun ProfileScreen(profile: Profile, language: String, onEdit: () -> Unit, modifier: Modifier = Modifier) {
    val colors = wallpaperColors(profile.wallpaper)
    Column(modifier = modifier.fillMaxSize().padding(horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(12.dp))
        Card(modifier = Modifier.fillMaxWidth().animateContentSize(), shape = RoundedCornerShape(28.dp)) {
            Column(
                modifier = Modifier.fillMaxWidth().background(Brush.linearGradient(colors)).padding(horizontal = 24.dp, vertical = 30.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.size(92.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.18f))) {
                    Text(profile.name.firstOrNull()?.uppercase() ?: "L", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, color = Color.White)
                }
                Text(profile.name.ifBlank { "LIBO user" }, style = MaterialTheme.typography.headlineSmall, color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                Text(profile.username.ifBlank { "@username" }, style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = .78f))
            }
        }
        Card(modifier = Modifier.fillMaxWidth().padding(top = 14.dp), shape = RoundedCornerShape(20.dp)) {
            Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ProfileDetail(tr(language, "username"), profile.username)
                HorizontalDivider()
                ProfileDetail(tr(language, "about"), profile.about.ifBlank { tr(language, "noDescription") })
            }
        }
        Button(onClick = onEdit, modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
            Icon(Icons.Filled.Edit, contentDescription = null)
            Text(tr(language, "profileEdit"), modifier = Modifier.padding(start = 8.dp))
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun ProfileDetail(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
fun SavedScreen(state: AppState, onClear: () -> Unit, modifier: Modifier = Modifier) {
    val language = state.settings.language
    Column(modifier = modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(tr(language, "saved"), modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (state.savedMessages.isNotEmpty()) TextButton(onClick = onClear) { Icon(Icons.Filled.Delete, contentDescription = null); Text(tr(language, "delete")) }
        }
        if (state.savedMessages.isEmpty()) EmptyState(tr(language, "emptySaved"), tr(language, "saveMessage"), Modifier.weight(1f))
        else LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
            items(state.savedMessages, key = { it.id }) { saved ->
                Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(15.dp)) {
                        Text(saved.text, style = MaterialTheme.typography.bodyLarge)
                        Text("${saved.chatName} · ${formatMessageTime(saved.savedAt)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
        }
    }
}

@Composable
fun EmptyState(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(64.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(Icons.Filled.Groups, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(30.dp)) }
        }
        Text(title, modifier = Modifier.padding(top = 16.dp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(subtitle, modifier = Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun ChatAvatar(name: String, kind: ChatKind, size: androidx.compose.ui.unit.Dp) {
    val colors = when (kind) {
        ChatKind.GROUP -> listOf(Color(0xFF4964D8), Color(0xFF754BE8))
        ChatKind.CHANNEL -> listOf(Color(0xFF008C97), Color(0xFF485ED7))
        ChatKind.DIRECT -> purpleGradient
    }
    Box(modifier = Modifier.size(size).clip(CircleShape).background(Brush.linearGradient(colors)), contentAlignment = Alignment.Center) {
        when (kind) {
            ChatKind.GROUP -> Icon(Icons.Filled.Groups, contentDescription = null, tint = Color.White, modifier = Modifier.size(size * .46f))
            ChatKind.CHANNEL -> Icon(Icons.Filled.Campaign, contentDescription = null, tint = Color.White, modifier = Modifier.size(size * .44f))
            ChatKind.DIRECT -> Text(name.firstOrNull()?.uppercase() ?: "L", color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun AttachmentLabel(attachment: Attachment, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick).padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (attachment.mimeType.startsWith("audio/")) Icons.Filled.VolumeUp else Icons.Filled.AttachFile, contentDescription = null, modifier = Modifier.size(18.dp))
        Text(attachment.displayName, modifier = Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

private fun openAttachment(context: Context, attachment: Attachment) {
    if (attachment.mimeType.startsWith("audio/") && !attachment.localPath.isNullOrBlank()) {
        runCatching {
            val player = MediaPlayer()
            player.setDataSource(attachment.localPath)
            player.setOnCompletionListener { it.release() }
            player.prepare()
            player.start()
        }
        return
    }
    runCatching {
        val uri = attachment.contentUri?.let(Uri::parse)
            ?: attachment.localPath?.let { Uri.parse("file://$it") }
            ?: return
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, attachment.mimeType)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(intent)
    }
}

private fun queryDisplayName(context: Context, uri: Uri): String {
    return runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) else null
        }
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "attachment"
}

private fun performInputFeedback(
    soundEnabled: Boolean,
    vibrationEnabled: Boolean,
    haptics: androidx.compose.ui.hapticfeedback.HapticFeedback,
) {
    if (vibrationEnabled) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    if (soundEnabled) runCatching {
        val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 18)
        tone.startTone(ToneGenerator.TONE_PROP_ACK, 50)
        Handler(Looper.getMainLooper()).postDelayed({ runCatching { tone.release() } }, 150)
    }
}

private fun formatMessageTime(timestamp: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timestamp))

private const val ALL_FOLDER = "__all__"

fun wallpaperColors(id: String): List<Color> = when (id) {
    "midnight" -> listOf(Color(0xFF09090B), Color(0xFF27272A))
    "ocean" -> listOf(Color(0xFF003B46), Color(0xFF07575B), Color(0xFF00A6A6))
    "rose" -> listOf(Color(0xFF4C1D3D), Color(0xFFB83280))
    "sunset" -> listOf(Color(0xFF431407), Color(0xFF9A3412), Color(0xFFDB2777))
    "blue" -> listOf(Color(0xFF0B1F44), Color(0xFF164E8A), Color(0xFF2563EB))
    "mono" -> listOf(Color(0xFF171717), Color(0xFF404040), Color(0xFF737373))
    "dark" -> listOf(Color(0xFF0F0C29), Color(0xFF302B63), Color(0xFF24243E))
    else -> listOf(Color(0xFF5222B8), Color(0xFF8856F6), Color(0xFF3320A0))
}
