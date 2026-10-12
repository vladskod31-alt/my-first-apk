package app.libo.android.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.weight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import app.libo.android.R
import app.libo.android.data.AiSettings
import app.libo.android.data.Chat
import app.libo.android.data.ChatKind
import app.libo.android.data.ChatMessage
import app.libo.android.data.Contact
import app.libo.android.data.LiboStore
import app.libo.android.security.SecurityTools
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class Destination(val id: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val destinations = listOf(
    Destination("chats", "chats", Icons.Filled.Chat),
    Destination("contacts", "contacts", Icons.Filled.Person),
    Destination("settings", "settings", Icons.Filled.Settings),
    Destination("profile", "profile", Icons.Filled.Person),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiboApp(store: LiboStore) {
    val state = store.state
    val language = state.settings.language
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val snackbarHost = remember { SnackbarHostState() }
    var unlocked by remember { mutableStateOf(!store.hasPasswordProtection) }
    var route by rememberSaveable { mutableStateOf("main") }
    var activeTab by rememberSaveable { mutableStateOf("chats") }
    var selectedChatId by rememberSaveable { mutableStateOf<String?>(null) }
    var composerDraft by rememberSaveable(selectedChatId) { mutableStateOf("") }
    var activeDialog by rememberSaveable { mutableStateOf("") }
    var menuExpanded by remember { mutableStateOf(false) }
    var pendingBackupPassword by remember { mutableStateOf("") }
    var pendingRestoreUri by remember { mutableStateOf<Uri?>(null) }
    val showMessage: (String) -> Unit = { message -> scope.launch { snackbarHost.showSnackbar(message) } }

    SideEffect {
        val activity = view.context as? Activity
        if (activity != null && !view.isInEditMode) {
            activity.window.statusBarColor = android.graphics.Color.TRANSPARENT
            activity.window.navigationBarColor = android.graphics.Color.TRANSPARENT
            val bars = WindowCompat.getInsetsController(activity.window, view)
            bars.isAppearanceLightStatusBars = !state.settings.darkTheme
            bars.isAppearanceLightNavigationBars = !state.settings.darkTheme
        }
    }

    val backupLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val password = pendingBackupPassword
        pendingBackupPassword = ""
        if (uri != null && password.isNotBlank()) {
            val json = store.exportBackupJson()
            scope.launch {
                runCatching {
                    val bytes = withContext(Dispatchers.Default) { SecurityTools.encryptBackup(json, password) }
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                            ?: error("Could not open the backup file for writing.")
                    }
                }.onSuccess { showMessage("Зашифрований backup створено.") }
                    .onFailure { showMessage("Помилка backup: ${it.message ?: "unknown error"}") }
            }
        }
    }
    val settingsExportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) {
            val json = store.exportSettingsJson()
            scope.launch {
                runCatching {
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { it.write(json.toByteArray(Charsets.UTF_8)) }
                            ?: error("Could not open the settings file for writing.")
                    }
                }.onSuccess { showMessage(tr(language, "settingsSaved")) }
                    .onFailure { showMessage("Не вдалося експортувати налаштування.") }
            }
        }
    }
    val restoreLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            pendingRestoreUri = uri
            activeDialog = "restorePassword"
        }
    }

    if (!unlocked) {
        LockScreen(
            language = language,
            verifyPassword = { password ->
                withContext(Dispatchers.Default) {
                    SecurityTools.verifyPassword(password, state.settings.lockSalt, state.settings.lockHash)
                }
            },
            onUnlocked = { unlocked = true },
        )
        return
    }

    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        val compact = maxWidth < 360.dp
        val selectedChat = state.chats.firstOrNull { it.id == selectedChatId }
        val isConversation = route == "main" && activeTab == "chats" && selectedChat != null
        val showBottomNavigation = route == "main" && selectedChat == null && !wide
        val showFab = route == "main" && selectedChat == null && activeTab in setOf("chats", "contacts")
        val screenKey = "$route|$activeTab|${selectedChatId.orEmpty()}"

        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbarHost) },
            topBar = {
                when (route) {
                    "saved" -> TopAppBar(
                        title = { Text(tr(language, "saved"), fontWeight = FontWeight.SemiBold) },
                        navigationIcon = { IconButton(onClick = { route = "main" }) { Icon(Icons.Filled.ArrowBack, contentDescription = tr(language, "back")) } },
                    )
                    "assistant" -> TopAppBar(
                        title = { Text(tr(language, "assistant"), fontWeight = FontWeight.SemiBold) },
                        navigationIcon = { IconButton(onClick = { route = "main" }) { Icon(Icons.Filled.ArrowBack, contentDescription = tr(language, "back")) } },
                    )
                    else -> if (isConversation && !wide) {
                        TopAppBar(
                            title = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    selectedChat?.let { ChatAvatar(it.name, it.kind, 38.dp) }
                                    Column(Modifier.padding(start = 10.dp)) {
                                        Text(selectedChat?.name.orEmpty(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
                                        Text(tr(language, "onlineStatus"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            },
                            navigationIcon = { IconButton(onClick = { selectedChatId = null; composerDraft = "" }) { Icon(Icons.Filled.ArrowBack, contentDescription = tr(language, "back")) } },
                            actions = {
                                IconButton(onClick = {
                                    if (composerDraft.isNotBlank() && selectedChat != null) {
                                        store.saveMessage(ChatMessage(text = composerDraft), selectedChat.name)
                                        composerDraft = ""
                                        showMessage(tr(language, "messageSaved"))
                                    } else showMessage("Напишіть повідомлення, щоб зберегти чернетку.")
                                }) { Icon(Icons.Filled.BookmarkBorder, contentDescription = tr(language, "saveMessage")) }
                            },
                        )
                    } else {
                        TopAppBar(
                            title = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Image(painterResource(R.drawable.ic_libo_mark), contentDescription = "LIBO", modifier = Modifier.size(if (compact) 28.dp else 34.dp))
                                    Column(Modifier.padding(start = 10.dp)) {
                                        Text("libo", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                                        if (!compact) Text(tr(language, activeTab), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            },
                            actions = {
                                IconButton(onClick = { route = "assistant"; selectedChatId = null }) {
                                    Icon(Icons.Filled.SmartToy, contentDescription = tr(language, "assistant"), tint = MaterialTheme.colorScheme.primary)
                                }
                                if (activeTab == "chats" || activeTab == "contacts") {
                                    IconButton(onClick = { activeDialog = "search" }) { Icon(Icons.Filled.Search, contentDescription = tr(language, "search")) }
                                }
                                Box {
                                    IconButton(onClick = { menuExpanded = true }) { Icon(Icons.Filled.MoreVert, contentDescription = tr(language, "settings")) }
                                    DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                                        DropdownMenuItem(text = { Text(tr(language, "newGroup")) }, leadingIcon = { Icon(Icons.Filled.Groups, null) }, onClick = { menuExpanded = false; activeDialog = "group" })
                                        DropdownMenuItem(text = { Text(tr(language, "saved")) }, leadingIcon = { Icon(Icons.Filled.BookmarkBorder, null) }, onClick = { menuExpanded = false; route = "saved" })
                                        DropdownMenuItem(text = { Text(tr(language, "createCode")) }, leadingIcon = { Icon(Icons.Filled.Person, null) }, onClick = { menuExpanded = false; activeDialog = "contactCode" })
                                        DropdownMenuItem(text = { Text(tr(language, "addByCode")) }, leadingIcon = { Icon(Icons.Filled.PersonAdd, null) }, onClick = { menuExpanded = false; activeDialog = "importCode" })
                                    }
                                }
                            },
                        )
                    }
                }
            },
            bottomBar = {
                if (showBottomNavigation) {
                    NavigationBar {
                        destinations.forEach { destination ->
                            NavigationBarItem(
                                selected = activeTab == destination.id,
                                onClick = { route = "main"; selectedChatId = null; activeTab = destination.id },
                                icon = { Icon(destination.icon, contentDescription = tr(language, destination.label)) },
                                label = { Text(tr(language, destination.label)) },
                                alwaysShowLabel = true,
                            )
                        }
                    }
                }
            },
            floatingActionButton = {
                if (showFab) CreationFab(
                    language = language,
                    onNewContact = { activeDialog = "contact" },
                    onNewChat = { activeDialog = if (state.contacts.isEmpty()) "contact" else "contactPicker" },
                    onNewGroup = { activeDialog = "group" },
                    onNewChannel = { activeDialog = "channel" },
                )
            },
        ) { innerPadding ->
            Row(modifier = Modifier.fillMaxSize().padding(innerPadding).imePadding()) {
                if (wide && route == "main") {
                    NavigationRail(containerColor = MaterialTheme.colorScheme.background) {
                        Spacer(Modifier.size(8.dp))
                        destinations.forEach { destination ->
                            NavigationRailItem(
                                selected = activeTab == destination.id,
                                onClick = { selectedChatId = null; route = "main"; activeTab = destination.id },
                                icon = { Icon(destination.icon, contentDescription = tr(language, destination.label)) },
                                label = { Text(tr(language, destination.label)) },
                                alwaysShowLabel = true,
                            )
                        }
                    }
                }
                Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                    AnimatedContent(
                        targetState = screenKey,
                        transitionSpec = {
                            if (state.settings.animations && !state.settings.energySaving) {
                                (slideInHorizontally { it / 12 } + fadeIn()) togetherWith (slideOutHorizontally { -it / 12 } + fadeOut())
                            } else EnterTransition.None togetherWith ExitTransition.None
                        },
                        label = "libo-screen-transition",
                    ) {
                        when (route) {
                            "saved" -> CenteredPane { pane ->
                                SavedScreen(state, onClear = { store.clearSavedMessages(); showMessage("Збережені повідомлення очищено.") }, modifier = pane)
                            }
                            "assistant" -> CenteredPane { pane ->
                                AssistantScreen(
                                    state = state,
                                    store = store,
                                    onOpenSettings = { route = "main"; activeTab = "settings" },
                                    onMessage = showMessage,
                                    modifier = pane,
                                )
                            }
                            else -> if (wide && activeTab == "chats") {
                                Row(Modifier.fillMaxSize()) {
                                    val listWidth = (maxWidth - 84.dp).coerceAtMost(390.dp).coerceAtLeast(280.dp)
                                    ChatListScreen(
                                        state = state,
                                        store = store,
                                        onOpenChat = { selectedChatId = it.id; route = "main" },
                                        modifier = Modifier.width(listWidth).fillMaxHeight(),
                                    )
                                    androidx.compose.material3.VerticalDivider(modifier = Modifier.fillMaxHeight())
                                    Box(Modifier.weight(1f).fillMaxHeight()) {
                                        if (selectedChat != null) {
                                            ConversationScreen(
                                                chat = selectedChat,
                                                state = state,
                                                store = store,
                                                draft = composerDraft,
                                                onDraftChange = { composerDraft = it },
                                                onSaveDraft = {
                                                    if (composerDraft.isNotBlank()) {
                                                        store.saveMessage(ChatMessage(text = composerDraft), selectedChat.name)
                                                        composerDraft = ""
                                                        showMessage(tr(language, "messageSaved"))
                                                    }
                                                },
                                                embeddedHeader = true,
                                                onBack = { selectedChatId = null; composerDraft = "" },
                                                onMessage = showMessage,
                                            )
                                        } else EmptyState(tr(language, "chooseContact"), tr(language, "localChat"), Modifier.fillMaxSize())
                                    }
                                }
                            } else when (activeTab) {
                                "chats" -> if (selectedChat != null) {
                                    ConversationScreen(
                                        chat = selectedChat,
                                        state = state,
                                        store = store,
                                        draft = composerDraft,
                                        onDraftChange = { composerDraft = it },
                                        onSaveDraft = {
                                            if (composerDraft.isNotBlank()) {
                                                store.saveMessage(ChatMessage(text = composerDraft), selectedChat.name)
                                                composerDraft = ""
                                                showMessage(tr(language, "messageSaved"))
                                            }
                                        },
                                        onMessage = showMessage,
                                        modifier = Modifier.fillMaxSize(),
                                    )
                                } else ChatListScreen(
                                    state = state,
                                    store = store,
                                    onOpenChat = { selectedChatId = it.id },
                                    modifier = Modifier.fillMaxSize(),
                                )
                                "contacts" -> CenteredPane { pane ->
                                    ContactsScreen(
                                        state = state,
                                        onAddContact = { activeDialog = "contact" },
                                        onCreateCode = { activeDialog = "contactCode" },
                                        onImportCode = { activeDialog = "importCode" },
                                        onOpenChat = { contact ->
                                            val chat = store.getOrCreateContactChat(contact)
                                            activeTab = "chats"
                                            selectedChatId = chat.id
                                        },
                                        modifier = pane,
                                    )
                                }
                                "settings" -> CenteredPane { pane ->
                                    SettingsScreen(
                                        state = state,
                                        store = store,
                                        onEditProfile = { activeDialog = "profile" },
                                        onPassword = { activeDialog = "password" },
                                        onBackup = { activeDialog = "backupPassword" },
                                        onRestore = { restoreLauncher.launch(arrayOf("*/*")) },
                                        onExportSettings = { settingsExportLauncher.launch("libo-settings-v2.10.9.3.json") },
                                        onClearCache = {
                                            runCatching { context.cacheDir.listFiles()?.forEach { it.deleteRecursively() } }
                                            showMessage("Кеш очищено. Історія чатів збережена.")
                                        },
                                        onClearSessions = { activeDialog = "clearSessions" },
                                        onCreateCode = { activeDialog = "contactCode" },
                                        onImportCode = { activeDialog = "importCode" },
                                        onAddFolder = { activeDialog = "folder" },
                                        onSaveAi = { endpoint, model, apiKey ->
                                            if (!endpoint.startsWith("https://", ignoreCase = true)) {
                                                showMessage("Для AI API потрібна адреса HTTPS.")
                                            } else if (model.isBlank()) {
                                                showMessage("Вкажіть назву AI-моделі.")
                                            } else {
                                                scope.launch {
                                                    runCatching {
                                                        withContext(Dispatchers.IO) {
                                                            val encrypted = if (apiKey.isNotBlank()) SecurityTools.encryptApiKey(apiKey) else state.aiSettings.keyIv to state.aiSettings.encryptedKey
                                                            AiSettings(endpoint = endpoint, model = model, keyIv = encrypted.first, encryptedKey = encrypted.second)
                                                        }
                                                    }.onSuccess {
                                                        store.saveAiSettings(it)
                                                        showMessage(tr(language, "settingsSaved"))
                                                    }.onFailure { showMessage("Не вдалося захистити API-ключ.") }
                                                }
                                            }
                                        },
                                        onOpenAi = { route = "assistant" },
                                        onMessage = showMessage,
                                        modifier = pane,
                                    )
                                }
                                else -> CenteredPane { pane ->
                                    ProfileScreen(state.profile, language, onEdit = { activeDialog = "profile" }, modifier = pane)
                                }
                            }
                        }
                    }
                }
            }
        }

        when (activeDialog) {
            "search" -> SearchDialog(
                state = state,
                onDismiss = { activeDialog = "" },
                onOpenChat = { chat -> selectedChatId = chat.id; activeTab = "chats"; route = "main"; activeDialog = "" },
                onOpenContact = { contact ->
                    val chat = store.getOrCreateContactChat(contact)
                    selectedChatId = chat.id
                    activeTab = "chats"
                    route = "main"
                    activeDialog = ""
                },
            )
            "contact" -> CreateContactDialog(language, onDismiss = { activeDialog = "" }) { name, username, phone ->
                val cleanHandle = username.trim().replace(Regex("\\s+"), "_").let { if (it.isNotBlank() && !it.startsWith('@')) "@$it" else it }
                store.addContact(Contact(name = name.trim(), username = cleanHandle, phone = phone.trim()))
                activeDialog = ""
                showMessage(tr(language, "contactCreated"))
            }
            "group" -> CreateGroupOrChannelDialog(language, ChatKind.GROUP, onDismiss = { activeDialog = "" }) { name, members ->
                store.createChat(name.trim(), ChatKind.GROUP, members.trim().ifBlank { tr(language, "groupCreated") })
                activeDialog = ""
                showMessage(tr(language, "groupCreated"))
            }
            "channel" -> CreateGroupOrChannelDialog(language, ChatKind.CHANNEL, onDismiss = { activeDialog = "" }) { name, about ->
                store.createChat(name.trim(), ChatKind.CHANNEL, about.trim())
                activeDialog = ""
                showMessage(tr(language, "channelCreated"))
            }
            "contactPicker" -> ContactPickerDialog(language, state.contacts, onDismiss = { activeDialog = "" }) { contact ->
                val chat = store.getOrCreateContactChat(contact)
                selectedChatId = chat.id
                activeTab = "chats"
                route = "main"
                activeDialog = ""
            }
            "profile" -> ProfileEditorDialog(state.profile, language, onDismiss = { activeDialog = "" }) { profile ->
                store.updateProfile(profile)
                activeDialog = ""
                showMessage(tr(language, "settingsSaved"))
            }
            "contactCode" -> ContactCodeDialog(
                code = SecurityTools.makeContactCode(state.profile),
                language = language,
                onDismiss = { activeDialog = "" },
                onCopy = {
                    copyToClipboard(context, "LIBO contact code", SecurityTools.makeContactCode(state.profile))
                    showMessage(tr(language, "codeCopied"))
                },
                onShare = {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, SecurityTools.makeContactCode(state.profile))
                    }
                    context.startActivity(Intent.createChooser(send, "LIBO"))
                },
            )
            "importCode" -> ImportContactCodeDialog(language, onDismiss = { activeDialog = "" }) { value ->
                val contact = SecurityTools.parseContactCode(value)
                when {
                    contact == null -> showMessage(tr(language, "invalidCode"))
                    !store.addContactFromCode(contact) -> showMessage("Цей контакт уже є у списку.")
                    else -> showMessage(tr(language, "codeAdded"))
                }
                activeDialog = ""
            }
            "folder" -> TextInputDialog(tr(language, "addFolder"), tr(language, "folderName"), language, onDismiss = { activeDialog = "" }) { name ->
                showMessage(if (store.addFolder(name)) tr(language, "folderCreated") else "Папка вже існує або назва порожня.")
                activeDialog = ""
            }
            "password" -> PasswordSetupDialog(
                language = language,
                hasExistingPassword = store.hasPasswordProtection,
                onDismiss = { activeDialog = "" },
                onSave = { current, password, _ ->
                    scope.launch {
                        val valid = if (store.hasPasswordProtection) withContext(Dispatchers.Default) {
                            SecurityTools.verifyPassword(current, state.settings.lockSalt, state.settings.lockHash)
                        } else true
                        if (!valid) showMessage(tr(language, "wrongPassword"))
                        else {
                            val credentials = withContext(Dispatchers.Default) { SecurityTools.createPasswordCredentials(password) }
                            store.setPasswordCredentials(credentials.salt, credentials.hash)
                            activeDialog = ""
                            showMessage(tr(language, "passwordSaved"))
                        }
                    }
                },
                onRemove = { current ->
                    scope.launch {
                        val valid = withContext(Dispatchers.Default) {
                            SecurityTools.verifyPassword(current, state.settings.lockSalt, state.settings.lockHash)
                        }
                        if (valid) {
                            store.removePasswordCredentials()
                            activeDialog = ""
                            showMessage("Блокування паролем вимкнено.")
                        } else showMessage(tr(language, "wrongPassword"))
                    }
                },
            )
            "backupPassword" -> BackupPasswordDialog(language, onDismiss = { activeDialog = "" }) { password ->
                pendingBackupPassword = password
                activeDialog = ""
                backupLauncher.launch("LIBO-backup-v2.10.9.3.libo")
            }
            "restorePassword" -> RestorePasswordDialog(language, onDismiss = { activeDialog = ""; pendingRestoreUri = null }) { password ->
                val uri = pendingRestoreUri
                activeDialog = ""
                pendingRestoreUri = null
                if (uri != null) scope.launch {
                    runCatching {
                        val cleartext = withContext(Dispatchers.IO) {
                            val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
                                val output = java.io.ByteArrayOutputStream()
                                val buffer = ByteArray(8 * 1024)
                                var total = 0
                                while (true) {
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    total += count
                                    require(total <= 32 * 1024 * 1024) { "Backup is too large." }
                                    output.write(buffer, 0, count)
                                }
                                output.toByteArray()
                            } ?: error("Could not read backup file.")
                            SecurityTools.decryptBackup(bytes, password)
                        }
                        store.importBackupJson(cleartext)
                    }.onSuccess { showMessage(tr(language, "backupRestored")) }
                        .onFailure { showMessage("Не вдалося відновити backup: ${it.message ?: "невірний пароль або файл"}") }
                }
            }
            "clearSessions" -> ConfirmDialog(
                title = tr(language, "clearSessions"),
                message = tr(language, "clearConfirm"),
                language = language,
                confirmLabel = tr(language, "delete"),
                onDismiss = { activeDialog = "" },
                onConfirm = { store.clearLocalSessions(); activeDialog = ""; showMessage("Локальні повідомлення очищено.") },
            )
        }
    }
}

