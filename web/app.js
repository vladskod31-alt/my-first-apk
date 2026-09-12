import { createIdentity, fingerprint, random64 } from './lib/crypto.mjs';
import { PhoneApi, accountUrl } from './lib/phone-api.mjs';
import { t, language, locale, setLanguage, translateStatic } from './lib/i18n.mjs';
import { createEmojiPicker, renderEmoji, downloadEmojiPack } from './lib/emoji.mjs';
import { Store } from './lib/storage.mjs';
import { Transport } from './lib/transport.mjs';
import { DeliveryTransport } from './lib/cloud-transport.mjs';
import { CloudApi } from './lib/cloud-api.mjs';
import { createMailbox, recoveryId, openRecoveryBackup } from './lib/cloud-crypto.mjs';
import { APPEARANCE_PRESETS, normalizeAppearance, normalizeChatAppearance, appearanceTokens, applyAppearance, applyChatAppearance, clearPrivateWallpaper } from './lib/appearance.mjs';
import {
  VERSION, MAX_TEXT, MAX_IMAGE_DATA, MAX_MESSAGES, MAX_CHATS,
  normalizePeerId, normalizeName, normalizeNickname, peerIdForNickname, normalizePhone, initials, avatarColor,
  previewText, safeFilename, parseSignalingUrl, makeIceServers, toPacket, textExport,
} from './lib/core.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const svg = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const store = new Store();
const state = {
  profile: null, settings: null, chats: [], blocked: [], current: null,
  filter: 'all', network: 'connecting', networkDetail: '', contactStates: new Map(),
  typing: new Map(), drafts: {}, reply: null, attachment: null, sending: false,
  identity: null, account: null, cryptoErrors: new Map(), blockedNames: {}, locking: false, contactsFilter: 'all',
  editing: null, background: false, identityFingerprint: '', cloud: null, cloudError: '', cloudLastSync: 0,
};
const locks = new Map();
const lastSent = new Map();
const timeFormat = { format: value => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(value) };
const dateFormat = { format: value => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' }).format(value) };
const lastReadSent = new Map();
const visibleSince = new Map();
let markingRead = false;
let lastActivity = Date.now();
let vaultMode = 'enable';
let smsChallenge = null;
let privateEpoch = 0;
let pendingPickedFile = null;
let pendingAppearanceFile = null;
let pendingRecoveryFile = null;
let appearanceDraft = null;
let appearanceScope = 'global';
let appearanceChatId = null;
let cloudSetupBusy = false;
let cloudConfigTail = Promise.resolve();
const deliveryAckJobs = new Map();
let toastTimer;
let typingSentAt = 0;
let confirmAction = null;
let audioContext;
let photoGeneration = 0;

const transport = new DeliveryTransport({
  onState(status, detail = '') {
    state.network = status; state.networkDetail = detail; renderNetwork(); renderHeader(); renderCloud();
    if (transport.isCloud && cloudSetupBusy && ['ready', 'offline', 'error'].includes(status)) {
      cloudSetupBusy = false; $('#cloud-save').disabled = false;
      if (status === 'ready') { closeDialogs(); if (!state.cloud?.recoverySaved) openDialog('recovery-dialog'); }
      else { $('#cloud-error').textContent = t(detail || 'CLOUD_UNREACHABLE'); $('#cloud-error').hidden = false; }
    }
  },
  onReady: retryConnections,
  onRestart: startNetwork,
  blockedIds: () => [...state.blocked],
  hasContact: id => state.chats.some(chat => chat.id === id),
  hasCloudMessage: (id, messageId) => { const chat = state.chats.find(c => c.id === id); return !!(chat?.cloudSeen?.includes(messageId) || chat?.messages.some(m => m.id === messageId && m.transport === 'cloud' && !['queued', 'sent'].includes(m.status))); },
  async onCloudAuthorized(session) {
    await updateCloudConfig({ ...session, registered: true, boundId: state.profile?.id });
    if (!store.locked && !state.locking) configureBackground();
  },
  onCloudCursor: (cursor, processed) => updateCloudConfig(current => ({ cursor, deferred: processed ? (current.deferred || []).filter(item => item.seq !== cursor) : current.deferred || [] })),
  onCloudDeferred: issue => updateCloudConfig(current => ({ deferred: [...(current.deferred || []).filter(item => item.seq !== issue.seq), issue].slice(-100) })),
  onCloudSync(at) { state.cloudLastSync = at; state.cloudError = ''; renderCloud(); },
  onCloudError(error) { state.cloudError = error; renderCloud(); },
  async onCloudSent(id, packet) {
    await changeChat(id, chat => {
      chat.request = false;
      const found = chat.messages.findIndex(m => m.id === packet.id);
      if (found >= 0) { if (['queued', 'sent'].includes(chat.messages[found].status)) chat.messages[found] = { ...chat.messages[found], status: 'stored', transport: 'cloud' }; else return false; }
      else if (!(chat.cloudSeen || []).includes(packet.id)) {
        makeRoom(chat); chat.messages.push({ ...packet, direction: 'out', status: 'stored', transport: 'cloud' });
        chat.messages.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      }
      chat.cloudSeen = [...new Set([...(chat.cloudSeen || []), packet.id])].slice(-20000);
      chat.updatedAt = Math.max(chat.updatedAt || 0, packet.at);
    });
    if (state.current === id) renderMessages(false); renderSidebar();
  },
  isAllowed: id => !state.locking && !store.locked && !!normalizePeerId(id) && id !== state.profile?.id && !state.blocked.includes(id),
  async onIdentity(id, name, keyFingerprint, publicKey) {
    await changeChat(id, chat => {
      if ((chat.peerFingerprint && chat.peerFingerprint !== keyFingerprint) || (chat.expectedFingerprint && chat.expectedFingerprint !== keyFingerprint)) throw new Error('CRYPTO_KEY_CHANGED');
      if (chat.peerFingerprint === keyFingerprint) return false;
      chat.peerFingerprint = keyFingerprint; chat.peerPublicKey = publicKey;
      chat.keyVerified = !!chat.expectedFingerprint && !!chat.phoneVerified;
    }, { name, request: true });
  },
  async onHello(id, name) {
    await changeChat(id, chat => { if (chat.name === name) return false; chat.name = name; }, { request: true });
    renderSidebar(); if (state.current === id) renderHeader();
  },
  onContactState(id, status) {
    state.contactStates.set(id, status);
    if (status !== 'online') state.typing.delete(id);
    renderSidebar(); if (state.current === id) renderHeader();
  },
  onCryptoError(id, error) {
    if (state.locking || store.locked) return;
    if (state.cryptoErrors.get(id) !== error) notify(error, true);
    state.cryptoErrors.set(id, error); renderHeader();
  },
  onConnected(id) {
    state.cryptoErrors.delete(id);
    const chat = state.chats.find(c => c.id === id);
    for (const m of chat?.messages || []) lastSent.delete(m.id);
    for (const key of chat?.pendingRead || []) lastReadSent.delete(key);
    void flushPending(id); void flushReads(id); void flushDeliveryAcks(id); renderHeader();
  },
  async onMessage(id, packet) {
    if (state.locking || store.locked) return;
    try {
      let fresh = false;
      await changeChat(id, chat => {
        if (chat.messages.some(m => m.id === packet.id) || (transport.isCloud && chat.cloudSeen?.includes(packet.id))) {
          if (transport.isCloud) chat.pendingDeliveryAck = [...new Set([...(chat.pendingDeliveryAck || []), packet.id])];
          return transport.isCloud ? undefined : false;
        }
        if (chat.request && chat.messages.length >= 10) throw new Error(transport.isCloud ? 'CLOUD_REQUEST_PENDING' : 'Сначала примите запрос на общение.');
        makeRoom(chat); fresh = true;
        chat.messages.push({ id: packet.id, text: packet.text, image: packet.image, reply: packet.reply,
          at: Math.min(packet.at, Date.now() + 60_000), direction: 'in', status: 'received', seenAt: null, transport: transport.isCloud ? 'cloud' : 'direct' });
        if (transport.isCloud) { chat.cloudSeen = [...new Set([...(chat.cloudSeen || []), packet.id])].slice(-20000); chat.pendingDeliveryAck = [...new Set([...(chat.pendingDeliveryAck || []), packet.id])]; chat.messages.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)); }
        chat.unread = (chat.unread || 0) + 1; chat.updatedAt = Date.now();
      });
      // Persistence is delivery. A separate viewport tracker is responsible for read receipts.
      if (transport.isCloud) await flushDeliveryAcks(id); else await transport.send(id, { v: 2, type: 'ack', id: packet.id });
      state.typing.delete(id);
      if (fresh && !state.locking && !store.locked) {
        renderSidebar(); if (state.current === id) { renderMessages(); renderHeader(); } playMessageSound();
      }
    } catch (error) { transport.closeContact(id); if (!state.locking && error.message !== 'CLOUD_REQUEST_PENDING') notify(error.message?.includes('запрос') ? error.message : 'Сообщение не сохранено: проверьте свободное место на устройстве.', true); if (transport.isCloud) throw error; }
  },
  async onAck(id, messageId) {
    if (state.locking || store.locked) return;
    try {
      await changeChat(id, chat => {
        const index = chat.messages.findIndex(m => m.id === messageId && m.direction === 'out');
        if (index < 0 || ['delivered', 'read'].includes(chat.messages[index].status)) return false;
        chat.messages[index] = { ...chat.messages[index], status: 'delivered' };
      });
      lastSent.delete(messageId); if (state.current === id) renderMessages(false); renderSidebar();
    } catch (error) { if (!state.locking) notify('Не удалось сохранить статус доставки.', true); if (transport.isCloud) throw error; }
  },
  async onRead(id, ids) {
    if (state.locking || store.locked) return;
    const keys = new Set(ids);
    await changeChat(id, chat => {
      let changed = false;
      chat.messages = chat.messages.map(m => {
        if (m.direction !== 'out' || !keys.has(m.id) || m.status === 'read') return m;
        changed = true; lastSent.delete(m.id); return { ...m, status: 'read', readAt: Date.now() };
      });
      return changed;
    });
    await transport.send(id, { v: 2, type: 'read-ack', ids });
    if (state.current === id) renderMessages(false); renderSidebar();
  },
  async onReadAck(id, ids) {
    if (state.locking || store.locked) return;
    const keys = new Set(ids);
    await changeChat(id, chat => { const previous = chat.pendingRead || []; chat.pendingRead = previous.filter(key => !keys.has(key)); return chat.pendingRead.length !== previous.length; });
    ids.forEach(key => lastReadSent.delete(key));
  },
  onTyping(id, active) {
    state.typing.set(id, active ? Date.now() + 3500 : 0);
    if (state.current === id) renderHeader();
    setTimeout(() => { if (state.current === id) renderHeader(); }, 3600);
  },
}, Transport);

// Serialize each chat's writes. Concurrent incoming messages, ACKs, and drafts must not overwrite one another.
function changeChat(id, mutate, defaults = null) {
  const epoch = privateEpoch;
  const previous = locks.get(id) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    if (store.locked || epoch !== privateEpoch) throw new Error('VAULT_LOCKED');
    const index = state.chats.findIndex(chat => chat.id === id);
    const original = state.chats[index];
    if (!original && !defaults) throw new Error('Чат не найден.');
    if (!original && state.chats.length >= MAX_CHATS) throw new Error('Достигнут лимит: 100 чатов на устройстве.');
    const chat = original
      ? { ...original, messages: [...original.messages] }
      : { id, addressVersion: 2, name: 'Новый контакт', messages: [], unread: 0, createdAt: Date.now(), updatedAt: 0, ...defaults };
    if (mutate(chat) === false) return original;
    await store.putChat(chat);
    if (epoch !== privateEpoch) return chat;
    if (index === -1) state.chats.push(chat);
    else state.chats[index] = chat;
    return chat;
  });
  locks.set(id, task);
  task.then(() => { if (locks.get(id) === task) locks.delete(id); }, () => { if (locks.get(id) === task) locks.delete(id); });
  return task;
}

