package app.libo.android.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class LiboStore(context: Context) {
    private val preferences = context.getSharedPreferences("libo_native", Context.MODE_PRIVATE)

    var state by mutableStateOf(readState())
        private set

    val hasPasswordProtection: Boolean
        get() = state.settings.lockHash.isNotBlank() && state.settings.lockSalt.isNotBlank()

    @Synchronized
    fun update(transform: (AppState) -> AppState) {
        state = transform(state)
        persist()
    }

    fun updateSettings(transform: (AppSettings) -> AppSettings) = update { old ->
        old.copy(settings = transform(old.settings))
    }

    fun updateProfile(profile: Profile) = update { it.copy(profile = profile) }

    fun addContact(contact: Contact): Contact {
        update { old -> old.copy(contacts = listOf(contact) + old.contacts) }
        return contact
    }

    fun addContactFromCode(contact: Contact): Boolean {
        if (state.contacts.any { it.username.equals(contact.username, ignoreCase = true) && it.username.isNotBlank() }) {
            return false
        }
        addContact(contact)
        return true
    }

    fun createChat(name: String, kind: ChatKind, preview: String = "", contactId: String? = null): Chat {
        val chat = Chat(name = name, kind = kind, preview = preview, contactId = contactId)
        update { old -> old.copy(chats = listOf(chat) + old.chats, messages = old.messages + (chat.id to emptyList())) }
        return chat
    }

    fun getOrCreateContactChat(contact: Contact): Chat {
        state.chats.firstOrNull { it.contactId == contact.id }?.let { return it }
        return createChat(contact.name, ChatKind.DIRECT, contact.about, contact.id)
    }

    fun sendMessage(chatId: String, text: String, attachment: Attachment? = null, replyToId: String? = null) {
        if (text.isBlank() && attachment == null) return
        val message = ChatMessage(text = text.trim(), attachment = attachment, replyToId = replyToId)
        update { old ->
            val updatedMessages = old.messages.toMutableMap()
            updatedMessages[chatId] = (updatedMessages[chatId].orEmpty() + message)
            val preview = text.trim().ifBlank { attachment?.displayName.orEmpty() }
            old.copy(
                messages = updatedMessages,
                chats = old.chats.map { chat -> if (chat.id == chatId) chat.copy(preview = preview, updatedAt = message.sentAt) else chat },
            )
        }
    }

    fun editMessage(chatId: String, messageId: String, text: String) = update { old ->
        val list = old.messages[chatId].orEmpty().map { msg ->
            if (msg.id == messageId) msg.copy(text = text, edited = true) else msg
        }
        val latest = list.lastOrNull()?.let { it.text.ifBlank { it.attachment?.displayName.orEmpty() } }.orEmpty()
        old.copy(messages = old.messages + (chatId to list), chats = old.chats.map { if (it.id == chatId) it.copy(preview = latest) else it })
    }

    fun deleteMessage(chatId: String, messageId: String) = update { old ->
        val list = old.messages[chatId].orEmpty().filterNot { it.id == messageId }
        val latest = list.lastOrNull()?.let { it.text.ifBlank { it.attachment?.displayName.orEmpty() } }.orEmpty()
        old.copy(messages = old.messages + (chatId to list), chats = old.chats.map { if (it.id == chatId) it.copy(preview = latest) else it })
    }

    fun toggleMessagePin(chatId: String, messageId: String) = update { old ->
        val list = old.messages[chatId].orEmpty().map { if (it.id == messageId) it.copy(pinned = !it.pinned) else it }
        old.copy(messages = old.messages + (chatId to list))
    }

    fun saveMessage(message: ChatMessage, chatName: String) {
        val text = message.text.ifBlank { message.attachment?.displayName.orEmpty() }
        if (text.isBlank()) return
        update { old -> old.copy(savedMessages = listOf(SavedMessage(text = text, chatName = chatName)) + old.savedMessages) }
    }

    fun clearSavedMessages() = update { it.copy(savedMessages = emptyList()) }

    fun setChatPinned(chatId: String, pinned: Boolean) = update { old ->
        old.copy(chats = old.chats.map { if (it.id == chatId) it.copy(pinned = pinned) else it })
    }

    fun moveChat(chatId: String, folder: String?) = update { old ->
        old.copy(chats = old.chats.map { if (it.id == chatId) it.copy(folder = folder) else it })
    }

    fun addFolder(name: String): Boolean {
        val normalized = name.trim()
        if (normalized.isBlank() || state.folders.any { it.equals(normalized, ignoreCase = true) }) return false
        update { old -> old.copy(folders = old.folders + normalized) }
        return true
    }

    fun clearLocalSessions() = update { old ->
        old.copy(
            messages = old.chats.associate { it.id to emptyList() },
            chats = old.chats.map { it.copy(preview = "", updatedAt = System.currentTimeMillis()) },
            assistantMessages = emptyList(),
        )
    }

    fun addAssistantMessage(message: AssistantMessage) = update { old ->
        old.copy(assistantMessages = old.assistantMessages + message)
    }

    fun saveAiSettings(settings: AiSettings) = update { it.copy(aiSettings = settings) }

    fun setPasswordCredentials(salt: String, hash: String) = updateSettings { it.copy(lockSalt = salt, lockHash = hash) }

    fun removePasswordCredentials() = updateSettings { it.copy(lockSalt = "", lockHash = "") }

    fun exportBackupJson(): String = encode(state, includeSecrets = false).toString(2)

    fun exportSettingsJson(): String {
        val settings = state.settings.copy(lockSalt = "", lockHash = "")
        return JSONObject()
            .put("app", "LIBO")
            .put("version", "2.10.9.3")
            .put("settings", settings.toJson(includeSecrets = false))
            .put("profile", state.profile.toJson())
            .put("folders", JSONArray(state.folders))
            .toString(2)
    }

    fun importBackupJson(json: String) {
        val imported = decode(JSONObject(json), fallback = state)
        update { current ->
            imported.copy(
                settings = imported.settings.copy(
                    lockSalt = current.settings.lockSalt,
                    lockHash = current.settings.lockHash,
                ),
                aiSettings = current.aiSettings,
            )
        }
    }

    private fun readState(): AppState {
        val raw = preferences.getString("state", null) ?: return defaultAppState().also { saveState(it) }
        return try {
            decode(JSONObject(raw), fallback = defaultAppState())
        } catch (_: Exception) {
            defaultAppState()
        }
    }

    private fun persist() = saveState(state)

    private fun saveState(appState: AppState) {
        preferences.edit().putString("state", encode(appState, includeSecrets = true).toString()).apply()
    }

    private fun encode(appState: AppState, includeSecrets: Boolean): JSONObject {
        val chats = JSONArray().apply { appState.chats.forEach { put(it.toJson()) } }
        val contacts = JSONArray().apply { appState.contacts.forEach { put(it.toJson()) } }
        val messages = JSONObject().apply {
            appState.messages.forEach { (chatId, list) -> put(chatId, JSONArray().apply { list.forEach { put(it.toJson()) } }) }
        }
        val saved = JSONArray().apply { appState.savedMessages.forEach { put(it.toJson()) } }
        val assistant = JSONArray().apply { appState.assistantMessages.forEach { put(it.toJson()) } }
        return JSONObject()
            .put("schemaVersion", 2)
            .put("app", "LIBO")
            .put("version", "2.10.9.3")
            .put("chats", chats)
            .put("contacts", contacts)
            .put("messages", messages)
            .put("savedMessages", saved)
            .put("profile", appState.profile.toJson())
            .put("settings", appState.settings.toJson(includeSecrets))
            .put("folders", JSONArray(appState.folders))
            .put("ai", appState.aiSettings.toJson(includeKey = includeSecrets))
            .put("assistantMessages", assistant)
    }

    private fun decode(root: JSONObject, fallback: AppState): AppState {
        val chatsArray = root.optJSONArray("chats")
        val contactsArray = root.optJSONArray("contacts")
        val chats = chatsArray?.toList { it.toChat() } ?: fallback.chats
        val contacts = contactsArray?.toList { it.toContact() } ?: fallback.contacts
        val messagesObject = root.optJSONObject("messages") ?: JSONObject()
        val messages = buildMap {
            for (key in messagesObject.keys()) {
                val array = messagesObject.optJSONArray(key)
                put(key, array?.toList { it.toChatMessage() }.orEmpty())
            }
            chats.forEach { putIfAbsent(it.id, emptyList()) }
        }
        val saved = root.optJSONArray("savedMessages")?.toList { it.toSavedMessage() } ?: fallback.savedMessages
        val assistant = root.optJSONArray("assistantMessages")?.toList { it.toAssistantMessage() } ?: fallback.assistantMessages
        val profile = root.optJSONObject("profile")?.toProfile() ?: fallback.profile
        val settings = root.optJSONObject("settings")?.toSettings(fallback.settings) ?: fallback.settings
        val aiSettings = root.optJSONObject("ai")?.toAiSettings() ?: fallback.aiSettings
        val folders = root.optJSONArray("folders")?.toStringList() ?: fallback.folders
        return AppState(chats, contacts, messages, saved, profile, settings, folders, aiSettings, assistant)
    }
}