@Composable
private fun CreationFab(
    language: String,
    onNewContact: () -> Unit,
    onNewChat: () -> Unit,
    onNewGroup: () -> Unit,
    onNewChannel: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        FloatingActionButton(onClick = { expanded = true }, containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary) {
            Icon(Icons.Filled.Add, contentDescription = tr(language, "add"))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text(tr(language, "newChat")) }, leadingIcon = { Icon(Icons.Filled.Chat, null) }, onClick = { expanded = false; onNewChat() })
            DropdownMenuItem(text = { Text(tr(language, "newGroup")) }, leadingIcon = { Icon(Icons.Filled.Groups, null) }, onClick = { expanded = false; onNewGroup() })
            DropdownMenuItem(text = { Text(tr(language, "newContact")) }, leadingIcon = { Icon(Icons.Filled.PersonAdd, null) }, onClick = { expanded = false; onNewContact() })
            DropdownMenuItem(text = { Text(tr(language, "newChannel")) }, leadingIcon = { Icon(Icons.Filled.Campaign, null) }, onClick = { expanded = false; onNewChannel() })
        }
    }
}

@Composable
private fun CenteredPane(content: @Composable (Modifier) -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        content(Modifier.widthIn(max = 860.dp).fillMaxSize())
    }
}

@Composable
private fun LockScreen(language: String, verifyPassword: suspend (String) -> Boolean, onUnlocked: () -> Unit) {
    var password by rememberSaveable { mutableStateOf("") }
    var isWorking by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val colorScheme = MaterialTheme.colorScheme
    Box(
        modifier = Modifier.fillMaxSize().background(colorScheme.background).imePadding().padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Image(painterResource(R.drawable.ic_libo_mark), contentDescription = "LIBO", modifier = Modifier.size(76.dp))
            Text("libo", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
            Text(tr(language, "enterPassword"), color = colorScheme.onSurfaceVariant)
            androidx.compose.material3.OutlinedTextField(
                value = password,
                onValueChange = { password = it; error = "" },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Password),
                label = { Text(tr(language, "password")) },
            )
            androidx.compose.material3.Button(
                onClick = {
                    if (password.isNotBlank() && !isWorking) scope.launch {
                        isWorking = true
                        error = ""
                        if (verifyPassword(password)) onUnlocked() else error = tr(language, "wrongPassword")
                        isWorking = false
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = password.isNotBlank() && !isWorking,
            ) { Text(if (isWorking) "…" else tr(language, "unlock")) }
            if (error.isNotBlank()) Text(error, color = colorScheme.error)
            Text(tr(language, "localOnly"), style = MaterialTheme.typography.labelSmall, color = colorScheme.onSurfaceVariant)
        }
    }
}

private fun copyToClipboard(context: Context, label: String, text: String) {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    manager.setPrimaryClip(ClipData.newPlainText(label, text))
}