function makeRoom(chat) {
  if (chat.messages.length < MAX_MESSAGES) return;
  const index = chat.messages.findIndex(m => m.direction === 'in' || ['stored', 'delivered', 'read', 'local'].includes(m.status));
  if (index < 0) throw new Error('В очереди уже 500 сообщений. Дождитесь доставки или очистите чат.');
  const removed = chat.messages.splice(index, 1)[0];
  if (removed.direction === 'in' && !removed.seenAt) chat.unread = Math.max(0, (chat.unread || 0) - 1);
}

function activeChat() { return state.chats.find(chat => chat.id === state.current); }
function chatName(chat) { return chat.id === 'saved' ? t('Избранное') : chat.alias || chat.name; }

function notify(text, error = false) {
  const toast = $('#toast');
  const open = $('dialog[open]');
  (open || document.body).appendChild(toast);
  toast.querySelector('span').textContent = t(text);
  toast.querySelector('use').setAttribute('href', error ? '#i-info' : '#i-check');
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 5500 : 3200);
}

function renderNetwork() {
  const el = $('#network-status');
  el.className = `network-status ${state.network}`;
  el.querySelector('span').textContent = t({
    ready: 'Вы в сети', connecting: 'Подключаемся…', offline: 'Нет соединения', error: 'Нужно подключение',
  }[state.network] || 'Нет соединения');
  if (transport.isCloud) el.querySelector('span').textContent = t(state.network === 'ready' ? 'CLOUD_CONNECTED_SHORT' : state.network === 'connecting' ? 'CLOUD_CONNECTING_SHORT' : 'CLOUD_OFFLINE_SHORT');
  el.title = t(state.networkDetail || (transport.isCloud ? 'CLOUD_NETWORK_HELP' : 'Наличие связи с сигнальным сервером. Статус собеседника показан внутри чата.'));
}

function renderSidebar() {
  if (!state.profile || state.locking || store.locked) return;
  const query = $('#chat-search').value.trim().toLocaleLowerCase(locale());
  const chats = [...state.chats].sort((a, b) => a.id === 'saved' ? -1 : b.id === 'saved' ? 1 : Number(!!b.close) - Number(!!a.close) || b.updatedAt - a.updatedAt);
  const filtered = chats.filter(chat => {
    if (state.filter === 'unread' && !chat.unread) return false;
    if (state.filter === 'close' && !chat.close) return false;
    return !query || `${chatName(chat)} ${chat.name} ${chat.phone || ''}`.toLocaleLowerCase(locale()).includes(query) || chat.messages.some(m => m.text.toLocaleLowerCase(locale()).includes(query));
  });
  const list = $('#chat-list');
  list.replaceChildren();
  for (const chat of filtered) {
    const row = document.createElement('button');
    row.className = `chat-row${chat.id === state.current ? ' selected' : ''}`;
    row.dataset.chatId = chat.id;
    row.setAttribute('aria-label', t('Открыть чат {name}', { name: chatName(chat) }));
    row.setAttribute('aria-current', chat.id === state.current ? 'true' : 'false');
    const online = !transport.isCloud && transport.isOpen(chat.id);
    const avatar = document.createElement('span');
    avatar.className = `avatar ${chat.id === 'saved' ? 'saved' : avatarColor(chat.id)}${online ? ' online' : ''}`;
    if (chat.id === 'saved') avatar.innerHTML = svg('bookmark');
    else avatar.textContent = initials(chatName(chat));
    const body = document.createElement('span');
    body.className = 'chat-row-body';
    body.innerHTML = '<span class="chat-row-top"><strong></strong><time></time></span><span class="chat-row-bottom"><p></p></span>';
    body.querySelector('strong').textContent = chatName(chat);
    const last = chat.messages.at(-1);
    body.querySelector('time').textContent = last ? briefDate(last.at) : '';
    const excerpt = query ? [...chat.messages].reverse().find(m => m.text.toLocaleLowerCase(locale()).includes(query)) || last : last;
    body.querySelector('p').textContent = !last && chat.id === 'saved' ? t('Ваши заметки, ссылки и идеи') : previewText(excerpt, t);
    if (chat.unread) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.textContent = chat.unread > 99 ? '99+' : chat.unread;
      body.lastElementChild.appendChild(badge);
    } else if (chat.request) {
      const badge = document.createElement('span');
      badge.className = 'request-badge'; badge.textContent = t('ЗАПРОС');
      body.lastElementChild.appendChild(badge);
    } else if (chat.id === 'saved') body.lastElementChild.insertAdjacentHTML('beforeend', svg('bookmark'));
    row.append(avatar, body);
    list.appendChild(row);
  }
  if (!filtered.length || (!query && state.filter === 'all' && chats.length === 1)) {
    const empty = document.createElement('div');
    empty.className = 'empty-chats';
    empty.innerHTML = `${svg('chat').replace('<svg', '<span><svg').replace('</svg>', '</svg></span>')}<strong></strong><p></p>`;
    empty.querySelector('strong').textContent = t(query ? 'Ничего не нашлось' : state.filter === 'unread' ? 'Вы всё прочитали' : state.filter === 'close' ? 'Ваши близкие' : 'Здесь будут ваши люди');
    empty.querySelector('p').textContent = t(query ? 'Попробуйте другое имя или слово из переписки.' : state.filter === 'unread' ? 'Новые сообщения появятся здесь.' : state.filter === 'close' ? 'Отметьте важные контакты звездой.' : 'Добавьте контакт по нику и начните разговор.');
    if (!query && state.filter === 'all') {
      const button = document.createElement('button');
      button.textContent = t('+ Добавить контакт');
      button.dataset.dialog = 'new-dialog';
      empty.appendChild(button);
    }
    list.appendChild(empty);
  }
  $('#chat-count').textContent = state.chats.length;
  const unread = state.chats.filter(c => c.unread > 0).length;
  $('#unread-count').textContent = unread;
  $('#unread-count').hidden = !unread;
  $('#nav-chats').classList.toggle('active', state.current !== 'saved');
  $('#nav-saved').classList.toggle('active', state.current === 'saved');
}

function briefDate(at) {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(date);
}

function dayLabel(at) {
  const date = new Date(at);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return t('Сегодня');
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? t('Вчера') : dateFormat.format(date);
}

function renderHeader() {
  const chat = activeChat(); if (!chat || state.locking) return;
  const avatar = $('#chat-avatar'), saved = chat.id === 'saved', online = !transport.isCloud && transport.isOpen(chat.id);
  avatar.className = `avatar ${saved ? 'saved' : avatarColor(chat.id)}${online ? ' online' : ''}`;
  if (saved) avatar.innerHTML = svg('bookmark'); else avatar.textContent = initials(chatName(chat));
  $('#chat-title').textContent = chatName(chat);
  const legacy = !saved && chat.addressVersion !== 2;
  const presence = $('#chat-presence'); presence.classList.toggle('is-online', online);
  presence.textContent = saved ? t('Личное пространство · только на этом устройстве')
    : legacy ? t('Архив старой версии — добавьте контакт заново по нику') : state.cryptoErrors.has(chat.id) ? t(state.cryptoErrors.get(chat.id))
    : state.typing.get(chat.id) > Date.now() ? t('печатает…')
    : chat.request ? t('Новый запрос на общение')
    : transport.isCloud ? t(state.network === 'ready' ? 'CLOUD_CHAT_READY' : 'CLOUD_CHAT_WAITING')
    : online ? t(chat.keyVerified ? 'В сети · AES‑256 · ключ проверен' : 'В сети · AES‑256 · сверьте ключ')
    : state.contactStates.get(chat.id) === 'connecting' ? t('Ищем собеседника…')
    : t('Не подключён · откройте LIBO на обоих устройствах');
  presence.title = saved ? t('Заметки не передаются другим устройствам.') : `@${chat.name}`;
  $('#request-bar').hidden = !chat.request; $('#composer-zone').hidden = !!chat.request || legacy;
  for (const id of ['block-contact', 'chat-favorite', 'chat-security', 'edit-contact']) $(`#${id}`).hidden = saved || legacy;
  $('#chat-favorite').setAttribute('aria-pressed', String(!!chat.close));
  $('#chat-favorite').title = t(chat.close ? 'Убрать из близких' : 'Добавить в близкие');
  $('#chat-favorite').setAttribute('aria-label', $('#chat-favorite').title);
  applyChatAppearance(chat.appearance, state.settings?.appearance, document.documentElement.dataset.theme === 'dark');
  $('#composer-hint').textContent = t(saved ? 'Сохранено на этом устройстве. Последние 500 сообщений в чате.' : transport.isCloud ? 'CLOUD_COMPOSER_HINT' : 'AES‑256 · ✓✓ серые — доставлено · ✓✓ цветные — прочитано');
}

function renderMessages(scroll = true) {
  const chat = activeChat();
  if (!chat || state.locking || store.locked) return;
  const box = $('#messages');
  const previousTop = box.scrollTop;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const query = $('#message-search').value.trim().toLocaleLowerCase(locale());
  const messages = chat.messages.filter(m => !query || m.text.toLocaleLowerCase(locale()).includes(query) || m.reply?.text.toLocaleLowerCase(locale()).includes(query));
  box.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.innerHTML = `<div>${svg(chat.id === 'saved' ? 'bookmark' : 'chat')}</div><h3></h3><p></p>`;
    empty.querySelector('h3').textContent = t(query ? 'Ничего не найдено' : chat.id === 'saved' ? 'Мысли, которые стоит сохранить' : 'Ваше первое «привет»');
    empty.querySelector('p').textContent = t(query ? 'Попробуйте другое слово.' : chat.id === 'saved' ? 'Заметки, фотографии и важные идеи. Всё в одном месте и только для вас.' : transport.isCloud ? 'CLOUD_EMPTY_CHAT_NOTE' : 'Здесь начнётся ваш разговор. Если собеседник не в сети, сообщение подождёт на вашем устройстве.');
    box.appendChild(empty);
    return;
  }
  let previousDay = '';
  for (const message of messages) {
    const day = new Date(message.at).toDateString();
    if (day !== previousDay) {
      const separator = document.createElement('div'); separator.className = 'day-separator';
      const label = document.createElement('span'); label.textContent = dayLabel(message.at);
      separator.appendChild(label); box.appendChild(separator); previousDay = day;
    }
    const row = document.createElement('div');
    row.className = `message-row ${message.direction === 'out' ? 'outgoing' : 'incoming'}`;
    row.dataset.messageId = message.id;
    const bubble = document.createElement('div'); bubble.className = 'message-bubble';
    if (message.reply) {
      const quote = document.createElement('div'); quote.className = 'message-quote';
      quote.innerHTML = '<strong></strong><p></p>';
      quote.querySelector('strong').textContent = message.reply.name;
      quote.querySelector('p').textContent = message.reply.text;
      bubble.appendChild(quote);
    }
    if (message.image) {
      const photo = document.createElement('button'); photo.className = 'message-photo'; photo.dataset.photo = message.id;
      photo.setAttribute('aria-label', t('Открыть фотографию'));
      const img = document.createElement('img'); img.src = message.image.data; img.alt = message.image.name || t('Фотография'); img.loading = 'lazy';
      img.onload = () => { if (scroll && box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight; };
      photo.appendChild(img); bubble.appendChild(photo);
    }
    if (message.text) {
      const text = document.createElement('p'); text.className = 'message-text'; text.textContent = message.text;
      renderEmoji(text); bubble.appendChild(text);
    }
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const time = document.createElement('time'); time.dateTime = new Date(message.at).toISOString(); time.textContent = timeFormat.format(new Date(message.at));
    meta.appendChild(time);
    if (message.direction === 'out') {
      const status = document.createElement('span'); status.setAttribute('role', 'img'); status.className = 'message-status'; status.dataset.status = message.status;
      status.title = t({ queued: 'В очереди на этом устройстве', sent: 'Отправлено, ждём подтверждения', stored: 'CLOUD_STORED', delivered: 'Доставлено — ещё не прочитано', read: 'Прочитано — показано на экране получателя', local: 'Сохранено только на этом устройстве' }[message.status] || 'В очереди на этом устройстве');
      status.setAttribute('aria-label', status.title);
      status.innerHTML = svg({ queued: 'clock', sent: 'check', stored: 'cloud', delivered: 'checks', read: 'checks', local: 'bookmark' }[message.status] || 'clock');
      meta.appendChild(status);
    }
    bubble.appendChild(meta);
    const reply = document.createElement('button'); reply.className = 'reply-message'; reply.dataset.reply = message.id;
    reply.innerHTML = svg('reply'); reply.title = t('Ответить'); reply.setAttribute('aria-label', t('Ответить на сообщение'));
    row.append(bubble, reply); box.appendChild(row);
  }
  if (scroll && nearBottom) box.scrollTop = box.scrollHeight;
  else box.scrollTop = previousTop;
}