private fun Contact.toJson() = JSONObject()
    .put("id", id).put("name", name).put("username", username).put("phone", phone).put("about", about)

private fun JSONObject.toContact() = Contact(
    id = optString("id").ifBlank { UUID.randomUUID().toString() },
    name = optString("name", "Контакт"),
    username = optString("username"),
    phone = optString("phone"),
    about = optString("about"),
)

private fun Chat.toJson() = JSONObject()
    .put("id", id).put("name", name).put("preview", preview).put("kind", kind.name)
    .put("contactId", contactId ?: JSONObject.NULL).put("folder", folder ?: JSONObject.NULL)
    .put("pinned", pinned).put("updatedAt", updatedAt)

private fun JSONObject.toChat() = Chat(
    id = optString("id").ifBlank { UUID.randomUUID().toString() },
    name = optString("name", "Чат"),
    preview = optString("preview"),
    kind = runCatching { ChatKind.valueOf(optString("kind", "DIRECT")) }.getOrDefault(ChatKind.DIRECT),
    contactId = optStringOrNull("contactId"),
    folder = optStringOrNull("folder"),
    pinned = optBoolean("pinned", false),
    updatedAt = optLong("updatedAt", System.currentTimeMillis()),
)

private fun Attachment.toJson() = JSONObject()
    .put("displayName", displayName).put("mimeType", mimeType)
    .put("contentUri", contentUri ?: JSONObject.NULL).put("localPath", localPath ?: JSONObject.NULL)

