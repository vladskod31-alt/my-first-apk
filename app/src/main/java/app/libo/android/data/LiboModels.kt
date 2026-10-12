package app.libo.android.data

import java.util.UUID

enum class ChatKind { DIRECT, GROUP, CHANNEL }

data class Contact(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val username: String = "",
    val phone: String = "",
    val about: String = "",
)

data class Chat(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val preview: String = "",
    val kind: ChatKind = ChatKind.DIRECT,
    val contactId: String? = null,
    val folder: String? = null,
    val pinned: Boolean = false,
    val updatedAt: Long = System.currentTimeMillis(),
)

data class Attachment(
    val displayName: String,
    val mimeType: String = "application/octet-stream",
    val contentUri: String? = null,
    val localPath: String? = null,
)

data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val text: String = "",
    val sentAt: Long = System.currentTimeMillis(),
    val isMine: Boolean = true,
    val replyToId: String? = null,
    val attachment: Attachment? = null,
    val pinned: Boolean = false,
    val edited: Boolean = false,
)

data class SavedMessage(
    val id: String = UUID.randomUUID().toString(),
    val text: String,
    val chatName: String,
    val savedAt: Long = System.currentTimeMillis(),
)

data class Profile(
    val name: String = "Vladskod",
    val username: String = "@vlad_dev",
    val about: String = "Розробник і творець LIBO 🚀",
    val wallpaper: String = "violet",
)

data class AppSettings(
    val language: String = "uk",
    val darkTheme: Boolean = true,
    val animations: Boolean = true,
    val soundEnabled: Boolean = true,
    val vibrationEnabled: Boolean = true,
    val energySaving: Boolean = false,
    val lockSalt: String = "",
    val lockHash: String = "",
)

data class AiSettings(
    val endpoint: String = "",
    val model: String = "",
    val encryptedKey: String = "",
    val keyIv: String = "",
)

data class AssistantMessage(
    val id: String = UUID.randomUUID().toString(),
    val text: String,
    val fromUser: Boolean,
    val sentAt: Long = System.currentTimeMillis(),
)

data class AppState(
    val chats: List<Chat> = emptyList(),
    val contacts: List<Contact> = emptyList(),
    val messages: Map<String, List<ChatMessage>> = emptyMap(),
    val savedMessages: List<SavedMessage> = emptyList(),
    val profile: Profile = Profile(),
    val settings: AppSettings = AppSettings(),
    val folders: List<String> = emptyList(),
    val aiSettings: AiSettings = AiSettings(),
    val assistantMessages: List<AssistantMessage> = emptyList(),
)

fun defaultAppState(): AppState {
    val maria = Contact(
        id = "contact-maria",
        name = "Марія Коваль",
        username = "@maria_k",
        about = "Дизайнерка та ілюстраторка",
    )
    val team = Chat(
        id = "chat-team",
        name = "Команда LIBO",
        preview = "Локальний чат готовий до роботи",
        kind = ChatKind.GROUP,
    )
    val mariaChat = Chat(
        id = "chat-maria",
        name = maria.name,
        preview = "Привіт! Як справи?",
        kind = ChatKind.DIRECT,
        contactId = maria.id,
    )
    val channel = Chat(
        id = "chat-design",
        name = "Дизайн",
        preview = "Ідеї та нотатки каналу",
        kind = ChatKind.CHANNEL,
    )
    return AppState(
        chats = listOf(team, mariaChat, channel),
        contacts = listOf(
            maria,
            Contact(
                id = "contact-maxim",
                name = "Максим Петров",
                username = "@maxim_dev",
                about = "Розробник",
            ),
            Contact(
                id = "contact-anna",
                name = "Анна Іванова",
                username = "@anna_design",
                about = "Дизайнерка",
            ),
        ),
        messages = mapOf(
            mariaChat.id to listOf(
                ChatMessage(id = "demo-1", text = "Привіт! Як справи?", isMine = false, sentAt = System.currentTimeMillis() - 3_600_000),
                ChatMessage(id = "demo-2", text = "Вітаю! Усе добре, дякую 😊", isMine = true, sentAt = System.currentTimeMillis() - 3_540_000),
            ),
        ),
        assistantMessages = listOf(
            AssistantMessage(
                id = "assistant-welcome",
                text = "Вітаю! Налаштуйте сумісний AI API у розділі «Налаштування», щоб спілкуватися з помічником.",
                fromUser = false,
            ),
        ),
    )
}