function rememberDraft() {
  if (!state.current || store.locked || state.locking) return Promise.resolve();
  const value = $('#message-input').value.slice(0, MAX_TEXT);
  if (value) state.drafts[state.current] = value; else delete state.drafts[state.current];
  return store.setMeta('drafts', { ...state.drafts }).catch(() => notify('Черновик не сохранён: на устройстве мало места.', true));
}

function resetComposerExtras() {
  state.reply = null;
  state.attachment = null;
  photoGeneration++;
  $('#reply-bar').hidden = true;
  $('#attachment-preview').hidden = true;
  $('#attachment-image').removeAttribute('src');
  $('#photo-input').value = '';
  $('#emoji-picker').hidden = true;
  $('#emoji-button').setAttribute('aria-expanded', 'false');
}

async function openChat(id) {
  if (store.locked || state.locking || !state.chats.some(chat => chat.id === id)) return;
  rememberDraft();
  state.current = id;
  $('#shell').classList.add('chat-open');
  $('#welcome').hidden = true;
  $('#conversation').hidden = false;
  closeChatMenu();
  closeMessageSearch();
  resetComposerExtras();
  $('#message-input').value = state.drafts[id] || '';
  updateComposer();
  renderHeader(); renderMessages(); renderSidebar();
  $('#messages').scrollTop = $('#messages').scrollHeight;
  if (id !== 'saved' && activeChat()?.addressVersion === 2) transport.connect(id);
  visibleSince.clear();
}

function closeChat() {
  rememberDraft();
  state.current = null;
  $('#shell').classList.remove('chat-open');
  $('#welcome').hidden = false;
  $('#conversation').hidden = true;
  resetComposerExtras();
  renderSidebar();
}

function updateComposer() {
  const input = $('#message-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(140, Math.max(37, input.scrollHeight))}px`;
  $('#send-button').disabled = state.sending || (!input.value.trim() && !state.attachment);
}

async function sendMessage(event) {
  event?.preventDefault();
  const chat = activeChat();
  const text = $('#message-input').value.trim().slice(0, MAX_TEXT);
  if (!chat || (chat.id !== 'saved' && chat.addressVersion !== 2) || chat.request || state.locking || store.locked || state.sending || (!text && !state.attachment)) return;
  const id = chat.id;
  const message = {
    id: crypto.randomUUID(), text, image: state.attachment, reply: state.reply,
    at: Date.now(), direction: 'out', status: id === 'saved' ? 'local' : 'queued', transport: transport.isCloud ? 'cloud' : 'direct',
  };
  state.sending = true; updateComposer();
  try {
    await changeChat(id, next => { makeRoom(next); next.messages.push(message); next.updatedAt = message.at; });
    if (state.current === id) {
      $('#message-input').value = '';
      rememberDraft(); resetComposerExtras();
      renderMessages();
      $('#messages').scrollTop = $('#messages').scrollHeight;
    }
    renderSidebar();
    if (id !== 'saved') {
      transport.send(id, { v: 2, type: 'typing', active: false });
      transport.connect(id);
      await flushPending(id);
    }
  } catch (error) { notify(error.message?.includes('500') ? error.message : 'Не удалось сохранить сообщение. Проверьте свободное место.', true); }
  finally { state.sending = false; updateComposer(); }
}

async function flushPending(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat || chat.request || state.locking || store.locked || !transport.isOpen(id)) return;
  const pending = chat.messages.filter(m => m.direction === 'out' && ['sent', 'queued'].includes(m.status) && Date.now() - (lastSent.get(m.id) || 0) > 15_000).slice(0, 25);
  const sent = new Set();
  for (const message of pending) {
    if (await transport.send(id, toPacket(message))) { sent.add(message.id); lastSent.set(message.id, Date.now()); }
  }
  if (!sent.size || state.locking || store.locked) return;
  try {
    await changeChat(id, next => {
      next.messages = next.messages.map(m => sent.has(m.id) && m.status === 'queued' ? { ...m, status: transport.isCloud ? 'stored' : 'sent' } : m);
    });
    if (state.current === id) renderMessages(false);
  } catch { notify('Не удалось сохранить статус отправки.', true); }
}

function retryConnections() {
  if (state.network !== 'ready' || !state.profile || state.locking || store.locked) return;
  for (const chat of state.chats) {
    if (chat.id === 'saved' || chat.request || chat.addressVersion !== 2) continue;
    if (chat.id === state.current || chat.pendingRead?.length || chat.pendingDeliveryAck?.length || chat.messages.some(m => m.direction === 'out' && ['queued', 'sent'].includes(m.status))) {
      transport.connect(chat.id);
      void flushPending(chat.id); void flushReads(chat.id); void flushDeliveryAcks(chat.id);
    }
  }
}

function closeDialogs() {
  for (const dialog of $$('dialog[open]')) dialog.close();
}

function openDialog(id) {
  if (state.locking || store.locked || !state.profile?.nicknameSetup) return;
  closeDialogs(); closeChatMenu(); visibleSince.clear();
  if (id === 'new-dialog') {
    state.editing = null; $('#add-contact-form').reset(); $('#contact-nick').disabled = false;
    $('#contact-error').hidden = true; $('#contact-modal-title').textContent = t('Новый контакт');
  }
  if (id === 'settings-dialog') populateSettings();
  if (id === 'cloud-dialog') populateCloud();
  if (id === 'recovery-dialog' && !state.cloud?.recoverySecret) { notify('CLOUD_NOT_CONFIGURED', true); return; }
  if (id === 'blocked-dialog') renderBlocked();
  if (id === 'contacts-dialog') { $('#contacts-search').value = ''; state.contactsFilter = 'all'; renderContacts(); }
  if (id === 'emoji-channel') buildPicker('channel-picker', true);
  $(`#${id}`).showModal();
  if (id === 'new-dialog') $('#contact-nick').focus();
}

function confirmDialog(title, text, action, button = 'Продолжить') {
  openDialog('confirm-dialog');
  $('#confirm-title').textContent = t(title);
  $('#confirm-text').textContent = t(text);
  $('#confirm-action').textContent = t(button);
  confirmAction = action;
}

async function addContact(event) {
  event.preventDefault(); const error = $('#contact-error'); error.hidden = true;
  $('#contact-save').disabled = true;
  try {
    let name = normalizeNickname($('#contact-nick').value), verified = null;
    let phone = normalizePhone($('#contact-phone').value.trim());
    if (phone === null) throw new Error('PHONE_INVALID');
    if (!state.editing && $('#contact-nick').value.trim().startsWith('+')) {
      const query = normalizePhone($('#contact-nick').value.trim());
      if (!query) throw new Error('PHONE_INVALID');
      if (!phoneVerified()) throw new Error('PHONE_SIGN_IN_REQUIRED');
      verified = (await phoneApi().find(query)).contact;
      name = normalizeNickname(verified.name); phone = query;
      if (!name || verified.phone !== query || verified.id !== await peerIdForNickname(name) || verified.fingerprint !== await fingerprint(verified.publicKey)) throw new Error('CRYPTO_INVALID');
    }
    if (!name) throw new Error('NAME_INVALID');
    const id = state.editing || await peerIdForNickname(name);
    if (id === state.profile.id) throw new Error('OWN_CONTACT');
    if (state.blocked.includes(id)) throw new Error('CONTACT_BLOCKED');
    const alias = normalizeName($('#contact-label').value), close = $('#contact-close').checked;
    await changeChat(id, chat => {
      chat.request = false; chat.name = name; chat.alias = alias; chat.close = close;
      if (phone !== chat.phone) chat.phoneVerified = false;
      chat.phone = phone;
      if (verified) {
        if (chat.peerFingerprint && chat.peerFingerprint !== verified.fingerprint) throw new Error('CRYPTO_KEY_CHANGED');
        chat.expectedFingerprint = verified.fingerprint; chat.phoneVerified = true;
        chat.phoneServer = state.settings.accountUrl;
      }
    }, { request: false, updatedAt: Date.now() });
    closeDialogs(); await openChat(id); notify(transport.isCloud ? 'CLOUD_CONTACT_SAVED' : 'Контакт сохранён. Откройте LIBO на обоих устройствах.');
  } catch (err) { error.textContent = t(err.message); error.hidden = false; }
  finally { $('#contact-save').disabled = false; }
}

function applyTheme() {
  if (!state.settings) return;
  const dark = state.settings.theme === 'dark' || (state.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#191920' : '#f7f7fb';
  $('#theme-toggle use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $$('[data-theme]').forEach(button => {
    if (button.tagName !== 'BUTTON') return;
    button.classList.toggle('active', button.dataset.theme === state.settings.theme);
    button.setAttribute('aria-pressed', button.dataset.theme === state.settings.theme ? 'true' : 'false');
  });
  applyAppearance(state.settings.appearance, dark);
  applyChatAppearance(activeChat()?.appearance, state.settings.appearance, dark);
  window.LiboAndroid?.setDarkTheme(dark);
}

async function setTheme(theme) {
  const epoch = privateEpoch;
  const previous = state.settings;
  state.settings = { ...state.settings, theme };
  applyTheme();
  try { await store.setMeta('settings', state.settings); }
  catch { if (epoch !== privateEpoch) return; state.settings = previous; applyTheme(); notify('Тема не сохранена.', true); }
}

function populateSettings() {
  $('#profile-name').disabled = !!state.cloud?.registered;
  $('#profile-name').value = state.profile.name; $('#profile-phone').value = state.profile.phone || '';
  $('#settings-avatar').textContent = initials(state.profile.name);
  $('#sound-enabled').checked = state.settings.sound; $('#read-receipts').checked = state.settings.readReceipts;
  $('#signal-url').value = state.settings.signalUrl; $('#account-url').value = state.settings.accountUrl;
  $('#turn-url').value = state.settings.turnUrl; $('#turn-user').value = state.settings.turnUser; $('#turn-password').value = state.settings.turnPassword;
  $('#auto-lock').value = String(state.settings.autoLock || 5); $('#settings-error').hidden = true;
  $('#app-language').value = language();
  $('#blocked-summary').textContent = state.blocked.length ? t('Контактов: {count}', { count: state.blocked.length }) : t('Нет заблокированных');
  $('#phone-status').textContent = t(phoneVerified() ? 'Подтверждён SMS' : 'Не подтверждён');
  $('#phone-status').classList.toggle('verified', phoneVerified());
  $('#phone-discoverable').disabled = !phoneVerified(); $('#phone-discoverable').checked = !!(phoneVerified() && state.account.account.discoverable);
  $('#phone-remove').hidden = !state.account?.token;
  $('#background-messages').checked = !!state.settings.backgroundMessages;
  renderNotificationSettings(); renderVaultSettings(); applyTheme();
}