private fun JSONObject.toAttachment() = Attachment(
    displayName = optString("displayName", "Вкладення"),
    mimeType = optString("mimeType", "application/octet-stream"),
    contentUri = optStringOrNull("contentUri"),
    localPath = optStringOrNull("localPath"),
)

private fun ChatMessage.toJson() = JSONObject()
    .put("id", id).put("text", text).put("sentAt", sentAt).put("isMine", isMine)
    .put("replyToId", replyToId ?: JSONObject.NULL).put("attachment", attachment?.toJson() ?: JSONObject.NULL)
    .put("pinned", pinned).put("edited", edited)

private fun JSONObject.toChatMessage() = ChatMessage(
    id = optString("id").ifBlank { UUID.randomUUID().toString() },
    text = optString("text"),
    sentAt = optLong("sentAt", System.currentTimeMillis()),
    isMine = optBoolean("isMine", true),
    replyToId = optStringOrNull("replyToId"),
    attachment = optJSONObject("attachment")?.toAttachment(),
    pinned = optBoolean("pinned", false),
    edited = optBoolean("edited", false),
)

private fun SavedMessage.toJson() = JSONObject().put("id", id).put("text", text).put("chatName", chatName).put("savedAt", savedAt)
private fun JSONObject.toSavedMessage() = SavedMessage(
    id = optString("id").ifBlank { UUID.randomUUID().toString() },
    text = optString("text"),
    chatName = optString("chatName", "LIBO"),
    savedAt = optLong("savedAt", System.currentTimeMillis()),
)

private fun Profile.toJson() = JSONObject()
    .put("name", name).put("username", username).put("about", about).put("wallpaper", wallpaper)

private fun JSONObject.toProfile() = Profile(
    name = optString("name", "Користувач"),
    username = optString("username", "@username"),
    about = optString("about"),
    wallpaper = optString("wallpaper", "violet"),
)

private fun AppSettings.toJson(includeSecrets: Boolean) = JSONObject()
    .put("language", language).put("darkTheme", darkTheme).put("animations", animations)
    .put("soundEnabled", soundEnabled).put("vibrationEnabled", vibrationEnabled).put("energySaving", energySaving)
    .apply {
        if (includeSecrets) {
            put("lockSalt", lockSalt)
            put("lockHash", lockHash)
        }
    }

private fun JSONObject.toSettings(fallback: AppSettings) = AppSettings(
    language = optString("language", fallback.language),
    darkTheme = optBoolean("darkTheme", fallback.darkTheme),
    animations = optBoolean("animations", fallback.animations),
    soundEnabled = optBoolean("soundEnabled", fallback.soundEnabled),
    vibrationEnabled = optBoolean("vibrationEnabled", fallback.vibrationEnabled),
    energySaving = optBoolean("energySaving", fallback.energySaving),
    lockSalt = optString("lockSalt", fallback.lockSalt),
    lockHash = optString("lockHash", fallback.lockHash),
)

private fun AiSettings.toJson(includeKey: Boolean) = JSONObject()
    .put("endpoint", endpoint).put("model", model)
    .apply { if (includeKey) put("encryptedKey", encryptedKey).put("keyIv", keyIv) }

private fun JSONObject.toAiSettings() = AiSettings(
    endpoint = optString("endpoint"),
    model = optString("model"),
    encryptedKey = optString("encryptedKey"),
    keyIv = optString("keyIv"),
)

private fun AssistantMessage.toJson() = JSONObject()
    .put("id", id).put("text", text).put("fromUser", fromUser).put("sentAt", sentAt)

private fun JSONObject.toAssistantMessage() = AssistantMessage(
    id = optString("id").ifBlank { UUID.randomUUID().toString() },
    text = optString("text"),
    fromUser = optBoolean("fromUser", false),
    sentAt = optLong("sentAt", System.currentTimeMillis()),
)

private fun JSONObject.optStringOrNull(key: String): String? {
    val value = opt(key)
    return if (value == null || value == JSONObject.NULL) null else value.toString().takeIf { it.isNotBlank() }
}

private inline fun <T> JSONArray.toList(transform: (JSONObject) -> T): List<T> = buildList {
    for (index in 0 until length()) {
        optJSONObject(index)?.let { add(transform(it)) }
    }
}

private fun JSONArray.toStringList(): List<String> = buildList {
    for (index in 0 until length()) optString(index).takeIf { it.isNotBlank() }?.let(::add)
}