async function saveSettings(event, keepOpen = false) {
  event?.preventDefault(); const epoch = privateEpoch; const error = $('#settings-error'); error.hidden = true;
  const name = normalizeNickname($('#profile-name').value), phone = normalizePhone($('#profile-phone').value.trim());
  if (!name || phone === null) { error.textContent = t(!name ? 'NAME_INVALID' : 'PHONE_INVALID'); error.hidden = false; return false; }
  const settings = { ...state.settings, backgroundMessages: $('#background-messages').checked, sound: $('#sound-enabled').checked, readReceipts: $('#read-receipts').checked,
    autoLock: Number($('#auto-lock').value), signalUrl: $('#signal-url').value.trim(), accountUrl: $('#account-url').value.trim(),
    turnUrl: $('#turn-url').value.trim(), turnUser: $('#turn-user').value.trim(), turnPassword: $('#turn-password').value };
  try {
    parseSignalingUrl(settings.signalUrl, location.origin); makeIceServers(settings);
    if (settings.accountUrl) settings.accountUrl = accountUrl(settings.accountUrl, location.origin);
    const renamed = name !== state.profile.name;
    if (renamed && state.cloud?.registered) throw new Error('CLOUD_NAME_FIXED');
    const reconnect = renamed || ['signalUrl', 'turnUrl', 'turnUser', 'turnPassword'].some(key => settings[key] !== state.settings[key]);
    const profile = { ...state.profile, name, phone, id: await peerIdForNickname(name), nicknameSetup: true };
    if (phoneVerified()) {
      const discoverable = !renamed && phone === state.profile.phone && settings.accountUrl === state.settings.accountUrl && $('#phone-discoverable').checked;
      if (state.account.account.discoverable !== discoverable) {
        const account = { ...state.account, ...await phoneApi().setDiscoverable(discoverable) };
        if (epoch !== privateEpoch) return false;
        await store.setMeta('account', account); state.account = account;
      }
    }
    if (epoch !== privateEpoch) return false;
    await store.setMeta('settings', settings); await store.setMeta('profile', profile);
    if (epoch !== privateEpoch) return false;
    state.settings = settings; state.profile = profile; configureBackground();
    if (!settings.readReceipts) {
      for (const chat of state.chats) if (chat.pendingRead?.length) await changeChat(chat.id, c => { c.pendingRead = []; });
    }
    $('#profile-button').textContent = initials(name); applyTheme();
    if (reconnect) { state.contactStates.clear(); startNetwork(); } else transport.updateProfile(profile);
    if (!keepOpen) closeDialogs();
    renderSidebar(); renderHeader(); populateSettings();
    notify(renamed ? 'Ник изменён. Сообщите новый адрес контактам.' : 'Ваши настройки сохранены');
    return true;
  } catch (err) { if (epoch !== privateEpoch) return false; error.textContent = t(err.message || 'Не удалось сохранить настройки.'); error.hidden = false; return false; }
}





function exportChats(chats) {
  confirmDialog('Экспорт без шифрования?', 'JSON-файл будет содержать незашифрованный текст переписки. Пароль хранилища его не защищает. Сохраняйте файл только в безопасном месте.', () => doExportChats(chats), 'Экспортировать');
}

function doExportChats(chats) {
  const name = safeFilename(`LIBO-${new Date().toISOString().slice(0, 10)}.json`);
  const data = textExport(chats, state.profile);
  if (data.length > 6_000_000) { notify('Экспорт слишком большой. Экспортируйте каждый чат отдельно.', true); return; }
  if (window.LiboAndroid) window.LiboAndroid.saveText(name, data);
  else {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    notify('Текстовый экспорт подготовлен. Храните файл в безопасном месте.');
  }
}

function closeChatMenu() { $('#chat-menu').hidden = true; $('#chat-more').setAttribute('aria-expanded', 'false'); }
function closeMessageSearch() { $('#message-search-bar').hidden = true; $('#message-search').value = ''; }

async function blockCurrent() {
  const chat = activeChat();
  if (!chat || chat.id === 'saved') return;
  const id = chat.id;
  confirmDialog('Заблокировать контакт?', 'Этот контакт больше не сможет подключиться к вам. Переписка удалится только с этого устройства. Собеседник сохранит свою копию.', async () => {
    try {
      await locks.get(id)?.catch(() => {});
      const blocked = [...new Set([...state.blocked, id])];
      await store.setMeta('blocked', blocked);
      state.blockedNames[id] = chatName(chat); await store.setMeta('blockedNames', state.blockedNames);
      state.blocked = blocked;
      await transport.updateBlocked()?.catch(() => { state.cloudError = 'CLOUD_BLOCK_PENDING'; });
      transport.closeContact(id);
      await store.deleteChat(id);
      state.chats = state.chats.filter(c => c.id !== id);
      closeChat();
      delete state.drafts[id];
      await store.setMeta('drafts', state.drafts);
      notify('Контакт заблокирован');
    } catch { notify('Не удалось завершить блокировку. Проверьте свободное место.', true); }
  }, 'Заблокировать');
}

function renderBlocked() {
  const list = $('#blocked-list'); list.replaceChildren();
  if (!state.blocked.length) { const p = document.createElement('p'); p.className = 'privacy-caption'; p.textContent = t('Нет заблокированных контактов.'); list.appendChild(p); }
  for (const id of state.blocked) {
    const row = document.createElement('div'); row.className = 'blocked-row';
    const code = document.createElement('code'); code.textContent = state.blockedNames[id] || t('Заблокированный контакт');
    const button = document.createElement('button'); button.textContent = t('Разблокировать');
    button.onclick = async () => {
      try { const blocked = state.blocked.filter(item => item !== id); await store.setMeta('blocked', blocked); state.blocked = blocked; await transport.updateBlocked(); renderBlocked(); notify('Контакт разблокирован. Его можно добавить заново.'); }
      catch { notify('Не удалось сохранить изменения.', true); }
    };
    row.append(code, button); list.appendChild(row);
  }
}

async function attachPhoto(file) {
  if (!file || !activeChat() || activeChat().request) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { notify('Поддерживаются фотографии JPG, PNG и WebP.', true); return; }
  if (file.size > 12 * 1024 * 1024) { notify('Выберите фотографию до 12 МБ.', true); return; }
  const generation = ++photoGeneration;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/jpeg', .82);
    if (data.length > MAX_IMAGE_DATA) data = canvas.toDataURL('image/jpeg', .58);
    if (data.length > MAX_IMAGE_DATA) throw new Error('Фото слишком большое даже после сжатия. Попробуйте другое.');
    if (generation !== photoGeneration) return;
    state.attachment = { data, name: safeFilename(file.name.replace(/\.[^.]+$/, '') + '.jpg') };
    $('#attachment-image').src = data; $('#attachment-preview').hidden = false; updateComposer();
  } catch (error) { notify(error.message?.includes('сжатия') ? error.message : 'Не удалось открыть фотографию.', true); }
  finally { URL.revokeObjectURL(url); $('#photo-input').value = ''; }
}

function playMessageSound() {
  if (!state.settings?.sound || state.locking || store.locked || document.hidden || state.background) return;
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state !== 'running') return;
    const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(640, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(820, audioContext.currentTime + .08);
    gain.gain.setValueAtTime(.04, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .16);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + .18);
  } catch { /* Sound is optional; never interrupt messaging when autoplay is blocked. */ }
}

function handleBack() {
  if (store.locked || state.locking || !state.profile?.nicknameSetup) return false;
  const open = $('dialog[open]');
  if (open) { open.close(); return true; }
  if (!$('#emoji-picker').hidden) { $('#emoji-picker').hidden = true; $('#emoji-button').setAttribute('aria-expanded', 'false'); return true; }
  if (!$('#chat-menu').hidden) { closeChatMenu(); return true; }
  if (!$('#message-search-bar').hidden) { closeMessageSearch(); renderMessages(); return true; }
  if (state.current) { closeChat(); return true; }
  return false;
}

function bindEvents() {
  document.addEventListener('click', event => {
    const dialogButton = event.target.closest('[data-dialog]');
    if (dialogButton) { openDialog(dialogButton.dataset.dialog); return; }
    if (event.target.closest('[data-close]')) { event.target.closest('dialog')?.close(); return; }
    const row = event.target.closest('[data-chat-id]');
    if (row) void openChat(row.dataset.chatId);
    if (!event.target.closest('#chat-more, #chat-menu')) closeChatMenu();
    if (state.settings?.sound) {
      try { audioContext ||= new AudioContext(); if (audioContext.state === 'suspended') void audioContext.resume(); } catch { /* Optional. */ }
    }
  });
  $$('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (dialog.id === 'confirm-dialog') confirmAction = null;
      if (dialog.id === 'photo-dialog') $('#full-photo').removeAttribute('src');
      if (dialog.contains($('#toast'))) { $('#toast').hidden = true; document.body.appendChild($('#toast')); }
    });
  });
  $('#confirm-action').onclick = async () => { const action = confirmAction; $('#confirm-dialog').close(); if (action) await action(); };
  $('#add-contact-form').onsubmit = addContact;
  $('#settings-form').onsubmit = saveSettings;
  $('#chat-search').oninput = renderSidebar;
  $('#nav-chats').onclick = closeChat;
  $('#nav-saved').onclick = () => void openChat('saved');
  $('#chat-back').onclick = closeChat;
  for (const type of ['all', 'unread', 'close']) $(`#filter-${type}`).onclick = () => {
    state.filter = type;
    $$('.filter').forEach(button => { const active = button.id === `filter-${type}`; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    renderSidebar();
  };
  $('#composer').onsubmit = sendMessage;
  $('#message-input').addEventListener('input', () => {
    updateComposer(); rememberDraft();
    if (state.current !== 'saved' && Date.now() - typingSentAt > 1000) {
      typingSentAt = Date.now(); transport.send(state.current, { v: 2, type: 'typing', active: !!$('#message-input').value });
    }
  });
  $('#message-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage(); }
  });
  $('#theme-toggle').onclick = () => void setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $$('button[data-theme]').forEach(button => { button.onclick = () => void setTheme(button.dataset.theme); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $('#reconnect').onclick = () => {
    if (state.networkDetail) notify(state.networkDetail, true);
    state.contactStates.clear(); startNetwork();
  };
  $('#chat-more').onclick = () => { const open = $('#chat-menu').hidden; $('#chat-menu').hidden = !open; $('#chat-more').setAttribute('aria-expanded', String(open)); };
  $('#message-search-toggle').onclick = () => { $('#message-search-bar').hidden = false; $('#message-search').focus(); };
  $('#message-search').oninput = () => renderMessages(false);
  $('#close-message-search').onclick = () => { closeMessageSearch(); renderMessages(); };
  $('#export-all').onclick = () => exportChats(state.chats);
  $('#export-chat').onclick = () => { if (activeChat()) exportChats([activeChat()]); closeChatMenu(); };
  $('#manage-blocked').onclick = () => openDialog('blocked-dialog');
  $('#clear-chat').onclick = () => {
    const id = state.current;
    confirmDialog('Очистить этот чат?', 'Сообщения удалятся только с этого устройства. Это нельзя отменить. У собеседника останется его копия переписки.', async () => {
      try {
        await changeChat(id, chat => { chat.messages = []; chat.unread = 0; chat.updatedAt = 0; });
        if (state.current === id) { resetComposerExtras(); renderMessages(); updateComposer(); }
        renderSidebar(); notify('Чат очищен на этом устройстве');
      } catch { notify('Не удалось очистить чат.', true); }
    }, 'Очистить');
  };
  $('#block-contact').onclick = blockCurrent;
  $('#reject-request').onclick = blockCurrent;
  $('#accept-request').onclick = async () => {
    const id = state.current;
    try { await changeChat(id, chat => { chat.request = false; }); renderHeader(); renderSidebar(); visibleSince.clear();
      if (transport.isCloud && state.cloud?.deferred?.some(item => item.peer === id)) { transport.stop(); await updateCloudConfig({ cursor: 0 }); startNetwork(); }
      await flushPending(id); }
    catch { notify('Не удалось принять запрос.', true); }
  };
  $('#messages').onclick = event => {
    const chat = activeChat(); if (!chat) return;
    const replyButton = event.target.closest('[data-reply]');
    const photo = event.target.closest('[data-photo]');
    if (replyButton) {
      if (chat.request) { notify('Сначала примите запрос на общение.', true); return; }
      const message = chat.messages.find(m => m.id === replyButton.dataset.reply);
      if (!message) return;
      state.reply = { text: (message.text || t('Фотография')).slice(0, 160), name: message.direction === 'out' ? state.profile.name : chatName(chat) };
      $('#reply-name').textContent = state.reply.name; $('#reply-text').textContent = state.reply.text; $('#reply-bar').hidden = false; $('#message-input').focus();
    }
    if (photo) {
      const message = chat.messages.find(m => m.id === photo.dataset.photo);
      if (message?.image) { openDialog('photo-dialog'); $('#full-photo').src = message.image.data; }
    }
  };
  $('#cancel-reply').onclick = () => { state.reply = null; $('#reply-bar').hidden = true; };
  $('#attach-button').onclick = () => $('#photo-input').click();
  $('#photo-input').onchange = () => {
    const file = $('#photo-input').files[0];
    if (file && (store.locked || state.locking)) { pendingPickedFile = file; $('#photo-input').value = ''; return; }
    void attachPhoto(file);
  };
  $('#remove-attachment').onclick = () => { photoGeneration++; state.attachment = null; $('#attachment-preview').hidden = true; $('#attachment-image').removeAttribute('src'); updateComposer(); };
  $('#emoji-button').onclick = () => {
    if ($('#emoji-picker').hidden) buildPicker('emoji-picker');
    $('#emoji-picker').hidden = !$('#emoji-picker').hidden;
    $('#emoji-button').setAttribute('aria-expanded', String(!$('#emoji-picker').hidden));
  };
  window.addEventListener('online', () => { if (state.network !== 'ready' && !store.locked && !state.locking) startNetwork(); });
  window.addEventListener('offline', () => { state.network = 'offline'; renderNetwork(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { visibleSince.clear(); if (store.vault) void lockVault(); else void rememberDraft(); }
    else if (!store.locked && !state.locking) { lastActivity = Date.now(); retryConnections(); }
  });
  window.addEventListener('pagehide', () => { if (store.vault) void lockVault(); else { void rememberDraft(); transport.stop(); } });
  window.addEventListener('pageshow', event => { if (event.persisted && !store.locked && !state.locking) startNetwork(); });
  document.addEventListener('keydown', event => {
    if (store.locked || state.locking || !state.profile?.nicknameSetup) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !$('dialog[open]')) { event.preventDefault(); closeChat(); $('#chat-search').focus(); }
    if (event.key === 'Escape' && !$('dialog[open]')) handleBack();
  });
  window.Libo = { handleBack, onExportSaved: () => notify('Экспорт сохранён'), onBackground: () => { state.background = true; if (store.vault) void lockVault(); }, onForeground: () => { state.background = false; lastActivity = Date.now(); if (!store.locked && !state.locking) { renderNotificationSettings(); void transport.sync(); } }, onNotificationPermission: () => { if (!store.locked && !state.locking) renderNotificationSettings(); } };
  bindNewFeatures(); bindFeatures23();
}

async function main() {
  $('#shell').hidden = true; translateStatic();
  await claimProfileWindow();
  await store.open(); bindEvents(); window.LiboAndroid?.setLanguage?.(language());
  if (store.locked) showLockScreen(); else await loadUser();
  setInterval(retryConnections, 6000);
  setInterval(() => { void trackVisibleMessages(); if (store.vault && !store.locked && !state.locking && Date.now() - lastActivity > (state.settings?.autoLock || 5) * 60_000) void lockVault(); }, 350);
}


main().catch(error => {
  const banner = $('#boot-error');
  banner.hidden = false;
  banner.textContent = t(['ANOTHER_WINDOW', 'WEBVIEW_UPDATE_REQUIRED'].includes(error.message) ? error.message : 'BOOT_FAILED');
  console.error('LIBO startup failed', error);
});

function startNetwork() {
  if (store.locked || state.locking || !state.profile?.nicknameSetup || !state.identity) return;
  transport.start(state.profile, state.settings, state.identity, state.cloud);
}

async function loadUser() {
  const epoch = privateEpoch;
  const profile = await store.getMeta('profile') || { name: '', phone: '' };
  const defaultServer = import.meta.env.DEV ? new URL('/peerjs', location.origin).href : 'https://0.peerjs.com';
  const defaultAccounts = import.meta.env.VITE_ACCOUNT_SERVER || (import.meta.env.DEV ? new URL('/api', location.origin).href : '');
  const settings = { theme: 'light', sound: false, readReceipts: true, autoLock: 5, appearance: normalizeAppearance(), cloudEnabled: false, cloudUrl: import.meta.env.VITE_CLOUD_URL || '', backgroundMessages: false,
    signalUrl: defaultServer, accountUrl: defaultAccounts, turnUrl: '', turnUser: '', turnPassword: '', ...await store.getMeta('settings') };
  let identity = await store.getMeta('identity');
  if (!identity) { identity = await createIdentity(); if (epoch !== privateEpoch) throw new Error('VAULT_LOCKED'); await store.setMeta('identity', identity); }
  const identityFingerprint = await fingerprint(identity.publicKey);
  const cloud = await store.getMeta('cloudConfig') || null;
  const account = await store.getMeta('account') || null;
  const blocked = await store.getMeta('blocked') || [];
  const blockedNames = await store.getMeta('blockedNames') || {};
  const chats = (await store.getChats()).filter(chat => !blocked.includes(chat.id));
  let drafts = await store.getMeta('drafts') || {};
  const lastChat = await store.getMeta('lastChat');
  // Move the previous beta's plaintext drafts before a vault is enabled.
  const oldDrafts = localStorage.getItem('libo-v2-drafts');
  if (oldDrafts) {
    try { drafts = { ...JSON.parse(oldDrafts), ...drafts }; } catch {}
    await store.setMeta('drafts', drafts); localStorage.removeItem('libo-v2-drafts');
  }
  if (epoch !== privateEpoch || store.locked || state.locking) throw new Error('VAULT_LOCKED');
  Object.assign(state, { profile, settings, identity, identityFingerprint, account, cloud, blocked, blockedNames, chats, drafts });
  if (!state.chats.some(chat => chat.id === 'saved')) await changeChat('saved', chat => { chat.name = 'Избранное'; }, { request: false });
  if (epoch !== privateEpoch || store.locked || state.locking) throw new Error('VAULT_LOCKED');
  applyTheme(); translateStatic(); window.LiboAndroid?.setSecureWindow?.(!!store.vault);
  if (!profile.nicknameSetup || !normalizeNickname(profile.name)) {
    $('#shell').hidden = true; $('#lock-screen').hidden = true; $('#onboarding').hidden = false;
    $('#onboarding-name').value = normalizeNickname(profile.name) || '';
    $('#onboarding-phone').value = profile.phone || ''; $('#onboarding-name').focus(); return;
  }
  if (profile.id !== await peerIdForNickname(profile.name)) throw new Error('PROFILE_INVALID');
  if (epoch !== privateEpoch || store.locked || state.locking) throw new Error('VAULT_LOCKED');
  activate();
  if (lastChat && state.chats.some(c => c.id === lastChat)) await openChat(lastChat);
  if (pendingPickedFile && activeChat()) { const file = pendingPickedFile; pendingPickedFile = null; await attachPhoto(file); }
  if (pendingAppearanceFile) { const file = pendingAppearanceFile; pendingAppearanceFile = null; await selectAppearancePhoto(file); }
  if (pendingRecoveryFile) { const file = pendingRecoveryFile; pendingRecoveryFile = null; await restoreCloudFile(file); }
}

function activate() {
  $('#lock-screen').hidden = true; $('#onboarding').hidden = true; $('#shell').hidden = false;
  $('#unlock-password').value = ''; $('#profile-button').textContent = initials(state.profile.name);
  $('#app-version').textContent = VERSION; lastActivity = Date.now();
  renderSidebar(); renderNetwork(); renderCloud(); startNetwork();
}

async function submitOnboarding(event) {
  event.preventDefault(); const error = $('#onboarding-error'); error.hidden = true;
  const name = normalizeNickname($('#onboarding-name').value), phone = normalizePhone($('#onboarding-phone').value.trim());
  if (!name || phone === null) { error.textContent = t(!name ? 'NAME_INVALID' : 'PHONE_INVALID'); error.hidden = false; return; }
  $('#onboarding-submit').disabled = true;
  try {
    const profile = { name, phone, nicknameSetup: true, id: await peerIdForNickname(name) };
    await store.setMeta('profile', profile); state.profile = profile; activate();
  } catch (err) { error.textContent = t(err.message || 'PROFILE_INVALID'); error.hidden = false; }
  finally { $('#onboarding-submit').disabled = false; }
}

async function trackVisibleMessages() {
  const chat = activeChat();
  if (markingRead || state.locking || store.locked || state.background || document.hidden || !document.hasFocus() || $('dialog[open]') || !chat || chat.request || chat.id === 'saved') {
    visibleSince.clear(); return;
  }
  const box = $('#messages'), boundary = box.getBoundingClientRect();
  if (boundary.height < 40 || $('#conversation').hidden) { visibleSince.clear(); return; }
  const now = Date.now(), visible = new Set(), ready = [];
  const unseen = new Set(chat.messages.filter(m => m.direction === 'in' && !m.seenAt).map(m => m.id));
  for (const element of box.querySelectorAll('.incoming[data-message-id]')) {
    const id = element.dataset.messageId;
    if (!unseen.has(id)) continue;
    const rect = element.getBoundingClientRect();
    const height = Math.min(rect.bottom, boundary.bottom, innerHeight) - Math.max(rect.top, boundary.top, 0);
    if (height < Math.min(rect.height, boundary.height) * .75) continue;
    visible.add(id);
    if (!visibleSince.has(id)) visibleSince.set(id, now);
    if (now - visibleSince.get(id) >= 650) ready.push(id);
  }
  for (const id of visibleSince.keys()) if (!visible.has(id)) visibleSince.delete(id);
  if (!ready.length) return;
  const id = chat.id, keys = new Set(ready), sendReceipts = !!state.settings.readReceipts;
  markingRead = true;
  try {
    await changeChat(id, next => {
      // This durable state is independent from the transport connection and delivery ACKs.
      next.messages = next.messages.map(m => keys.has(m.id) && m.direction === 'in' && !m.seenAt ? { ...m, seenAt: now } : m);
      next.unread = next.messages.filter(m => m.direction === 'in' && !m.seenAt).length;
      if (sendReceipts) next.pendingRead = [...new Set([...(next.pendingRead || []), ...ready])].slice(-1000);
    });
    ready.forEach(key => visibleSince.delete(key)); renderSidebar(); await flushReads(id);
  } catch { if (!state.locking) notify('Не удалось сохранить отметку прочтения.', true); }
  finally { markingRead = false; }
}

async function flushReads(id) {
  if (state.locking || store.locked || !state.settings?.readReceipts || !transport.isOpen(id)) return;
  const chat = state.chats.find(c => c.id === id);
  if (!chat || chat.request) return;
  const pending = (chat.pendingRead || []).filter(key => Date.now() - (lastReadSent.get(key) || 0) > 15_000);
  for (let i = 0; i < pending.length; i += 100) {
    const ids = pending.slice(i, i + 100);
    if (await transport.send(id, { v: 2, type: 'read', ids })) ids.forEach(key => lastReadSent.set(key, Date.now()));
  }
}

function renderContacts() {
  const list = $('#contacts-list'); list.replaceChildren();
  const query = $('#contacts-search').value.trim().toLocaleLowerCase(locale());
  const contacts = state.chats.filter(chat => chat.id !== 'saved' && !chat.request && chat.addressVersion === 2)
    .filter(chat => (state.contactsFilter !== 'close' || chat.close) && `${chatName(chat)} ${chat.name} ${chat.phone || ''}`.toLocaleLowerCase(locale()).includes(query))
    .sort((a, b) => Number(!!b.close) - Number(!!a.close) || chatName(a).localeCompare(chatName(b), locale()));
  for (const chat of contacts) {
    const row = document.createElement('div'); row.className = 'contact-entry';
    const open = document.createElement('button'); open.className = 'contact-open';
    const avatar = document.createElement('span'); avatar.className = `avatar ${avatarColor(chat.id)}`; avatar.textContent = initials(chatName(chat));
    const details = document.createElement('span'); details.className = 'contact-details';
    const name = document.createElement('strong'); name.textContent = chatName(chat);
    const address = document.createElement('small'); address.textContent = `@${chat.name}${chat.phone ? ` · ${chat.phone}` : ''}`;
    details.append(name, address); open.append(avatar, details); open.onclick = () => { closeDialogs(); void openChat(chat.id); };
    const favorite = document.createElement('button'); favorite.className = `icon-button${chat.close ? ' close-person' : ''}`;
    favorite.innerHTML = svg('star'); favorite.title = t(chat.close ? 'Убрать из близких' : 'Добавить в близкие'); favorite.setAttribute('aria-label', favorite.title);
    favorite.setAttribute('aria-pressed', String(!!chat.close)); favorite.onclick = () => void toggleClose(chat.id);
    const edit = document.createElement('button'); edit.className = 'icon-button'; edit.innerHTML = svg('edit'); edit.title = t('Изменить контакт'); edit.setAttribute('aria-label', edit.title);
    edit.onclick = () => editContact(chat.id); row.append(open, favorite, edit); list.appendChild(row);
  }
  if (!contacts.length) { const empty = document.createElement('p'); empty.className = 'privacy-caption'; empty.textContent = t(state.contactsFilter === 'close' ? 'Отметьте важные контакты звездой.' : 'Добавьте контакт по нику и начните разговор.'); list.appendChild(empty); }
  for (const filter of ['all', 'close']) { const button = $(`#contacts-${filter}`); button.classList.toggle('selected', state.contactsFilter === filter); button.setAttribute('aria-pressed', String(state.contactsFilter === filter)); }
}

async function toggleClose(id) {
  try { await changeChat(id, chat => { chat.close = !chat.close; }); renderSidebar(); renderHeader(); if ($('#contacts-dialog').open) renderContacts(); }
  catch { notify('Не удалось сохранить контакт. Проверьте свободное место.', true); }
}

function editContact(id) {
  const chat = state.chats.find(c => c.id === id); if (!chat) return;
  openDialog('new-dialog'); state.editing = id; $('#contact-modal-title').textContent = t('Изменить контакт');
  $('#contact-nick').value = `@${chat.name}`; $('#contact-nick').disabled = true;
  $('#contact-label').value = chat.alias || ''; $('#contact-phone').value = chat.phone || ''; $('#contact-close').checked = !!chat.close;
  $('#contact-label').focus();
}

function buildPicker(id, channel = false) {
  const host = $(`#${id}`); host.replaceChildren();
  host.appendChild(createEmojiPicker({ language: language(), theme: document.documentElement.dataset.theme || 'light', onSelect: emoji => {
    if (channel && (!activeChat() || activeChat().request)) { void copyText(emoji.native); return; }
    const input = $('#message-input'); if (input.value.length + emoji.native.length > MAX_TEXT) return;
    input.setRangeText(emoji.native, input.selectionStart, input.selectionEnd, 'end');
    if (channel) closeDialogs(); input.focus(); updateComposer(); void rememberDraft();
  } }));
}

async function copyText(text) {
  try { if (window.LiboAndroid) window.LiboAndroid.copyText(text); else await navigator.clipboard.writeText(text); notify('Скопировано'); }
  catch { notify('Не удалось скопировать текст.', true); }
}

function updateLanguage(value) {
  setLanguage(value); translateStatic();
  if (!store.locked && !state.locking && state.profile?.nicknameSetup) {
    renderSidebar(); renderHeader(); renderMessages(false); renderNetwork();
    if ($('#contacts-dialog').open) renderContacts();
    if ($('#blocked-dialog').open) renderBlocked();
    if ($('#settings-dialog').open) populateSettings();
    if ($('#cloud-dialog').open) renderCloud();
    if ($('#security-dialog').open) populateSecurity();
    if ($('#emoji-channel').open) buildPicker('channel-picker', true);
    if (!$('#emoji-picker').hidden) buildPicker('emoji-picker');
  }
  window.LiboAndroid?.setLanguage?.(language());
}

function phoneVerified() {
  const a = state.account;
  return !!(a?.token && a.base === state.settings?.accountUrl && a.expiresAt > Date.now() && a.account?.verified &&
    a.account.phone === state.profile?.phone && a.account.name === state.profile?.name && a.account.fingerprint === state.identityFingerprint);
}
function phoneApi() {
  if (!state.settings?.accountUrl) throw new Error('ACCOUNT_SERVER_REQUIRED');
  return new PhoneApi(state.settings.accountUrl, state.account?.base === state.settings.accountUrl ? state.account.token : '');
}

async function openPhoneVerification() {
  if (!await saveSettings(null, true)) return;
  if (!state.profile.phone) { notify('PHONE_INVALID', true); return; }
  if (!state.settings.accountUrl) { notify('SMS_NOT_CONFIGURED', true); return; }
  openDialog('phone-dialog'); smsChallenge = null;
  $('#sms-phone').value = state.profile.phone; $('#sms-error').hidden = true; $('#sms-code-form').hidden = true;
  $('#sms-request-form').hidden = false; $('#sms-consent').checked = false; $('#sms-code').value = '';
}

async function requestSms(event) {
  event.preventDefault(); $('#sms-send').disabled = true; $('#sms-error').hidden = true;
  try {
    const phone = state.profile.phone, name = state.profile.name;
    const challenge = await phoneApi().start(phone);
    if (store.locked || state.locking || !$('#phone-dialog').open || phone !== state.profile?.phone || name !== state.profile?.name) return;
    smsChallenge = { ...challenge, phone, name };
    $('#sms-request-form').hidden = true; $('#sms-code-form').hidden = false; $('#sms-code').focus();
  } catch (error) { $('#sms-error').textContent = t(error.message || 'SMS_PROVIDER_ERROR'); $('#sms-error').hidden = false; }
  finally { $('#sms-send').disabled = false; }
}

async function verifySms(event) {
  event.preventDefault(); if (!smsChallenge || !state.identity) return;
  const challenge = smsChallenge; $('#sms-verify').disabled = true; $('#sms-error').hidden = true;
  try {
    if (challenge.phone !== state.profile.phone || challenge.name !== state.profile.name) throw new Error('SMS_CHALLENGE_INVALID');
    const result = await phoneApi().verify(challenge, challenge.phone, challenge.name, $('#sms-code').value.trim(), state.identity, false);
    if (store.locked || state.locking || smsChallenge !== challenge) return;
    if (result.account.phone !== state.profile.phone || result.account.name !== state.profile.name || result.account.fingerprint !== state.identityFingerprint) throw new Error('CRYPTO_INVALID');
    state.account = { ...result, base: state.settings.accountUrl, expiresAt: Date.now() + 30 * 86400_000 };
    await store.setMeta('account', state.account); smsChallenge = null; $('#sms-code').value = '';
    openDialog('settings-dialog'); notify('Номер подтверждён. Поиск по номеру можно включить в профиле.');
  } catch (error) { $('#sms-error').textContent = t(error.message || 'SMS_PROVIDER_ERROR'); $('#sms-error').hidden = false; }
  finally { $('#sms-verify').disabled = false; }
}

function removePhoneAccount() {
  confirmDialog('Удалить телефонный аккаунт?', 'Номер и запись для поиска удалятся с настроенного сервера. Чаты и контакты останутся на этом устройстве. Историю SMS у провайдера это не удаляет.', async () => {
    try {
      const epoch = privateEpoch;
      await new PhoneApi(state.account.base, state.account.token).remove();
      if (epoch !== privateEpoch) return;
      state.account = null;
      await store.setMeta('account', null); state.profile = { ...state.profile, phone: '' }; await store.setMeta('profile', state.profile);
      notify('Телефонный аккаунт удалён');
    } catch (error) { notify(error.message, true); }
  }, 'Удалить');
}

function renderVaultSettings() {
  $('#vault-status').textContent = t(store.vault ? 'История: AES‑256‑GCM, защита паролем включена' : 'История пока не защищена отдельным паролем');
  $('#vault-enable').hidden = !!store.vault;
  for (const id of ['vault-lock', 'vault-change', 'vault-disable']) $(`#${id}`).hidden = !store.vault;
  $('#auto-lock').disabled = !store.vault;
}

function openVaultForm(mode) {
  vaultMode = mode; openDialog('vault-password-dialog'); $('#vault-password-form').reset(); $('#vault-error').hidden = true;
  $('#vault-form-note').textContent = t(mode === 'disable' ? 'История будет храниться без отдельного шифрования. Введите текущий пароль, чтобы отключить её защиту.' : 'AES‑256‑GCM защищает чаты, контакты, ключи, телефон и настройки на этом устройстве. Восстановления забытого пароля нет.');
  $('#vault-form-title').textContent = t({ enable: 'Защитить историю паролем', change: 'Сменить пароль', disable: 'Отключить защиту истории' }[mode]);
  $('#vault-current-fields').hidden = mode === 'enable'; $('#vault-current').required = mode !== 'enable';
  $('#vault-new-fields').hidden = mode === 'disable'; $('#vault-new').required = mode !== 'disable'; $('#vault-repeat').required = mode !== 'disable';
  $(mode === 'enable' ? '#vault-new' : '#vault-current').focus();
}

async function saveVault(event) {
  event.preventDefault(); const error = $('#vault-error'); error.hidden = true; $('#vault-apply').disabled = true;
  try {
    if (vaultMode !== 'disable' && $('#vault-new').value !== $('#vault-repeat').value) throw new Error('PASSWORD_MISMATCH');
    await rememberDraft();
    if (vaultMode !== 'enable') await store.unlock($('#vault-current').value);
    await store.migrate($('#vault-new').value, vaultMode === 'disable');
    window.LiboAndroid?.setSecureWindow?.(!!store.vault);
    closeDialogs(); notify('Защита истории обновлена');
    if (document.hidden || state.background) await lockVault();
  } catch (err) { error.textContent = t(err.message || 'STORAGE_FAILED'); error.hidden = false; }
  finally { $('#vault-password-form').reset(); $('#vault-apply').disabled = false; }
}

function showLockScreen() {
  $('#shell').hidden = true; $('#onboarding').hidden = true; $('#lock-screen').hidden = false;
  $('#unlock-password').value = ''; $('#unlock-error').hidden = true;
  window.LiboAndroid?.setSecureWindow?.(true);
}

async function lockVault() {
  if (!store.vault || state.locking) return;
  if (store.locked) { privateEpoch++; showLockScreen(); return; }
  const draft = rememberDraft();
  const lastChat = store.setMeta('lastChat', state.current).catch(() => {});
  state.locking = true; privateEpoch++;
  transport.stop(); visibleSince.clear(); closeDialogs(); resetComposerExtras(); clearPrivateWallpaper(); appearanceDraft = null; appearanceChatId = null; appearanceScope = 'global';
  showLockScreen(); $('#unlock-submit').disabled = true; $('#unlock-password').disabled = true;
  // Clear private DOM immediately, then drain writes before dropping the non-extractable vault keys.
  for (const id of ['messages', 'chat-list', 'contacts-list', 'blocked-list', 'emoji-picker', 'channel-picker']) $(`#${id}`).replaceChildren();
  for (const id of ['chat-title', 'chat-presence', 'reply-name', 'reply-text', 'peer-fingerprint', 'my-fingerprint', 'composer-hint']) $(`#${id}`).textContent = '';
  for (const el of $$('input,textarea')) { el.value = ''; if (el.type === 'checkbox') el.checked = false; }
  $('#profile-button').textContent = '?'; $('#settings-avatar').textContent = '?'; $('#full-photo').removeAttribute('src');
  $('#toast').hidden = true; smsChallenge = null;
  await draft; await lastChat; await Promise.allSettled([...locks.values()]); await store.lock();
  state.chats = []; state.drafts = {}; state.blocked = []; state.blockedNames = {};
  state.profile = null; state.identity = null; state.account = null; state.cloud = null; state.settings = null; state.identityFingerprint = '';
  state.current = null; state.reply = null; state.attachment = null; state.typing.clear(); state.contactStates.clear(); state.cryptoErrors.clear();
  lastSent.clear(); lastReadSent.clear(); state.locking = false;
  $('#conversation').hidden = true; $('#welcome').hidden = false; $('#shell').classList.remove('chat-open');
  $('#unlock-submit').disabled = false; $('#unlock-password').disabled = false;
  if (!store.vault) { $('#lock-screen').hidden = true; await loadUser(); return; }
  if (!document.hidden && !state.background) $('#unlock-password').focus();
}

async function unlockVault(event) {
  event.preventDefault(); if (state.locking) return;
  const epoch = privateEpoch;
  $('#unlock-submit').disabled = true; $('#unlock-error').hidden = true;
  try {
    await store.unlock($('#unlock-password').value); $('#unlock-password').value = '';
    if (epoch !== privateEpoch || document.hidden || state.background) { await store.lock(); showLockScreen(); return; }
    await loadUser();
  } catch (error) { $('#unlock-error').textContent = t(error.message || 'PASSWORD_WRONG'); $('#unlock-error').hidden = false; }
  finally { $('#unlock-submit').disabled = false; }
}

function populateSecurity() {
  const chat = activeChat(); if (!chat) return;
  const format = value => value ? value.match(/.{1,4}/g).join(' ') : t('Ключ появится после подключения собеседника');
  $('#my-fingerprint').textContent = format(state.identityFingerprint);
  $('#peer-fingerprint').textContent = format(chat.peerFingerprint);
  $('#key-state').textContent = t(state.cryptoErrors.get(chat.id) === 'CRYPTO_KEY_CHANGED' ? 'CRYPTO_KEY_CHANGED' : chat.keyVerified ? 'Ключ собеседника проверен' : 'Первое подключение: доверие при первом использовании. Сверьте ключи.');
  $('#verify-key').disabled = !chat.peerFingerprint || state.cryptoErrors.get(chat.id) === 'CRYPTO_KEY_CHANGED';
}

function resetPeerKey() {
  const id = state.current;
  confirmDialog('Сбросить доверие к ключу?', 'Это может быть переустановка приложения или подмена собеседника. Сначала свяжитесь с ним по доверенному каналу. Новый ключ не будет считаться проверенным.', async () => {
    try {
      transport.closeContact(id);
      await changeChat(id, chat => { chat.peerFingerprint = null; chat.peerPublicKey = null; chat.expectedFingerprint = null; chat.keyVerified = false; chat.phoneVerified = false; });
      state.cryptoErrors.delete(id);
      await transport.connect(id);
      if (transport.isCloud && state.cloud?.deferred?.some(item => item.peer === id)) { transport.stop(); await updateCloudConfig({ cursor: 0 }); startNetwork(); }
      renderHeader();
    } catch { notify('Не удалось сохранить изменения.', true); }
  }, 'Сбросить доверие');
}

function bindNewFeatures() {
  $('#onboarding-form').onsubmit = submitOnboarding; $('#unlock-form').onsubmit = unlockVault;
  $('#contacts-search').oninput = renderContacts;
  $('#contacts-all').onclick = () => { state.contactsFilter = 'all'; renderContacts(); };
  $('#contacts-close').onclick = () => { state.contactsFilter = 'close'; renderContacts(); };
  $('#chat-favorite').onclick = () => void toggleClose(state.current);
  $('#edit-contact').onclick = () => editContact(state.current);
  $('#chat-security').onclick = () => { openDialog('security-dialog'); populateSecurity(); };
  $('#verify-key').onclick = async () => {
    const chat = activeChat(); if (!chat?.peerFingerprint || state.cryptoErrors.get(chat.id) === 'CRYPTO_KEY_CHANGED') return;
    try { await changeChat(chat.id, next => { next.keyVerified = true; }); populateSecurity(); renderHeader(); notify('Ключ отмечен как проверенный'); }
    catch { notify('Не удалось сохранить изменения.', true); }
  };
  $('#reset-key').onclick = resetPeerKey;
  $('#phone-verify').onclick = () => void openPhoneVerification();
  $('#sms-request-form').onsubmit = requestSms; $('#sms-code-form').onsubmit = verifySms;
  $('#phone-remove').onclick = removePhoneAccount;
  $('#profile-phone').oninput = () => { $('#phone-status').textContent = t('Не подтверждён'); $('#phone-status').classList.remove('verified'); $('#phone-discoverable').disabled = true; };
  $('#vault-enable').onclick = () => openVaultForm('enable'); $('#vault-change').onclick = () => openVaultForm('change');
  $('#vault-disable').onclick = () => openVaultForm('disable'); $('#vault-lock').onclick = () => void lockVault();
  $('#vault-password-form').onsubmit = saveVault;
  $('#vault-password-dialog').addEventListener('close', () => $('#vault-password-form').reset());
  $('#phone-dialog').addEventListener('close', () => { $('#sms-code').value = ''; smsChallenge = null; });
  for (const event of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(event, () => { lastActivity = Date.now(); }, { passive: true });
  $$('#app-language,.gate-language').forEach(select => { select.onchange = () => updateLanguage(select.value); });
  $('#download-emoji-pack').onclick = downloadEmojiPack;
  $('#licenses-button').onclick = async () => {
    openDialog('licenses-dialog');
    try { $('#licenses-text').textContent = await (await fetch('./third-party-notices.txt')).text(); }
    catch { $('#licenses-text').textContent = t('Не удалось открыть уведомления.'); }
  };
}


async function claimProfileWindow() {
  // A live exclusive browser lease prevents another tab from writing stale plaintext
  // during a vault migration. Android already has a single bundled WebView.
  if (!navigator.locks) throw new Error('WEBVIEW_UPDATE_REQUIRED');
  await new Promise((resolve, reject) => {
    navigator.locks.request('libo-profile-window-v2', { ifAvailable: true }, lock => {
      if (!lock) { reject(new Error('ANOTHER_WINDOW')); return; }
      resolve(); return new Promise(() => {});
    }).catch(reject);
  });
}

function updateCloudConfig(patch) {
  const epoch = privateEpoch;
  const task = cloudConfigTail.catch(() => {}).then(async () => {
    if (epoch !== privateEpoch || state.locking || store.locked || !state.cloud) throw new Error('CLOUD_STOPPED');
    const next = { ...state.cloud, ...(typeof patch === 'function' ? patch(state.cloud) : patch) };
    await store.setMeta('cloudConfig', next);
    if (epoch !== privateEpoch || state.locking || store.locked) throw new Error('CLOUD_STOPPED');
    state.cloud = next; return next;
  });
  cloudConfigTail = task.then(() => undefined, () => undefined); return task;
}

function renderCloud() {
  const enabled = !!state.settings?.cloudEnabled, ready = enabled && transport.isCloud && state.network === 'ready';
  const title = !enabled ? 'CLOUD_NOT_CONFIGURED_SHORT' : ready ? 'CLOUD_CONNECTED_SHORT' : state.network === 'connecting' ? 'CLOUD_CONNECTING_SHORT' : 'CLOUD_OFFLINE_SHORT';
  $('#history-feature-title').textContent = t(enabled ? 'CLOUD_HISTORY_LABEL' : 'История у вас');
  $('#history-feature-note').textContent = t(enabled ? 'CLOUD_HISTORY_NOTE' : 'LOCAL_HISTORY_NOTE');
  $('#welcome-delivery-note').textContent = t(enabled ? 'CLOUD_WELCOME_NOTE' : 'Для переписки откройте LIBO на обоих устройствах.');
  $('#cloud-sidebar-status').textContent = t(title); $('#cloud-state-title').textContent = t(title);
  $('#cloud-state-dot').classList.toggle('ready', ready);
  $('#cloud-state-detail').textContent = t(state.cloud?.deferred?.length ? 'CLOUD_DEFERRED_HELP' : state.cloudError || (enabled ? state.networkDetail || (ready ? 'CLOUD_SERVER_READY_HELP' : 'CLOUD_SERVER_WAIT_HELP') : 'CLOUD_SETUP_HELP'));
  $('#cloud-recovery-open').disabled = !state.cloud?.recoverySecret;
  $('#cloud-resync').disabled = !ready;
  $('#cloud-delete-account').disabled = !state.cloud?.registered;
}

function populateCloud() {
  $('#cloud-url').value = state.settings.cloudUrl || (import.meta.env.DEV ? new URL('/api/cloud', location.origin).href : '');
  $('#cloud-enabled').checked = !!state.settings.cloudEnabled; $('#cloud-error').hidden = true;
  $('#cloud-save').disabled = cloudSetupBusy; renderCloud();
}

async function saveCloud(event) {
  event.preventDefault(); $('#cloud-error').hidden = true;
  try {
    const enabled = $('#cloud-enabled').checked;
    const url = $('#cloud-url').value.trim() ? accountUrl($('#cloud-url').value.trim(), location.origin) : '';
    if (enabled && !url) throw new Error('CLOUD_NOT_CONFIGURED');
    if (state.cloud?.registered && state.cloud.server && state.cloud.server !== url && enabled) {
      confirmDialog('CLOUD_CHANGE_SERVER_TITLE', 'CLOUD_CHANGE_SERVER_WARNING', () => applyCloudConnection(url, enabled), 'Продолжить'); return;
    }
    await applyCloudConnection(url, enabled);
  } catch (error) { $('#cloud-error').textContent = t(error.message); $('#cloud-error').hidden = false; $('#cloud-save').disabled = false; }
}

async function applyCloudConnection(url, enabled) {
  const epoch = privateEpoch; cloudSetupBusy = !!enabled; $('#cloud-save').disabled = !!enabled;
  try {
    let cloud = state.cloud;
    if (enabled && !cloud?.mailbox) cloud = { mailbox: await createMailbox(), recoverySecret: random64(32), deviceId: crypto.randomUUID(), cursor: 0, registered: false, recoverySaved: false };
    if (cloud && cloud.server && cloud.server !== url) cloud = { ...cloud, token: '', notificationToken: '', cursor: 0, registered: false };
    if (epoch !== privateEpoch || state.locking || store.locked) return;
    const settings = { ...state.settings, cloudEnabled: enabled, cloudUrl: url, backgroundMessages: enabled ? state.settings.backgroundMessages : false };
    await store.setManyMeta({ settings, cloudConfig: cloud });
    if (epoch !== privateEpoch || state.locking || store.locked) return;
    window.LiboAndroid?.configureBackground?.(JSON.stringify({ enabled: false }));
    state.settings = settings; state.cloud = cloud; state.cloudError = ''; state.contactStates.clear(); startNetwork();
    renderCloud(); renderHeader();
    if (!enabled) { cloudSetupBusy = false; $('#cloud-save').disabled = false; closeDialogs(); notify('CLOUD_DISABLED'); }
  } catch (error) {
    cloudSetupBusy = false; $('#cloud-save').disabled = false;
    if (epoch === privateEpoch) { $('#cloud-error').textContent = t(error.message); $('#cloud-error').hidden = false; }
  }
}

async function flushDeliveryAcks(id) {
  if (!transport.isCloud || store.locked || state.locking || !transport.isOpen(id)) return;
  if (deliveryAckJobs.has(id)) return deliveryAckJobs.get(id);
  const epoch = privateEpoch;
  const job = (async () => {
    const chat = state.chats.find(c => c.id === id); if (!chat) return;
    for (const messageId of (chat.pendingDeliveryAck || []).slice(0, 100)) {
      if (epoch !== privateEpoch || store.locked || state.locking) return;
      if (await transport.send(id, { v: 2, type: 'ack', id: messageId })) await changeChat(id, next => { next.pendingDeliveryAck = (next.pendingDeliveryAck || []).filter(value => value !== messageId); });
    }
  })().catch(() => { /* Durable queue retries on the next connection. */ });
  deliveryAckJobs.set(id, job);
  try { await job; } finally { if (deliveryAckJobs.get(id) === job) deliveryAckJobs.delete(id); }
}

function saveLocalJson(filename, value) {
  const text = JSON.stringify(value, null, 2);
  if (window.LiboAndroid?.saveText) { window.LiboAndroid.saveText(filename, text); return; }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadRecovery() {
  if (!state.cloud?.recoverySecret || store.locked || state.locking) return;
  saveLocalJson('LIBO-Recovery-Key.json', { liboRecovery: 23, server: state.settings.cloudUrl || state.cloud.server, name: state.profile.name, secret: state.cloud.recoverySecret });
}

async function restoreCloudFile(file) {
  if (!file) return;
  if (store.locked || state.locking) { pendingRecoveryFile = file; return; }
  const epoch = privateEpoch;
  try {
    if (file.size > 20000) throw new Error('RECOVERY_INVALID');
    const info = JSON.parse(await file.text());
    if (info.liboRecovery !== 23 || typeof info.secret !== 'string') throw new Error('RECOVERY_INVALID');
    const server = accountUrl(info.server, location.origin), api = new CloudApi(server);
    const backup = (await api.recover(await recoveryId(info.secret))).backup;
    const restored = await openRecoveryBackup(info.secret, backup);
    if (epoch !== privateEpoch || state.locking || store.locked) return;
    if (state.profile?.nicknameSetup && state.profile.id !== restored.profile.id && state.chats.some(c => c.messages.length)) throw new Error('RECOVERY_PROFILE_CONFLICT');
    const finish = async () => {
      if (epoch !== privateEpoch || store.locked || state.locking) return;
      transport.stop(); window.LiboAndroid?.configureBackground?.(JSON.stringify({ enabled: false }));
      const profile = { ...restored.profile, nicknameSetup: true, phone: state.profile?.id === restored.profile.id ? state.profile.phone || '' : '' };
      const cloud = { mailbox: restored.mailbox, recoverySecret: info.secret, deviceId: crypto.randomUUID(), cursor: 0, registered: true, boundId: profile.id, recoverySaved: true, server };
      const settings = { ...state.settings, cloudEnabled: true, cloudUrl: server, backgroundMessages: false };
      await store.setManyMeta({ profile, identity: restored.identity, cloudConfig: cloud, settings });
      if (epoch !== privateEpoch || store.locked || state.locking) return;
      Object.assign(state, { profile, identity: restored.identity, identityFingerprint: await fingerprint(restored.identity.publicKey), cloud, settings, cloudError: '' });
      closeDialogs(); activate(); notify('RECOVERY_RESTORED');
    };
    if (state.profile?.nicknameSetup) confirmDialog('RECOVERY_CONFIRM_TITLE', 'RECOVERY_CONFIRM_WARNING', finish, 'Продолжить');
    else await finish();
  } catch (error) { if (epoch === privateEpoch) notify(error.message?.startsWith('CLOUD_') || error.message?.startsWith('RECOVERY_') ? error.message : 'RECOVERY_INVALID', true); }
  finally { $('#cloud-recovery-input').value = ''; }
}

function resyncCloudHistory() {
  confirmDialog('CLOUD_RESYNC_TITLE', 'CLOUD_RESYNC_WARNING', async () => {
    try {
      transport.stop();
      for (const chat of state.chats) if (chat.cloudSeen?.length) await changeChat(chat.id, next => { next.cloudSeen = []; });
      await updateCloudConfig({ cursor: 0 }); startNetwork(); notify('CLOUD_RESYNC_STARTED');
    } catch (error) { notify(error.message, true); }
  }, 'Продолжить');
}

function deleteCloudAccount() {
  confirmDialog('CLOUD_DELETE_TITLE', 'CLOUD_DELETE_WARNING', async () => {
    const epoch = privateEpoch;
    try {
      if (!state.cloud?.token) throw new Error('CLOUD_AUTH_REQUIRED');
      await new CloudApi(state.cloud.server, state.cloud.token).removeAccount();
      if (epoch !== privateEpoch) return;
      transport.stop(); window.LiboAndroid?.configureBackground?.(JSON.stringify({ enabled: false }));
      const settings = { ...state.settings, cloudEnabled: false, backgroundMessages: false };
      await store.setManyMeta({ cloudConfig: null, settings }); state.cloud = null; state.settings = settings;
      startNetwork(); renderCloud(); notify('CLOUD_DELETED');
    } catch (error) { notify(error.message, true); }
  }, 'Удалить');
}

function notificationInfo() {
  try { const value = window.LiboAndroid?.notificationStatus?.(); return value ? JSON.parse(value) : { available: false, permission: 'unavailable', running: false }; }
  catch { return { available: false, permission: 'unavailable', running: false }; }
}

function renderNotificationSettings() {
  if (!state.settings || state.locking || store.locked) return;
  const info = notificationInfo();
  $('#notification-state').textContent = t(!info.available ? 'NOTIFICATION_ANDROID_ONLY' : info.permission !== 'granted' ? 'NOTIFICATION_PERMISSION_NEEDED' : info.running ? 'NOTIFICATION_SERVICE_RUNNING' : 'NOTIFICATION_PERMISSION_GRANTED');
  $('#notification-permission').disabled = !info.available;
  $('#notification-permission').textContent = t(info.permission === 'granted' ? 'NOTIFICATION_SYSTEM_SETTINGS' : 'NOTIFICATION_ALLOW');
  $('#background-messages').disabled = !info.available || info.permission !== 'granted' || !state.settings.cloudEnabled || !state.cloud?.registered;
  $('#battery-settings').hidden = !info.available;
}

function configureBackground() {
  if (!window.LiboAndroid?.configureBackground || !state.settings || !state.profile || store.locked || state.locking) return;
  const enabled = !!(state.settings.cloudEnabled && state.settings.backgroundMessages && state.cloud?.notificationToken && state.cloud.server === state.settings.cloudUrl && notificationInfo().permission === 'granted');
  window.LiboAndroid.configureBackground(JSON.stringify(enabled ? { enabled, server: state.cloud.server, token: state.cloud.notificationToken, owner: state.profile.id, cursor: state.cloud.notificationCursor || 0 } : { enabled: false }));
  renderNotificationSettings();
}

function openAppearance(scope = 'global', chatId = state.current) {
  if (store.locked || state.locking) return;
  if (scope === 'chat' && !state.chats.some(c => c.id === chatId)) return;
  appearanceScope = scope; appearanceChatId = chatId;
  appearanceDraft = scope === 'global' ? normalizeAppearance(state.settings.appearance) : normalizeChatAppearance(state.chats.find(c => c.id === chatId)?.appearance);
  openDialog('appearance-dialog'); $('#appearance-error').hidden = true;
  $('#appearance-title').textContent = t(scope === 'global' ? 'APPEARANCE_GLOBAL_TITLE' : 'APPEARANCE_CHAT_TITLE');
  $('#appearance-global-fields').hidden = scope !== 'global'; fillAppearanceForm();
}

function fillAppearanceForm() {
  if (!appearanceDraft) return;
  const global = appearanceScope === 'global' ? appearanceDraft : normalizeAppearance(state.settings.appearance);
  const tokens = appearanceTokens(global, document.documentElement.dataset.theme === 'dark');
  $('#appearance-accent').value = tokens['--accent']; $('#appearance-background').value = tokens['--bg'];
  $('#appearance-chat').value = appearanceScope === 'chat' ? appearanceDraft.background || tokens['--chat-background'] : tokens['--chat-background'];
  $('#appearance-outgoing').value = appearanceDraft.outgoing || tokens['--outgoing'];
  $('#appearance-font').value = global.fontSize; $('#appearance-dim').value = Math.round(appearanceDraft.dim * 100);
  $$('[data-palette]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.palette === global.preset)));
  renderAppearancePreview();
}

function renderAppearancePreview() {
  if (!appearanceDraft || !state.settings) return;
  const global = appearanceScope === 'global' ? appearanceDraft : state.settings.appearance;
  const node = $('#appearance-preview'), tokens = appearanceTokens(global, document.documentElement.dataset.theme === 'dark');
  for (const [key, value] of Object.entries(tokens)) node.style.setProperty(key, value);
  const chat = appearanceScope === 'chat' ? appearanceDraft : { background: appearanceDraft.chat, wallpaper: appearanceDraft.wallpaper, dim: appearanceDraft.dim, outgoing: appearanceDraft.outgoing };
  applyChatAppearance(chat, global, document.documentElement.dataset.theme === 'dark', node);
  $('#appearance-remove-photo').disabled = !appearanceDraft.wallpaper;
}

async function saveAppearance() {
  if (!appearanceDraft || store.locked || state.locking) return;
  const epoch = privateEpoch; $('#appearance-save').disabled = true;
  try {
    if (appearanceScope === 'global') {
      const settings = { ...state.settings, appearance: normalizeAppearance(appearanceDraft) };
      await store.setMeta('settings', settings); if (epoch !== privateEpoch) return; state.settings = settings;
    } else await changeChat(appearanceChatId, chat => { chat.appearance = normalizeChatAppearance(appearanceDraft); });
    if (epoch !== privateEpoch) return;
    closeDialogs(); applyTheme(); renderHeader(); notify('APPEARANCE_SAVED');
  } catch (error) { $('#appearance-error').textContent = t(error.message || 'STORAGE_FAILED'); $('#appearance-error').hidden = false; }
  finally { $('#appearance-save').disabled = false; }
}

async function chooseAppearancePhoto() {
  if (!appearanceDraft) return;
  try { await store.setMeta('appearancePending', { scope: appearanceScope, chatId: appearanceChatId, draft: appearanceDraft }); $('#appearance-image-input').click(); }
  catch { notify('STORAGE_FAILED', true); }
}

async function selectAppearancePhoto(file) {
  if (!file) return;
  if (store.locked || state.locking) { pendingAppearanceFile = file; return; }
  const epoch = privateEpoch, pending = await store.getMeta('appearancePending');
  const url = URL.createObjectURL(file);
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('WALLPAPER_INVALID');
    const image = new Image(); image.src = url; await image.decode();
    const factor = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * factor)); canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/jpeg', .76); if (data.length > MAX_IMAGE_DATA) data = canvas.toDataURL('image/jpeg', .52);
    if (data.length > MAX_IMAGE_DATA) throw new Error('WALLPAPER_INVALID');
    if (epoch !== privateEpoch || store.locked || state.locking) return;
    if (!$('#appearance-dialog').open) openAppearance(pending?.scope || 'global', pending?.chatId || state.current);
    if (pending?.draft) appearanceDraft = { ...pending.draft };
    appearanceDraft.wallpaper = data; fillAppearanceForm(); await store.setMeta('appearancePending', null);
  } catch (error) { if (epoch === privateEpoch) notify(error.message === 'WALLPAPER_INVALID' ? error.message : 'Не удалось открыть фотографию.', true); }
  finally { URL.revokeObjectURL(url); $('#appearance-image-input').value = ''; }
}

function bindFeatures23() {
  $('#cloud-form').onsubmit = saveCloud;
  $('#cloud-recovery-open').onclick = () => openDialog('recovery-dialog');
  $('#recovery-download').onclick = downloadRecovery;
  $('#recovery-confirmed').onchange = () => { $('#recovery-done').disabled = !$('#recovery-confirmed').checked; };
  $('#recovery-done').onclick = async () => { try { await updateCloudConfig({ recoverySaved: true }); closeDialogs(); } catch {} };
  for (const id of ['cloud-restore', 'onboarding-cloud-restore']) $(`#${id}`).onclick = () => $('#cloud-recovery-input').click();
  $('#cloud-recovery-input').onchange = () => void restoreCloudFile($('#cloud-recovery-input').files[0]);
  $('#cloud-resync').onclick = resyncCloudHistory; $('#cloud-delete-account').onclick = deleteCloudAccount;
  $('#notification-permission').onclick = () => window.LiboAndroid?.requestNotifications?.();
  $('#battery-settings').onclick = () => window.LiboAndroid?.openBatterySettings?.();
  $('#global-appearance').onclick = () => openAppearance('global'); $('#chat-appearance').onclick = () => openAppearance('chat');
  $('#appearance-save').onclick = () => void saveAppearance();
  $('#appearance-reset').onclick = () => { appearanceDraft = appearanceScope === 'global' ? normalizeAppearance() : normalizeChatAppearance(); fillAppearanceForm(); };
  $$('[data-palette]').forEach(button => { button.onclick = () => { appearanceDraft = normalizeAppearance({ preset: button.dataset.palette }); fillAppearanceForm(); }; });
  const fields = { 'appearance-accent': 'accent', 'appearance-background': 'background', 'appearance-chat': 'chat', 'appearance-outgoing': 'outgoing', 'appearance-font': 'fontSize', 'appearance-dim': 'dim' };
  for (const [id, field] of Object.entries(fields)) $(`#${id}`).oninput = () => {
    if (!appearanceDraft) return;
    const key = field === 'chat' && appearanceScope === 'chat' ? 'background' : field;
    appearanceDraft[key] = field === 'dim' ? Number($(`#${id}`).value) / 100 : field === 'fontSize' ? Number($(`#${id}`).value) : $(`#${id}`).value;
    renderAppearancePreview();
  };
  $('#appearance-photo').onclick = () => void chooseAppearancePhoto();
  $('#appearance-remove-photo').onclick = () => { if (appearanceDraft) { appearanceDraft.wallpaper = ''; renderAppearancePreview(); } };
  $('#appearance-image-input').onchange = () => void selectAppearancePhoto($('#appearance-image-input').files[0]);
  $('#appearance-dialog').addEventListener('close', () => { appearanceDraft = null; $('#appearance-preview').style.backgroundImage = ''; });
}
