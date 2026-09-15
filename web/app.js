import qrcode from 'qrcode-generator';
import { Store } from './lib/storage.mjs';
import { Transport } from './lib/transport.mjs';
import {
  APK_URL, REPO_URL, VERSION, MAX_TEXT, MAX_IMAGE_DATA, MAX_MESSAGES, MAX_CHATS,
  makePeerId, normalizePeerCode, normalizeName, initials, avatarColor,
  previewText, safeFilename, parseSignalingUrl, makeIceServers, toPacket, textExport, verificationCode,
  MAX_ATT_DATA, MAX_ATTACH_BYTES, MAX_VOICE_SECONDS, MAX_PINS, REACTIONS,
  makeEditPacket, makeDeletePacket, makePinPacket, makeReactPacket,
  makeReadPacket, makePollVotePacket, mergePollVote, pollTally,
  TTL_OPTIONS, WALLPAPERS, FOLDERS,
} from './lib/core.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const svg = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const store = new Store();
const state = {
  profile: null, settings: null, chats: [], blocked: [], current: null,
  filter: 'all', network: 'connecting', networkDetail: '', contactStates: new Map(),
  typing: new Map(), drafts: {}, reply: null, attachment: null, sending: false,
  lastSeen: new Map(), recording: null, archiveNotice: false,
  folderTab: '', selection: null, ttl: 0, highlight: null,
};
const ttlTimers = new Map();
const locks = new Map();
const lastSent = new Map();
const timeFormat = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
let toastTimer;
let unlockResolve;
let typingSentAt = 0;
let confirmAction = null;
let audioContext;
let photoGeneration = 0;

const transport = new Transport({
  onState(status, detail = '') {
    state.network = status;
    state.networkDetail = detail;
    renderNetwork();
    renderHeader();
  },
  onReady: retryConnections,
  isAllowed: id => !!normalizePeerCode(id) && id !== state.profile?.id && !state.blocked.includes(id),
  async onHello(id, name) {
    await changeChat(id, chat => { chat.name = name; }, { request: true });
    renderSidebar();
    if (state.current === id) renderHeader();
  },
  onContactState(id, status) {
    state.contactStates.set(id, status);
    if (status === 'online') state.lastSeen.set(id, Date.now());
    else if (state.contactStates.get(id) !== 'offline') { state.lastSeen.set(id, Date.now()); void store.setMeta('lastSeen', Object.fromEntries(state.lastSeen)).catch(() => {}); }
    if (status !== 'online') state.typing.delete(id);
    renderSidebar();
    if (state.current === id) renderHeader();
  },
  onConnected: flushPending,
  async onMessage(id, packet) {
    try {
      let fresh = false;
      await changeChat(id, chat => {
        if (chat.messages.some(m => m.id === packet.id)) return false;
        if (chat.request && chat.messages.length >= 10) throw new Error('Сначала примите запрос на общение.');
        // Do not evict undelivered outgoing messages to make room for an incoming message.
        makeRoom(chat);
        fresh = true;
        chat.messages.push({
          id: packet.id, text: packet.text, image: packet.image, reply: packet.reply,
          att: packet.att || null, editedAt: packet.editedAt || null,
          ttl: packet.ttl || 0, fwd: packet.fwd || null,
          at: Math.min(packet.at, Date.now() + 60_000), direction: 'in', status: 'received',
        });
        if (state.current !== id || document.hidden) chat.unread = (chat.unread || 0) + 1;
        chat.updatedAt = Date.now();
      });
      transport.send(id, { v: 1, type: 'ack', id: packet.id });
      state.typing.delete(id);
      if (fresh) {
        if (packet.ttl) scheduleExpiry(id, packet.id, packet.ttl, packet.at);
        renderSidebar();
        if (state.current === id) { renderMessages(); renderHeader(); sendReadReceipt(id); }
        playMessageSound(id);
      }
    } catch (error) {
      transport.closeContact(id);
      notify(error.message?.includes('запрос') ? error.message : 'Сообщение не сохранено: проверьте свободное место на устройстве.', true);
    }
  },
  async onAck(id, messageId) {
    try {
      await changeChat(id, chat => {
        const index = chat.messages.findIndex(m => m.id === messageId && m.direction === 'out');
        if (index < 0 || chat.messages[index].status === 'delivered') return false;
        chat.messages[index] = { ...chat.messages[index], status: 'delivered' };
      });
      lastSent.delete(messageId);
      if (state.current === id) renderMessages(false);
      renderSidebar();
    } catch { notify('Не удалось сохранить статус доставки.', true); }
  },
  onTyping(id, active) {
    state.typing.set(id, active ? Date.now() + 3500 : 0);
    if (state.current === id) renderHeader();
    setTimeout(() => { if (state.current === id) renderHeader(); }, 3600);
  },
  async onEdit(id, packet) {
    await changeChat(id, chat => {
      const index = chat.messages.findIndex(m => m.id === packet.id);
      if (index < 0 || chat.messages[index].deleted) return false;
      chat.messages[index] = { ...chat.messages[index], text: packet.text, editedAt: packet.editedAt };
    });
    if (state.current === id) renderMessages(false);
    renderSidebar();
  },
  async onDelete(id, ids) {
    const gone = new Set(ids);
    await changeChat(id, chat => {
      let changed = false;
      chat.messages = chat.messages.map(m => {
        if (!gone.has(m.id) || m.deleted) return m;
        changed = true;
        return { id: m.id, at: m.at, direction: m.direction, status: m.status, deleted: true, text: '' };
      });
      chat.pins = (chat.pins || []).filter(pin => !gone.has(pin));
      return changed ? undefined : false;
    });
    if (state.current === id) { renderMessages(false); renderPins(); }
    renderSidebar();
  },
  async onPin(id, messageId, pinned) {
    await changeChat(id, chat => {
      chat.pins = (chat.pins || []).filter(pin => pin !== messageId);
      if (pinned) chat.pins.push(messageId);
      if (chat.pins.length > MAX_PINS) chat.pins = chat.pins.slice(-MAX_PINS);
    });
    if (state.current === id) renderPins();
  },
  async onReact(id, messageId, key, on) {
    await changeChat(id, chat => {
      const index = chat.messages.findIndex(m => m.id === messageId);
      if (index < 0 || chat.messages[index].deleted) return false;
      const previous = chat.messages[index].reactions || {};
      const theirs = { ...(previous.theirs || {}) };
      if (on) theirs[key] = true; else delete theirs[key];
      chat.messages[index] = { ...chat.messages[index], reactions: { ...previous, theirs } };
    });
    if (state.current === id) renderMessages(false);
  },
  async onRead(id, upTo) {
    await changeChat(id, chat => {
      if ((chat.readUpTo || 0) >= upTo) return false;
      chat.readUpTo = upTo;
    });
    if (state.current === id) renderMessages(false);
  },
  async onPollVote(id, pid, opt) {
    await changeChat(id, chat => {
      const index = chat.messages.findIndex(m => m.id === pid && m.att?.kind === 'poll');
      if (index < 0) return false;
      const att = { ...chat.messages[index].att, votes: mergePollVote(chat.messages[index].att.votes, 'theirs', opt) };
      chat.messages[index] = { ...chat.messages[index], att };
    });
    if (state.current === id) renderMessages(false);
  },
  onSecurity(id) { if (state.current === id && $('#security-dialog').open) void openSecurity(); },
  onMtDrop(id) {
    // A key generation change swallowed an envelope: let the queue retransmit at once.
    const chat = state.chats.find(item => item.id === id);
    if (chat) for (const message of chat.messages) lastSent.delete(message.id);
    void flushPending(id);
  },
  onStorageError() { notify('Не удалось сохранить контакт. Проверьте свободное место.', true); },
});

// Serialize each chat's writes. Concurrent incoming messages, ACKs, and drafts must not overwrite one another.
function changeChat(id, mutate, defaults = null) {
  const previous = locks.get(id) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const index = state.chats.findIndex(chat => chat.id === id);
    const original = state.chats[index];
    if (!original && !defaults) throw new Error('Чат не найден.');
    if (!original && state.chats.length >= MAX_CHATS) throw new Error('Достигнут лимит: 100 чатов на устройстве.');
    const chat = original
      ? { ...original, messages: [...original.messages] }
      : { id, name: 'Новый контакт', messages: [], unread: 0, createdAt: Date.now(), updatedAt: 0, ...defaults };
    if (mutate(chat) === false) return original;
    await store.putChat(chat);
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
  const index = chat.messages.findIndex(m => m.direction === 'in' || ['delivered', 'local'].includes(m.status));
  if (index < 0) throw new Error('В очереди уже 500 сообщений. Дождитесь доставки или очистите чат.');
  chat.messages.splice(index, 1);
}

function activeChat() { return state.chats.find(chat => chat.id === state.current); }

function notify(text, error = false) {
  const toast = $('#toast');
  const open = $('dialog[open]');
  (open || document.body).appendChild(toast);
  toast.querySelector('span').textContent = text;
  toast.querySelector('use').setAttribute('href', error ? '#i-info' : '#i-check');
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 5500 : 3200);
}

function renderNetwork() {
  const el = $('#network-status');
  el.className = `network-status ${state.network}`;
  el.querySelector('span').textContent = {
    ready: 'Вы в сети', connecting: 'Подключаемся…', offline: 'Нет соединения', error: 'Нужно подключение',
  }[state.network];
  el.title = state.networkDetail || 'Наличие связи с сигнальным сервером. Статус собеседника показан внутри чата.';
}

function renderSidebar() {
  if (!state.profile) return;
  const query = $('#chat-search').value.trim().toLocaleLowerCase('ru');
  const chats = [...state.chats].sort((a, b) => a.id === 'saved' ? -1 : b.id === 'saved' ? 1 : (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.updatedAt - a.updatedAt);
  const filtered = chats.filter(chat => {
    if (state.folderTab && (chat.folder || '') !== state.folderTab) return false;
    if (state.filter === 'unread' && !chat.unread) return false;
    return !query || chat.name.toLocaleLowerCase('ru').includes(query) || chat.messages.some(m => m.text.toLocaleLowerCase('ru').includes(query));
  });
  const list = $('#chat-list');
  list.replaceChildren();
  for (const chat of filtered) {
    const row = document.createElement('button');
    row.className = `chat-row${chat.id === state.current ? ' selected' : ''}`;
    row.dataset.chatId = chat.id;
    row.setAttribute('aria-label', `Открыть чат ${chat.name}`);
    row.setAttribute('aria-current', chat.id === state.current ? 'true' : 'false');
    const online = transport.isOpen(chat.id);
    const avatar = document.createElement('span');
    avatar.className = `avatar ${chat.id === 'saved' ? 'saved' : avatarColor(chat.id)}${online ? ' online' : ''}`;
    if (chat.id === 'saved') avatar.innerHTML = svg('bookmark');
    else avatar.textContent = initials(chat.name);
    const body = document.createElement('span');
    body.className = 'chat-row-body';
    body.innerHTML = '<span class="chat-row-top"><strong></strong><time></time></span><span class="chat-row-bottom"><p></p></span>';
    body.querySelector('strong').textContent = chat.name;
    if (chat.starred) body.querySelector('strong').insertAdjacentHTML('afterend', `<span class="star-mark" title="Близкий контакт">${svg('star')}</span>`);
    if (chat.muted) body.querySelector('strong').insertAdjacentHTML('afterend', `<span class="star-mark" title="Без звука">${svg('mute')}</span>`);
    if (chat.folder) body.querySelector('strong').insertAdjacentHTML('afterend', `<span class="folder-mark" title="Папка: ${FOLDERS[chat.folder] || ''}">${svg('folder')}</span>`);
    if (chat.archive) body.querySelector('strong').insertAdjacentHTML('afterend', `<span class="archive-mark" title="Архивная копия">${svg('download')}</span>`);
    const last = chat.messages.at(-1);
    body.querySelector('time').textContent = last ? briefDate(last.at) : '';
    const excerpt = query ? [...chat.messages].reverse().find(m => m.text.toLocaleLowerCase('ru').includes(query)) || last : last;
    body.querySelector('p').textContent = !last && chat.id === 'saved' ? 'Ваши заметки, ссылки и идеи' : previewText(excerpt);
    if (chat.unread) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.textContent = chat.unread > 99 ? '99+' : chat.unread;
      body.lastElementChild.appendChild(badge);
    } else if (chat.request) {
      const badge = document.createElement('span');
      badge.className = 'request-badge'; badge.textContent = 'ЗАПРОС';
      body.lastElementChild.appendChild(badge);
    } else if (chat.id === 'saved') body.lastElementChild.insertAdjacentHTML('beforeend', svg('bookmark'));
    row.append(avatar, body);
    list.appendChild(row);
  }
  if (query) {
    const hits = [];
    for (const chat of chats) {
      for (const message of [...chat.messages].reverse()) {
        if (message.deleted || !message.text.toLocaleLowerCase('ru').includes(query)) continue;
        hits.push({ chat, message });
        if (hits.length >= 8) break;
      }
      if (hits.length >= 8) break;
    }
    if (hits.length) {
      const heading = document.createElement('div');
      heading.className = 'global-results-heading';
      heading.textContent = `Найдено в переписке: ${hits.length}`;
      list.appendChild(heading);
      for (const hit of hits) {
        const button = document.createElement('button');
        button.className = 'global-result';
        button.dataset.goto = `${hit.chat.id}|${hit.message.id}`;
        button.innerHTML = '<strong></strong><p></p>';
        button.querySelector('strong').textContent = hit.chat.name;
        button.querySelector('p').textContent = hit.message.text.slice(0, 90);
        list.appendChild(button);
      }
    }
  }
  if (!filtered.length || (!query && state.filter === 'all' && chats.length === 1)) {
    const empty = document.createElement('div');
    empty.className = 'empty-chats';
    empty.innerHTML = `${svg('chat').replace('<svg', '<span><svg').replace('</svg>', '</svg></span>')}<strong></strong><p></p>`;
    empty.querySelector('strong').textContent = query ? 'Ничего не нашлось' : state.filter === 'unread' ? 'Вы всё прочитали' : 'Здесь будут ваши люди';
    empty.querySelector('p').textContent = query ? 'Попробуйте другое имя или слово из переписки.' : state.filter === 'unread' ? 'Новые сообщения появятся здесь.' : 'Первый разговор — всего в одном личном коде от вас.';
    if (!query && state.filter === 'all') {
      const button = document.createElement('button');
      button.textContent = '+ Добавить контакт';
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
  return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(date);
}

function dayLabel(at) {
  const date = new Date(at);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? 'Вчера' : dateFormat.format(date);
}

function renderHeader() {
  const chat = activeChat();
  if (!chat) return;
  const avatar = $('#chat-avatar');
  avatar.className = `avatar ${chat.id === 'saved' ? 'saved' : avatarColor(chat.id)}${transport.isOpen(chat.id) ? ' online' : ''}`;
  if (chat.id === 'saved') avatar.innerHTML = svg('bookmark'); else avatar.textContent = initials(chat.name);
  $('#chat-title').textContent = chat.name;
  const presence = $('#chat-presence');
  presence.classList.toggle('is-online', transport.isOpen(chat.id));
  if (chat.id === 'saved') presence.textContent = 'Личное пространство · только на этом устройстве';
  else if (state.typing.get(chat.id) > Date.now()) presence.textContent = 'печатает…';
  else if (chat.request) presence.textContent = 'Новый запрос на общение';
  else if (transport.isOpen(chat.id)) presence.textContent = 'В сети · прямое соединение';
  else if (state.contactStates.get(chat.id) === 'connecting') presence.textContent = 'Ищем собеседника…';
  else if (state.lastSeen.get(chat.id)) presence.textContent = `Был(а) в сети в ${timeFormat.format(new Date(state.lastSeen.get(chat.id)))}`;
  else presence.textContent = 'Не подключён · откройте LIBO на обоих устройствах';
  presence.title = chat.id === 'saved' ? 'Заметки не передаются другим устройствам.' : `Код собеседника: LIBO:${chat.id}`;
  $('#request-bar').hidden = !chat.request;
  $('#composer-zone').hidden = !!chat.request || !!chat.archive;
  $('#archive-bar').hidden = !chat.archive;
  $('#security-button').hidden = chat.id === 'saved' || !!chat.archive;
  $('#block-contact').hidden = chat.id === 'saved';
  $('#verify-code').hidden = chat.id === 'saved' || !!chat.archive;
  $('#star-contact').hidden = chat.id === 'saved';
  $('#star-contact').querySelector('span').textContent = chat.starred ? 'Убрать из близких' : 'В близкие';
  $('#composer-hint').textContent = chat.id === 'saved'
    ? 'Сохранено на этом устройстве. Последние 500 сообщений в чате.'
    : 'Оба собеседника в приложении · ✓ сохранено у собеседника, ✓✓ прочитано';
}

async function showVerifyCode() {
  const chat = activeChat();
  if (!chat || chat.id === 'saved' || !state.profile) return;
  $('#verify-value').textContent = await cachedVerify(state.profile.id, chat.id);
  $('#verify-peer-name').textContent = chat.name;
  openDialog('verify-dialog');
}

function renderMessages(scroll = true) {
  const chat = activeChat();
  if (!chat) return;
  const box = $('#messages');
  const previousTop = box.scrollTop;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const query = $('#message-search').value.trim().toLocaleLowerCase('ru');
  const messages = chat.messages.filter(m => !query || m.text.toLocaleLowerCase('ru').includes(query) || m.reply?.text.toLocaleLowerCase('ru').includes(query));
  box.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.innerHTML = `<div>${svg(chat.id === 'saved' ? 'bookmark' : 'chat')}</div><h3></h3><p></p>`;
    empty.querySelector('h3').textContent = query ? 'Ничего не найдено' : chat.id === 'saved' ? 'Мысли, которые стоит сохранить' : 'Ваше первое «привет»';
    empty.querySelector('p').textContent = query ? 'Попробуйте другое слово.' : chat.id === 'saved' ? 'Заметки, фотографии и важные идеи. Всё в одном месте и только для вас.' : 'Здесь начнётся ваш разговор. Если собеседник не в сети, сообщение подождёт на вашем устройстве.';
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
    row.className = `message-row ${message.direction === 'out' ? 'outgoing' : 'incoming'}${message.deleted ? ' deleted-row' : ''}${state.selection?.has(message.id) ? ' in-selection' : ''}${state.highlight === message.id ? ' highlight' : ''}`;
    row.dataset.messageId = message.id;
    const bubble = document.createElement('div'); bubble.className = 'message-bubble';
    if (message.deleted) {
      const gone = document.createElement('p'); gone.className = 'message-deleted';
      gone.textContent = 'Сообщение удалено';
      bubble.appendChild(gone);
      const meta = document.createElement('div'); meta.className = 'message-meta';
      const time = document.createElement('time'); time.textContent = timeFormat.format(new Date(message.at));
      meta.appendChild(time); bubble.appendChild(meta);
      row.append(bubble); box.appendChild(row);
      continue;
    }
    if (message.fwd) {
      const fwd = document.createElement('div'); fwd.className = 'message-fwd';
      fwd.textContent = `Переслано от ${message.fwd.from}`;
      bubble.appendChild(fwd);
    }
    if (message.reply) {
      const quote = document.createElement('div'); quote.className = 'message-quote';
      quote.innerHTML = '<strong></strong><p></p>';
      quote.querySelector('strong').textContent = message.reply.name;
      quote.querySelector('p').textContent = message.reply.text;
      bubble.appendChild(quote);
    }
    if (message.image) {
      const photo = document.createElement('button'); photo.className = 'message-photo'; photo.dataset.photo = message.id;
      photo.setAttribute('aria-label', 'Открыть фотографию');
      const img = document.createElement('img'); img.src = message.image.data; img.alt = message.image.name || 'Фотография'; img.loading = 'lazy';
      img.onload = () => { if (scroll && nearBottom) box.scrollTop = box.scrollHeight; };
      photo.appendChild(img); bubble.appendChild(photo);
    }
    if (message.att) bubble.appendChild(renderAttachment(message));
    if (message.text) {
      const text = document.createElement('p'); text.className = 'message-text'; text.textContent = message.text;
      bubble.appendChild(text);
    }
    const reactions = message.reactions || {};
    const mine = Object.keys(reactions.mine || {});
    const theirs = Object.keys(reactions.theirs || {});
    const keys = [...new Set([...mine, ...theirs])];
    if (keys.length) {
      const strip = document.createElement('div'); strip.className = 'reaction-strip';
      for (const key of keys) {
        const chip = document.createElement('button');
        chip.className = `reaction-chip${mine.includes(key) ? ' mine' : ''}`;
        chip.dataset.react = key; chip.dataset.messageId = message.id;
        chip.innerHTML = `${svg(`r-${key}`)}<span></span>`;
        chip.querySelector('span').textContent = String(mine.includes(key) && theirs.includes(key) ? 2 : 1);
        chip.title = 'Нажмите, чтобы поставить или убрать свою реакцию';
        chip.setAttribute('aria-label', `Реакция ${key}`);
        strip.appendChild(chip);
      }
      bubble.appendChild(strip);
    }
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const time = document.createElement('time'); time.dateTime = new Date(message.at).toISOString(); time.textContent = timeFormat.format(new Date(message.at));
    meta.appendChild(time);
    if (message.editedAt) {
      const edited = document.createElement('span'); edited.className = 'edited-mark'; edited.textContent = 'изменено';
      edited.title = new Date(message.editedAt).toLocaleString('ru');
      meta.appendChild(edited);
    }
    if (message.ttl && !message.deleted) {
      const left = Math.max(0, Math.round((message.at + message.ttl * 1000 - Date.now()) / 1000));
      const chip = document.createElement('span'); chip.className = 'ttl-chip';
      chip.textContent = left > 90 ? `${Math.ceil(left / 60)} мин` : `${left} с`;
      chip.title = 'Сообщение самоуничтожится по таймеру';
      meta.insertBefore(chip, meta.firstChild);
    }
    if ((activeChat()?.pins || []).includes(message.id)) meta.insertAdjacentHTML('beforeend', `<span class="pin-mark" title="Закреплено">${svg('pin')}</span>`);
    if (message.direction === 'out') {
      const status = document.createElement('span'); status.className = 'message-status'; status.dataset.status = message.status;
      status.title = { queued: 'В очереди на этом устройстве', sent: 'Отправлено, ждём подтверждения', delivered: 'Сохранено на устройстве собеседника', local: 'Сохранено только на этом устройстве' }[message.status];
      status.setAttribute('aria-label', status.title);
      const read = message.status === 'delivered' && (chat.readUpTo || 0) >= message.at;
      status.classList.toggle('read', read);
      status.innerHTML = svg({ queued: 'clock', sent: 'check', delivered: read ? 'checks' : 'check', local: 'bookmark' }[message.status] || 'clock');
      status.title = read ? 'Прочитано собеседником' : status.title;
      meta.appendChild(status);
    }
    bubble.appendChild(meta);
    const actions = document.createElement('button'); actions.className = 'reply-message message-actions-button'; actions.dataset.actions = message.id;
    actions.innerHTML = svg('more'); actions.title = 'Действия с сообщением'; actions.setAttribute('aria-label', 'Действия с сообщением');
    row.append(bubble, actions); box.appendChild(row);
  }
  if (scroll && nearBottom) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  else box.scrollTop = previousTop;
}

function renderAttachment(message) {
  const att = message.att;
  if (att.kind === 'voice') {
    const wrap = document.createElement('div'); wrap.className = 'att-voice';
    wrap.innerHTML = `${svg('mic')}<audio controls preload="metadata"></audio><span></span>`;
    wrap.querySelector('audio').src = att.data;
    wrap.querySelector('span').textContent = att.dur ? `${Math.round(att.dur / 1000)} с` : 'голосовое';
    return wrap;
  }
  if (att.kind === 'video') {
    const video = document.createElement('video');
    video.className = 'message-video'; video.controls = true; video.preload = 'metadata';
    video.src = att.data; video.setAttribute('playsinline', '');
    return video;
  }
  if (att.kind === 'poll') {
    const wrap = document.createElement('div'); wrap.className = 'att-poll';
    const tally = pollTally(att);
    const total = tally.reduce((sum, value) => sum + value, 0);
    const head = document.createElement('strong'); head.textContent = att.q;
    wrap.appendChild(head);
    att.opts.forEach((opt, index) => {
      const option = document.createElement('button');
      option.className = 'poll-option';
      option.dataset.vote = index; option.dataset.messageId = message.id;
      const mine = att.votes?.mine === index;
      const theirs = att.votes?.theirs === index;
      if (mine) option.classList.add('mine');
      const share = total ? Math.round(tally[index] / total * 100) : 0;
      option.style.setProperty('--share', `${share}%`);
      option.innerHTML = '<span class="poll-label"></span><span class="poll-share"></span>';
      option.querySelector('.poll-label').textContent = `${mine ? '✓ ' : ''}${opt}`;
      option.querySelector('.poll-share').textContent = total ? `${share}% · ${tally[index]}` : 'голосовать';
      option.title = theirs && !mine ? 'Выбор собеседника' : 'Нажмите, чтобы проголосовать';
      wrap.appendChild(option);
    });
    const foot = document.createElement('small'); foot.textContent = `Всего голосов: ${total}`;
    wrap.appendChild(foot);
    return wrap;
  }
  const link = document.createElement('button'); link.className = 'att-file'; link.dataset.attach = message.id;
  link.innerHTML = `${svg('file')}<span></span><small></small>`;
  link.querySelector('span').textContent = att.name;
  link.querySelector('small').textContent = 'Скачать файл';
  link.title = att.name;
  return link;
}

function renderPins() {
  const chat = activeChat();
  const bar = $('#pinned-bar');
  const pins = chat?.pins || [];
  if (!chat || chat.id === 'saved' || !pins.length) { bar.hidden = true; return; }
  const message = [...chat.messages].reverse().find(m => m.id === pins.at(-1));
  if (!message || message.deleted) { bar.hidden = true; return; }
  bar.hidden = false;
  $('#pinned-text').textContent = message.text || (message.att ? { voice: 'Голосовое сообщение', video: 'Видео', file: message.att.name }[message.att.kind] : 'Фотография');
}

function closeMessageActions() { $('#message-actions').hidden = true; }

function openMessageActions(anchor, messageId) {
  const chat = activeChat();
  const message = chat?.messages.find(m => m.id === messageId);
  if (!message || message.deleted) return;
  const menu = $('#message-actions');
  menu.dataset.messageId = messageId;
  menu.querySelector('[data-act="pin"]').hidden = chat.id === 'saved';
  menu.querySelector('[data-act="pin"]').lastChild.textContent = (chat.pins || []).includes(messageId) ? ' Открепить' : ' Закрепить';
  menu.querySelector('[data-act="edit"]').hidden = message.direction !== 'out' || !!message.att || chat.id === 'saved';
  menu.querySelector('[data-act="forward"]').hidden = chat.id === 'saved' && false ? true : !!chat.archive;
  menu.querySelector('[data-act="delete"]').hidden = message.direction !== 'out' || chat.id === 'saved';
  const strip = menu.querySelector('.reaction-strip-picker');
  strip.replaceChildren();
  for (const key of REACTIONS) {
    const button = document.createElement('button');
    button.className = `reaction-pick${(message.reactions?.mine || {})[key] ? ' mine' : ''}`;
    button.dataset.reactPick = key;
    button.innerHTML = svg(`r-${key}`);
    button.setAttribute('aria-label', `Реакция ${key}`);
    strip.appendChild(button);
  }
  menu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = 210;
  menu.style.top = `${Math.min(window.innerHeight - 260, Math.max(8, rect.bottom + 6))}px`;
  menu.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, rect.left - width + 34))}px`;
}

async function actOnMessage(action, messageId, extra) {
  const chat = activeChat();
  const message = chat?.messages.find(m => m.id === messageId);
  if (!chat || !message) return;
  if (action === 'reply') {
    state.reply = { text: (message.text || (message.att ? { voice: 'Голосовое сообщение', video: 'Видео', file: message.att.name }[message.att.kind] : 'Фотография')).slice(0, 160), name: message.direction === 'out' ? state.profile.name : chat.name };
    $('#reply-name').textContent = state.reply.name; $('#reply-text').textContent = state.reply.text;
    $('#reply-bar').hidden = false; $('#message-input').focus();
    return;
  }
  if (action === 'copy') {
    if (message.text) await copyLikeCode(message.text);
    return;
  }
  if (action === 'react') {
    const on = !(message.reactions?.mine || {})[extra];
    await changeChat(chat.id, next => {
      const index = next.messages.findIndex(m => m.id === messageId);
      if (index < 0) return false;
      const previous = next.messages[index].reactions || {};
      const mine = { ...(previous.mine || {}) };
      if (on) mine[extra] = true; else delete mine[extra];
      next.messages[index] = { ...next.messages[index], reactions: { ...previous, mine } };
    });
    if (chat.id !== 'saved') transport.send(chat.id, makeReactPacket(messageId, extra, on));
    renderMessages(false);
    return;
  }
  if (action === 'pin') {
    const pinned = !(chat.pins || []).includes(messageId);
    await changeChat(chat.id, next => {
      next.pins = (next.pins || []).filter(pin => pin !== messageId);
      if (pinned) next.pins.push(messageId);
      if (next.pins.length > MAX_PINS) next.pins = next.pins.slice(-MAX_PINS);
    });
    if (chat.id !== 'saved') transport.send(chat.id, makePinPacket(messageId, pinned));
    renderPins();
    renderMessages(false);
    return;
  }
  if (action === 'forward') {
    openForwardDialog([messageId]);
    return;
  }
  if (action === 'edit') {
    $('#edit-text').value = message.text;
    $('#edit-dialog').dataset.messageId = messageId;
    openDialog('edit-dialog');
    return;
  }
  if (action === 'delete') {
    confirmDialog('Удалить сообщение для обоих?', 'Сообщение исчезнет на этом устройстве и у собеседника. Отменить удаление нельзя.', async () => {
      await changeChat(chat.id, next => {
        next.messages = next.messages.map(m => m.id === messageId ? { id: m.id, at: m.at, direction: m.direction, status: m.status, deleted: true, text: '' } : m);
        next.pins = (next.pins || []).filter(pin => pin !== messageId);
      });
      transport.send(chat.id, makeDeletePacket([messageId]));
      renderMessages(false); renderPins(); renderSidebar();
    }, 'Удалить');
  }
}

async function submitEdit() {
  const chat = activeChat();
  const messageId = $('#edit-dialog').dataset.messageId;
  const text = $('#edit-text').value.trim().slice(0, MAX_TEXT);
  const message = chat?.messages.find(m => m.id === messageId);
  if (!chat || !message || !text || text === message.text) { closeDialogs(); return; }
  const editedAt = Date.now();
  await changeChat(chat.id, next => {
    const index = next.messages.findIndex(m => m.id === messageId);
    if (index < 0) return false;
    next.messages[index] = { ...next.messages[index], text, editedAt };
  });
  transport.send(chat.id, makeEditPacket(messageId, text, editedAt));
  closeDialogs();
  renderMessages(false); renderSidebar();
}

async function toggleStar() {
  const chat = activeChat();
  if (!chat || chat.id === 'saved') return;
  await changeChat(chat.id, next => { next.starred = !next.starred; });
  closeChatMenu();
  renderSidebar(); renderHeader();
  notify(chat.starred ? 'Контакт убран из близких' : 'Контакт добавлен в близкие');
}

async function openSecurity() {
  const chat = activeChat();
  if (!chat || chat.id === 'saved') return;
  $('#sec-conn').textContent = transport.isOpen(chat.id) ? 'Прямое соединение активно, трафик шифрован DTLS (WebRTC)' : 'Соединение не активно: сообщения ждут в очереди на этом устройстве';
  $('#sec-code').textContent = await cachedVerify(state.profile.id, chat.id);
  $('#sec-seen').textContent = state.lastSeen.get(chat.id) ? new Date(state.lastSeen.get(chat.id)).toLocaleString('ru') : 'нет данных на этом устройстве';
  $('#sec-peer').textContent = `LIBO:${chat.id}`;
  const fingerprint = transport.mtStatus(chat.id);
  $('#sec-mt').textContent = fingerprint
    ? `Активен: AES-256-GCM поверх DTLS, отпечаток ключа пары ${fingerprint}`
    : 'Не установлен: у собеседника версия без MT-слоя, трафик защищён только DTLS';
  openDialog('security-dialog');
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'LIBO' || !Array.isArray(data.chats)) throw new Error('Это не резервная копия LIBO.');
    let added = 0;
    for (const source of data.chats.slice(0, MAX_CHATS)) {
      if (!source || !Array.isArray(source.messages) || !source.messages.length) continue;
      const stamp = Date.now();
      const chat = {
        id: `archive-${stamp.toString(36)}-${added}`,
        name: `${normalizeName(source.name) || 'Архив'} · архив`,
        archive: true, starred: false, unread: 0, request: false,
        createdAt: stamp, updatedAt: stamp, pins: [],
        messages: source.messages.slice(-MAX_MESSAGES).map(m => ({
          id: crypto.randomUUID(), text: String(m.text || '').slice(0, MAX_TEXT),
          image: null, att: null, reply: null, reactions: null,
          at: Number.isSafeInteger(m.at) ? m.at : stamp,
          direction: m.direction === 'out' ? 'out' : 'in', status: 'local',
        })),
      };
      await store.putChat(chat);
      state.chats.push(chat);
      added++;
    }
    if (!added) throw new Error('В файле нет чатов для восстановления.');
    renderSidebar();
    closeDialogs();
    notify(`Восстановлено чатов из копии: ${added}. Это архив только для чтения.`);
  } catch (error) { notify(error.message || 'Не удалось прочитать резервную копию.', true); }
  finally { $('#import-input').value = ''; }
}

const verifyCache = new Map();
async function cachedVerify(a, b) {
  const key = [a, b].sort().join('|');
  if (!verifyCache.has(key)) verifyCache.set(key, await verificationCode(a, b));
  return verifyCache.get(key);
}

function rememberDraft() {
  if (!state.current) return;
  const value = $('#message-input').value.slice(0, MAX_TEXT);
  if (value) state.drafts[state.current] = value;
  else delete state.drafts[state.current];
  try { localStorage.setItem('libo-v2-drafts', JSON.stringify(state.drafts)); }
  catch { notify('Черновик не сохранён: на устройстве мало места.', true); }
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
  if (!state.chats.some(chat => chat.id === id)) return;
  rememberDraft();
  state.current = id;
  closeMessageActions();
  $('#shell').classList.add('chat-open');
  $('#welcome').hidden = true;
  $('#conversation').hidden = false;
  closeChatMenu();
  closeMessageSearch();
  setSelection(null);
  state.highlight = null;
  resetComposerExtras();
  $('#message-input').value = state.drafts[id] || '';
  updateComposer();
  renderHeader(); renderMessages(); renderSidebar();
  requestAnimationFrame(() => { $('#messages').scrollTop = $('#messages').scrollHeight; });
  if (id !== 'saved') transport.connect(id);
  sendReadReceipt(id);
  try { await changeChat(id, chat => { if (!chat.unread) return false; chat.unread = 0; }); renderSidebar(); }
  catch { notify('Не удалось обновить счётчик сообщений.', true); }
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
  if (!chat || chat.request || chat.archive || state.sending || (!text && !state.attachment)) return;
  const id = chat.id;
  const attachment = state.attachment;
  const message = {
    id: crypto.randomUUID(), text,
    image: attachment?.kind === 'photo' ? { data: attachment.data, name: attachment.name } : null,
    att: attachment && attachment.kind !== 'photo' ? attachment : null,
    reply: state.reply, ttl: state.ttl || 0,
    at: Date.now(), direction: 'out', status: id === 'saved' ? 'local' : 'queued',
  };
  state.sending = true; updateComposer();
  try {
    await changeChat(id, next => { makeRoom(next); next.messages.push(message); next.updatedAt = message.at; });
    if (state.current === id) {
      $('#message-input').value = '';
      rememberDraft(); resetComposerExtras();
      renderMessages();
      requestAnimationFrame(() => { $('#messages').scrollTop = $('#messages').scrollHeight; });
    }
    renderSidebar();
    if (message.ttl) scheduleExpiry(id, message.id, message.ttl, message.at);
    if (id !== 'saved') {
      transport.send(id, { v: 1, type: 'typing', active: false });
      transport.connect(id);
      await flushPending(id);
    }
  } catch (error) { notify(error.message?.includes('500') ? error.message : 'Не удалось сохранить сообщение. Проверьте свободное место.', true); }
  finally { state.sending = false; updateComposer(); }
}

async function flushPending(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat || chat.request || !transport.isOpen(id)) return;
  const pending = chat.messages.filter(m => m.direction === 'out' && ['sent', 'queued'].includes(m.status) && Date.now() - (lastSent.get(m.id) || 0) > 15_000).slice(0, 25);
  const sent = new Set();
  for (const message of pending) {
    if (await transport.send(id, toPacket(message))) { sent.add(message.id); lastSent.set(message.id, Date.now()); }
  }
  if (!sent.size) return;
  try {
    await changeChat(id, next => {
      next.messages = next.messages.map(m => sent.has(m.id) && m.status === 'queued' ? { ...m, status: 'sent' } : m);
    });
    if (state.current === id) renderMessages(false);
  } catch { notify('Не удалось сохранить статус отправки.', true); }
}

function retryConnections() {
  if (state.network !== 'ready') return;
  for (const chat of state.chats) {
    if (chat.id === 'saved' || chat.request) continue;
    if (chat.id === state.current || chat.messages.some(m => m.direction === 'out' && ['queued', 'sent'].includes(m.status))) {
      transport.connect(chat.id);
      void flushPending(chat.id);
    }
  }
}

function closeDialogs() {
  for (const dialog of $$('dialog[open]')) dialog.close();
}

function openDialog(id) {
  closeDialogs();
  closeChatMenu();
  if (id === 'invite-dialog') {
    const code = `LIBO:${state.profile.id}`;
    $('#my-code').textContent = code;
    $('#invite-name').textContent = state.profile.name;
    const qr = qrcode(0, 'M'); qr.addData(code); qr.make();
    $('#invite-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  if (id === 'new-dialog') { $('#contact-error').hidden = true; $('#contact-code').value = ''; }
  if (id === 'settings-dialog') populateSettings();
  if (id === 'blocked-dialog') renderBlocked();
  $(`#${id}`).showModal();
  if (id === 'new-dialog') $('#contact-code').focus();
}

function confirmDialog(title, text, action, button = 'Продолжить') {
  openDialog('confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-action').textContent = button;
  confirmAction = action;
}

async function addContact(event) {
  event.preventDefault();
  const id = normalizePeerCode($('#contact-code').value);
  const error = $('#contact-error');
  error.hidden = true;
  if (!id || id === state.profile.id || state.blocked.includes(id)) {
    error.textContent = !id ? 'Нужен полный личный код: LIBO:libo- и 32 символа. Проверьте, что скопировали его целиком.'
      : id === state.profile.id ? 'Это ваш код. Для своих заметок откройте «Избранное».'
      : 'Этот контакт заблокирован. Сначала разблокируйте его в настройках.';
    error.hidden = false; return;
  }
  try {
    await changeChat(id, chat => { chat.request = false; }, { request: false, updatedAt: Date.now() });
    closeDialogs();
    await openChat(id);
    notify('Контакт добавлен. Откройте LIBO на обоих устройствах.');
  } catch (err) { error.textContent = err.message; error.hidden = false; }
}

function applyTheme() {
  const dark = state.settings.theme === 'dark' || (state.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#191920' : '#f7f7fb';
  $('#theme-toggle use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $$('[data-theme]').forEach(button => {
    if (button.tagName !== 'BUTTON') return;
    button.classList.toggle('active', button.dataset.theme === state.settings.theme);
    button.setAttribute('aria-pressed', button.dataset.theme === state.settings.theme ? 'true' : 'false');
  });
  window.LiboAndroid?.setDarkTheme(dark);
}

const UI_KEY = 'libo-v2-ui';

// Synchronous mirror of the cosmetic settings: a reload must never race the
// IndexedDB commit and flash the wrong theme or wallpaper.
function rememberUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ theme: state.settings.theme, wall: state.settings.wall || 'plain' })); }
  catch { /* Cosmetic only; storage may be full. */ }
}

function recallUi() {
  try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch { return {}; }
}

async function setTheme(theme) {
  const previous = state.settings;
  state.settings = { ...state.settings, theme };
  applyTheme(); rememberUi();
  try { await store.setMeta('settings', state.settings); }
  catch { state.settings = previous; applyTheme(); notify('Тема не сохранена.', true); }
}

function populateSettings() {
  $('#profile-name').value = state.profile.name;
  $('#settings-avatar').textContent = initials(state.profile.name);
  $('#sound-enabled').checked = state.settings.sound;
  $('#wall-select').value = WALLPAPERS.includes(state.settings.wall) ? state.settings.wall : 'plain';
  const lock = lockState();
  $('#lock-state').value = lock ? 'Включён' : 'Выключен';
  $('#lock-pin').value = '';
  $('#signal-url').value = state.settings.signalUrl;
  $('#turn-url').value = state.settings.turnUrl;
  $('#turn-user').value = state.settings.turnUser;
  $('#turn-password').value = state.settings.turnPassword;
  $('#settings-error').hidden = true;
  $('#blocked-summary').textContent = state.blocked.length ? `Контактов: ${state.blocked.length}` : 'Нет заблокированных';
  applyTheme();
}

async function saveSettings(event) {
  event.preventDefault();
  const error = $('#settings-error'); error.hidden = true;
  const name = normalizeName($('#profile-name').value);
  if (!name) { error.textContent = 'Напишите, как вас называть.'; error.hidden = false; return; }
  const settings = {
    ...state.settings, sound: $('#sound-enabled').checked,
    wall: WALLPAPERS.includes($('#wall-select').value) ? $('#wall-select').value : 'plain',
    signalUrl: $('#signal-url').value.trim(), turnUrl: $('#turn-url').value.trim(),
    turnUser: $('#turn-user').value.trim(), turnPassword: $('#turn-password').value,
  };
  try {
    parseSignalingUrl(settings.signalUrl, location.origin);
    makeIceServers(settings);
    const reconnect = ['signalUrl', 'turnUrl', 'turnUser', 'turnPassword'].some(key => settings[key] !== state.settings[key]);
    const profile = { ...state.profile, name };
    await store.setMeta('settings', settings);
    await store.setMeta('profile', profile);
    state.settings = settings; state.profile = profile;
    $('#profile-button').textContent = initials(name);
    applyTheme(); applyWall(); rememberUi();
    if (reconnect) {
      state.contactStates.clear();
      transport.start(profile, settings);
    } else transport.updateProfile(profile);
    closeDialogs(); renderSidebar(); renderHeader();
    notify('Ваши настройки сохранены');
  } catch (err) { error.textContent = err.message || 'Не удалось сохранить настройки.'; error.hidden = false; }
}

async function copyCode() {
  const text = `LIBO:${state.profile.id}`;
  try {
    if (window.LiboAndroid) window.LiboAndroid.copyText(text);
    else await navigator.clipboard.writeText(text);
    notify('Личный код скопирован');
  } catch { notify('Не удалось скопировать. Выделите и скопируйте код вручную.', true); }
}

async function copyLikeCode(text) {
  try {
    if (window.LiboAndroid) window.LiboAndroid.copyText(text);
    else await navigator.clipboard.writeText(text);
    notify('Код сверки скопирован');
  } catch { notify('Не удалось скопировать. Выделите и скопируйте код вручную.', true); }
}

async function shareCode() {
  const text = `Добавьте меня в LIBO!\n\nLIBO:${state.profile.id}\n\nAPK для Android: ${APK_URL}\nДля переписки откройте приложение на обоих устройствах.`;
  try {
    if (window.LiboAndroid) window.LiboAndroid.shareText(text);
    else if (navigator.share) await navigator.share({ title: 'Мой личный код LIBO', text });
    else { await navigator.clipboard.writeText(text); notify('Приглашение скопировано вместе со ссылкой на APK'); }
  } catch (error) { if (error.name !== 'AbortError') notify('Не удалось поделиться. Используйте кнопку копирования кода.', true); }
}

function exportChats(chats) {
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
  confirmDialog('Заблокировать контакт?', 'Этот код больше не сможет подключиться к вам. Переписка удалится только с этого устройства. Собеседник сохранит свою копию.', async () => {
    try {
      await locks.get(id)?.catch(() => {});
      const blocked = [...new Set([...state.blocked, id])];
      await store.setMeta('blocked', blocked);
      state.blocked = blocked;
      transport.closeContact(id);
      await store.deleteChat(id);
      state.chats = state.chats.filter(c => c.id !== id);
      closeChat();
      delete state.drafts[id];
      localStorage.setItem('libo-v2-drafts', JSON.stringify(state.drafts));
      notify('Контакт заблокирован');
    } catch { notify('Не удалось завершить блокировку. Проверьте свободное место.', true); }
  }, 'Заблокировать');
}

function renderBlocked() {
  const list = $('#blocked-list'); list.replaceChildren();
  if (!state.blocked.length) { const p = document.createElement('p'); p.className = 'privacy-caption'; p.textContent = 'Нет заблокированных контактов.'; list.appendChild(p); }
  for (const id of state.blocked) {
    const row = document.createElement('div'); row.className = 'blocked-row';
    const code = document.createElement('code'); code.textContent = `LIBO:${id}`;
    const button = document.createElement('button'); button.textContent = 'Разблокировать';
    button.onclick = async () => {
      try { const blocked = state.blocked.filter(item => item !== id); await store.setMeta('blocked', blocked); state.blocked = blocked; renderBlocked(); notify('Контакт разблокирован. Его можно добавить заново.'); }
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
    state.attachment = { kind: 'photo', data, name: safeFilename(file.name.replace(/\.[^.]+$/, '') + '.jpg') };
    $('#attachment-image').src = data; $('#attachment-preview').hidden = false; updateComposer();
  } catch (error) { notify(error.message?.includes('сжатия') ? error.message : 'Не удалось открыть фотографию.', true); }
  finally { URL.revokeObjectURL(url); $('#photo-input').value = ''; }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}

async function attachFile(file) {
  const chat = activeChat();
  if (!file || !chat || chat.request || chat.archive) return;
  const kind = file.type.startsWith('video/') ? 'video' : 'file';
  if (file.size > MAX_ATTACH_BYTES) { notify(`Файлы и видео в этой версии — до ${Math.round(MAX_ATTACH_BYTES / 1000 / 100) / 10} МБ.`, true); return; }
  try {
    const data = await readAsDataUrl(file);
    if (data.length > MAX_ATT_DATA) throw new Error('Файл слишком большой для прямого канала.');
    state.attachment = { kind, data, name: safeFilename(file.name), mime: file.type || 'application/octet-stream' };
    $('#attachment-image').hidden = kind === 'file';
    if (kind === 'video') { $('#attachment-image').hidden = false; $('#attachment-image').src = data; }
    $('#attachment-preview').hidden = false;
    $('#attachment-label').textContent = state.attachment.name;
    updateComposer();
  } catch (error) { notify(error.message || 'Не удалось прикрепить файл.', true); }
  finally { $('#file-input').value = ''; }
}

async function toggleRecording() {
  const button = $('#voice-button');
  if (state.recording) { state.recording.stop(); return; }
  const chat = activeChat();
  if (!chat || chat.request || chat.archive || !navigator.mediaDevices || !window.MediaRecorder) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined);
    const chunks = [];
    const startedAt = Date.now();
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      state.recording = null;
      button.classList.remove('recording');
      button.setAttribute('aria-label', 'Записать голосовое сообщение');
      const dur = Date.now() - startedAt;
      if (dur < 700) { notify('Слишком короткая запись.', true); return; }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > MAX_ATTACH_BYTES) { notify('Голосовое сообщение слишком длинное: лимит 60 секунд.', true); return; }
      const data = await readAsDataUrl(blob);
      state.attachment = { kind: 'voice', data, name: 'voice.webm', mime: recorder.mimeType || 'audio/webm', dur };
      $('#attachment-image').hidden = true;
      $('#attachment-preview').hidden = false;
      $('#attachment-label').textContent = `Голосовое сообщение, ${Math.round(dur / 1000)} с`;
      updateComposer();
    };
    recorder.start();
    state.recording = recorder;
    button.classList.add('recording');
    button.setAttribute('aria-label', 'Остановить запись');
    setTimeout(() => { if (state.recording === recorder) recorder.stop(); }, MAX_VOICE_SECONDS * 1000);
  } catch { notify('Нет доступа к микрофону. Разрешите запись в настройках Android.', true); }
}

function scheduleExpiry(chatId, messageId, ttl, at) {
  const key = `${chatId}|${messageId}`;
  if (ttlTimers.has(key)) return;
  const left = at + ttl * 1000 - Date.now();
  const timer = setTimeout(() => { ttlTimers.delete(key); void expireMessage(chatId, messageId); }, Math.max(0, Math.min(left, 3_600_000)));
  ttlTimers.set(key, timer);
}

async function expireMessage(chatId, messageId) {
  await changeChat(chatId, chat => {
    const index = chat.messages.findIndex(m => m.id === messageId);
    if (index < 0 || chat.messages[index].deleted) return false;
    chat.messages[index] = { id: messageId, at: chat.messages[index].at, direction: chat.messages[index].direction, status: chat.messages[index].status, deleted: true, text: '' };
    chat.pins = (chat.pins || []).filter(pin => pin !== messageId);
  });
  transport.send(chatId, makeDeletePacket([messageId]));
  if (state.current === chatId) { renderMessages(false); renderPins(); }
  renderSidebar();
}

function sendReadReceipt(id) {
  const chat = state.chats.find(item => item.id === id);
  if (!chat || id === 'saved' || document.hidden || !transport.isOpen(id)) return;
  const lastIn = chat.messages.filter(m => m.direction === 'in' && !m.deleted).at(-1);
  if (lastIn) void transport.send(id, makeReadPacket(lastIn.at));
}

async function votePoll(messageId, opt) {
  const chat = activeChat();
  const message = chat?.messages.find(m => m.id === messageId && m.att?.kind === 'poll');
  if (!chat || !message || chat.archive) return;
  const next = (message.att.votes || {}).mine === opt ? null : opt;
  await changeChat(chat.id, nextChat => {
    const index = nextChat.messages.findIndex(m => m.id === messageId);
    if (index < 0) return false;
    const att = { ...nextChat.messages[index].att, votes: mergePollVote(nextChat.messages[index].att.votes, 'mine', next) };
    nextChat.messages[index] = { ...nextChat.messages[index], att };
  });
  if (chat.id !== 'saved') void transport.send(chat.id, makePollVotePacket(messageId, next ?? -1));
  renderMessages(false);
}

function openForwardDialog(messageIds) {
  const chat = activeChat();
  if (!chat || chat.archive) return;
  state.forwardIds = messageIds;
  const list = $('#forward-list');
  list.replaceChildren();
  const targets = state.chats.filter(item => item.id !== chat.id && !item.archive && !item.request);
  if (!targets.length) {
    const p = document.createElement('p'); p.className = 'privacy-caption';
    p.textContent = 'Нет других чатов: добавьте контакт, чтобы пересылать сообщения.';
    list.appendChild(p);
  }
  for (const target of targets) {
    const button = document.createElement('button');
    button.className = 'forward-row';
    button.dataset.forwardTo = target.id;
    button.innerHTML = `<span class="avatar ${target.id === 'saved' ? 'saved' : avatarColor(target.id)}"></span><span></span>`;
    button.querySelector('.avatar').textContent = target.id === 'saved' ? '' : initials(target.name);
    if (target.id === 'saved') button.querySelector('.avatar').innerHTML = svg('bookmark');
    button.lastElementChild.textContent = target.name;
    list.appendChild(button);
  }
  openDialog('forward-dialog');
}

async function forwardTo(targetId) {
  const source = activeChat();
  const ids = state.forwardIds || [];
  if (!source || !ids.length) return;
  const stamp = Date.now();
  let count = 0;
  for (const [offset, messageId] of ids.entries()) {
    const original = source.messages.find(m => m.id === messageId);
    if (!original || original.deleted) continue;
    const copy = {
      id: crypto.randomUUID(), text: original.text,
      image: original.image ? { ...original.image } : null,
      att: original.att ? { ...original.att, votes: original.att.kind === 'poll' ? {} : original.att.votes } : null,
      reply: null, fwd: { from: original.direction === 'out' ? state.profile.name : source.name },
      at: stamp + offset, direction: 'out', status: targetId === 'saved' ? 'local' : 'queued',
    };
    await changeChat(targetId, next => { makeRoom(next); next.messages.push(copy); next.updatedAt = copy.at; });
    count++;
  }
  closeDialogs();
  renderSidebar();
  notify(count ? `Переслано сообщений: ${count}` : 'Нечего пересылать.', !count);
  void flushPending(targetId);
}

function setSelection(idsOrNull) {
  state.selection = idsOrNull ? new Set(idsOrNull) : null;
  $('#selection-bar').hidden = !state.selection;
  updateSelectionCount();
  renderMessages(false);
}

function updateSelectionCount() {
  $('#selection-count').textContent = `Выбрано: ${state.selection?.size || 0}`;
}

async function setFolder(folder) {
  const chat = activeChat();
  if (!chat || chat.id === 'saved') return;
  await changeChat(chat.id, next => { next.folder = folder || ''; });
  closeChatMenu();
  renderSidebar();
  notify(folder ? `Чат в папке «${FOLDERS[folder]}»` : 'Чат вне папок');
}

async function toggleMute() {
  const chat = activeChat();
  if (!chat || chat.id === 'saved') return;
  await changeChat(chat.id, next => { next.muted = !next.muted; });
  closeChatMenu();
  renderHeader(); renderSidebar();
  notify(chat.muted ? 'Звук чата включён' : 'Чат без звука');
}

const LOCK_KEY = 'libo-lock';

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function lockState() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch { return null; }
}

async function setLock(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(LOCK_KEY, JSON.stringify({ salt: btoa(String.fromCharCode(...salt)), hash: await hashPin(pin, salt) }));
}

async function tryUnlock() {
  const stored = lockState();
  const pin = $('#lock-input').value.trim();
  const error = $('#lock-error');
  error.hidden = true;
  if (!stored) { unlockResolve?.(); return; }
  const hash = await hashPin(pin, Uint8Array.from(atob(stored.salt), char => char.charCodeAt(0)));
  if (hash !== stored.hash) {
    error.textContent = 'Неверный код-замок. Данные останутся на устройстве.';
    error.hidden = false;
    $('#lock-input').value = '';
    return;
  }
  unlockResolve?.();
}

function applyWall() {
  document.documentElement.dataset.wall = WALLPAPERS.includes(state.settings?.wall) ? state.settings.wall : 'plain';
}

function playMessageSound(chatId = null) {
  if (!state.settings.sound) return;
  const chat = state.chats.find(item => item.id === (chatId ?? state.current));
  if (chat?.muted) return;
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
  if (state.selection) { setSelection(null); return true; }
  const open = $('dialog[open]');
  if (open) { open.close(); return true; }
  if (!$('#emoji-picker').hidden) { $('#emoji-picker').hidden = true; $('#emoji-button').setAttribute('aria-expanded', 'false'); return true; }
  if (!$('#chat-menu').hidden) { closeChatMenu(); return true; }
  if (!$('#message-actions').hidden) { closeMessageActions(); return true; }
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
    if (state.settings.sound) {
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
  $$('.folder-tab').forEach(tab => {
    tab.onclick = () => {
      state.folderTab = tab.dataset.folder;
      $$('.folder-tab').forEach(other => { const active = other === tab; other.classList.toggle('active', active); other.setAttribute('aria-pressed', String(active)); });
      renderSidebar();
    };
  });
  document.addEventListener('click', event => {
    const goto = event.target.closest('[data-goto]');
    if (!goto) return;
    const [chatId, messageId] = goto.dataset.goto.split('|');
    state.highlight = messageId;
    void openChat(chatId).then(() => {
      const row = document.querySelector(`[data-message-id="${messageId}"]`);
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { state.highlight = null; }, 2400);
    });
  });
  $('#nav-chats').onclick = closeChat;
  $('#nav-saved').onclick = () => void openChat('saved');
  $('#chat-back').onclick = closeChat;
  for (const type of ['all', 'unread']) $(`#filter-${type}`).onclick = () => {
    state.filter = type;
    $$('.filter').forEach(button => { const active = button.id === `filter-${type}`; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    renderSidebar();
  };
  $('#composer').onsubmit = sendMessage;
  $('#message-input').addEventListener('input', () => {
    updateComposer(); rememberDraft();
    if (state.current !== 'saved' && Date.now() - typingSentAt > 1000) {
      typingSentAt = Date.now(); transport.send(state.current, { v: 1, type: 'typing', active: !!$('#message-input').value });
    }
  });
  $('#message-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage(); }
  });
  $('#theme-toggle').onclick = () => void setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $$('button[data-theme]').forEach(button => { button.onclick = () => void setTheme(button.dataset.theme); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  $('#copy-code').onclick = copyCode;
  $('#share-code').onclick = shareCode;
  $('#reconnect').onclick = () => {
    if (state.networkDetail) notify(state.networkDetail, true);
    state.contactStates.clear(); transport.start(state.profile, state.settings);
  };
  $('#chat-more').onclick = () => { const open = $('#chat-menu').hidden; $('#chat-menu').hidden = !open; $('#chat-more').setAttribute('aria-expanded', String(open)); };
  $('#message-search-toggle').onclick = () => { $('#message-search-bar').hidden = false; $('#message-search').focus(); };
  $('#message-search').oninput = () => renderMessages(false);
  $('#close-message-search').onclick = () => { closeMessageSearch(); renderMessages(); };
  $('#export-all').onclick = () => exportChats(state.chats);
  $('#export-chat').onclick = () => { if (activeChat()) exportChats([activeChat()]); closeChatMenu(); };
  $('#verify-code').onclick = () => { closeChatMenu(); void showVerifyCode(); };
  $('#copy-verify').onclick = () => { const text = $('#verify-value').textContent; if (text) void copyLikeCode(text); };
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
    try { await changeChat(id, chat => { chat.request = false; }); renderHeader(); renderSidebar(); await flushPending(id); }
    catch { notify('Не удалось принять запрос.', true); }
  };
  $('#messages').onclick = event => {
    const chat = activeChat(); if (!chat) return;
    const voteButton = event.target.closest('[data-vote]');
    if (voteButton) { void votePoll(voteButton.dataset.messageId, Number(voteButton.dataset.vote)); return; }
    if (state.selection) {
      const target = event.target.closest('[data-message-id]');
      if (target) {
        const id = target.dataset.messageId;
        if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
        updateSelectionCount();
        renderMessages(false);
      }
      return;
    }
    const actionsButton = event.target.closest('[data-actions]');
    if (actionsButton) { openMessageActions(actionsButton, actionsButton.dataset.actions); return; }
    const reactionChip = event.target.closest('[data-react]');
    if (reactionChip) { void actOnMessage('react', reactionChip.dataset.messageId, reactionChip.dataset.react); return; }
    const attachButton = event.target.closest('[data-attach]');
    if (attachButton) {
      const owner = chat.messages.find(m => m.id === attachButton.dataset.attach);
      if (owner?.att) {
        const link = document.createElement('a');
        link.href = owner.att.data; link.download = owner.att.name;
        document.body.appendChild(link); link.click(); link.remove();
      }
      return;
    }
    const replyButton = event.target.closest('[data-reply]');
    const photo = event.target.closest('[data-photo]');
    if (replyButton) {
      if (chat.request) { notify('Сначала примите запрос на общение.', true); return; }
      const message = chat.messages.find(m => m.id === replyButton.dataset.reply);
      if (!message) return;
      state.reply = { text: (message.text || 'Фотография').slice(0, 160), name: message.direction === 'out' ? state.profile.name : chat.name };
      $('#reply-name').textContent = state.reply.name; $('#reply-text').textContent = state.reply.text; $('#reply-bar').hidden = false; $('#message-input').focus();
    }
    if (photo) {
      const message = chat.messages.find(m => m.id === photo.dataset.photo);
      if (message?.image) { openDialog('photo-dialog'); $('#full-photo').src = message.image.data; }
    }
  };
  $('#cancel-reply').onclick = () => { state.reply = null; $('#reply-bar').hidden = true; };
  $('#message-actions').addEventListener('click', event => {
    const pick = event.target.closest('[data-react-pick]');
    const messageId = $('#message-actions').dataset.messageId;
    if (pick) { void actOnMessage('react', messageId, pick.dataset.reactPick); closeMessageActions(); return; }
    const action = event.target.closest('[data-act]');
    if (!action) return;
    closeMessageActions();
    void actOnMessage(action.dataset.act, messageId, undefined);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#message-actions, [data-actions]')) closeMessageActions();
  });
  $('#pinned-jump').onclick = () => {
    const chat = activeChat();
    const id = chat?.pins?.at(-1);
    const row = id && document.querySelector(`[data-message-id="${id}"]`);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  $('#pinned-unpin').onclick = () => {
    const chat = activeChat();
    const id = chat?.pins?.at(-1);
    if (id) void actOnMessage('pin', id);
  };
  $('#security-button').onclick = () => void openSecurity();
  $('#star-contact').onclick = () => void toggleStar();
  $('#mute-contact').onclick = () => void toggleMute();
  $('#select-mode').onclick = () => { closeChatMenu(); setSelection([]); };
  $('#folder-personal').onclick = () => void setFolder('personal');
  $('#folder-work').onclick = () => void setFolder('work');
  $('#folder-none').onclick = () => void setFolder('');
  $('#selection-cancel').onclick = () => setSelection(null);
  $('#selection-delete').onclick = () => {
    const ids = [...(state.selection || [])];
    if (!ids.length) return;
    confirmDialog('Удалить выбранное для обоих?', `Сообщений: ${ids.length}. Они исчезнут на этом устройстве и у собеседника.`, async () => {
      const chat = activeChat();
      if (!chat) return;
      await changeChat(chat.id, next => {
        next.messages = next.messages.map(m => ids.includes(m.id) ? { id: m.id, at: m.at, direction: m.direction, status: m.status, deleted: true, text: '' } : m);
        next.pins = (next.pins || []).filter(pin => !ids.includes(pin));
      });
      transport.send(chat.id, makeDeletePacket(ids));
      setSelection(null);
      renderMessages(false); renderPins(); renderSidebar();
    }, 'Удалить');
  };
  $('#selection-forward').onclick = () => { const ids = [...(state.selection || [])]; if (ids.length) openForwardDialog(ids); };
  $('#forward-list').onclick = event => {
    const row = event.target.closest('[data-forward-to]');
    if (row) void forwardTo(row.dataset.forwardTo);
  };
  $('#ttl-button').onclick = () => {
    const index = TTL_OPTIONS.indexOf(state.ttl);
    state.ttl = TTL_OPTIONS[(index + 1) % TTL_OPTIONS.length];
    const button = $('#ttl-button');
    button.classList.toggle('ttl-off', !state.ttl);
    $('#ttl-label').textContent = { 10: '10с', 60: '1м', 3600: '1ч' }[state.ttl] || '';
    button.title = state.ttl ? `Секретный таймер: ${$('#ttl-label').textContent}` : 'Секретный таймер: выключен';
    notify(state.ttl ? `Новые сообщения исчезнут через ${$('#ttl-label').textContent}` : 'Секретный таймер выключен');
  };
  $('#poll-button').onclick = () => {
    $('#poll-q').value = '';
    $$('.poll-opt').forEach(input => { input.value = ''; });
    $('#poll-error').hidden = true;
    openDialog('poll-dialog');
    $('#poll-q').focus();
  };
  $('#poll-send').onclick = () => {
    const q = $('#poll-q').value.trim();
    const opts = $$('.poll-opt').map(input => input.value.trim()).filter(Boolean);
    const error = $('#poll-error');
    error.hidden = true;
    if (!q) { error.textContent = 'Напишите вопрос.'; error.hidden = false; return; }
    if (opts.length < 2) { error.textContent = 'Нужно минимум два варианта ответа.'; error.hidden = false; return; }
    state.attachment = { kind: 'poll', q: q.slice(0, 300), opts: opts.slice(0, 4), votes: {} };
    $('#attachment-image').hidden = true;
    $('#attachment-preview').hidden = false;
    $('#attachment-label').textContent = `Опрос: ${state.attachment.q}`;
    closeDialogs();
    updateComposer();
  };
  $('#lock-set').onclick = async () => {
    const pin = $('#lock-pin').value.trim();
    if (!/^\d{4,8}$/.test(pin)) { notify('PIN: от 4 до 8 цифр.', true); return; }
    await setLock(pin);
    $('#lock-state').value = 'Включён';
    $('#lock-pin').value = '';
    notify('Код-замок включён: он потребуется при следующем запуске');
  };
  $('#lock-off').onclick = () => {
    localStorage.removeItem(LOCK_KEY);
    $('#lock-state').value = 'Выключен';
    notify('Код-замок выключен');
  };
  $('#wall-select').onchange = async () => {
    await setTheme(state.settings.theme);
    state.settings = { ...state.settings, wall: $('#wall-select').value };
    applyWall(); rememberUi();
    try { await store.setMeta('settings', state.settings); } catch { notify('Фон не сохранён.', true); }
  };
  $('#lock-unlock').onclick = () => void tryUnlock();
  $('#lock-input').onkeydown = event => { if (event.key === 'Enter') void tryUnlock(); };
  $('#voice-button').onclick = () => void toggleRecording();
  $('#file-button').onclick = () => $('#file-input').click();
  $('#file-input').onchange = () => void attachFile($('#file-input').files[0]);
  $('#import-backup').onclick = () => $('#import-input').click();
  $('#import-input').onchange = () => void importBackup($('#import-input').files[0]);
  $('#edit-save').onclick = () => void submitEdit();
  $('#attach-button').onclick = () => $('#photo-input').click();
  $('#photo-input').onchange = () => void attachPhoto($('#photo-input').files[0]);
  $('#remove-attachment').onclick = () => { photoGeneration++; state.attachment = null; $('#attachment-preview').hidden = true; $('#attachment-image').removeAttribute('src'); updateComposer(); };
  buildEmojiPicker();
  $('#emoji-button').onclick = () => {
    buildEmojiPicker();
    $('#emoji-picker').hidden = !$('#emoji-picker').hidden;
    $('#emoji-button').setAttribute('aria-expanded', String(!$('#emoji-picker').hidden));
  };
  window.addEventListener('online', () => { if (state.network !== 'ready') transport.start(state.profile, state.settings); });
  window.addEventListener('offline', () => { state.network = 'offline'; renderNetwork(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) rememberDraft();
    else {
      if (state.current) void changeChat(state.current, chat => { if (!chat.unread) return false; chat.unread = 0; }).then(renderSidebar).catch(() => {});
      retryConnections();
    }
  });
  window.addEventListener('pagehide', () => { rememberDraft(); void store.setMeta('lastSeen', Object.fromEntries(state.lastSeen)).catch(() => {}); transport.stop(); });
  window.addEventListener('pageshow', event => { if (event.persisted) transport.start(state.profile, state.settings); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !$('dialog[open]')) { event.preventDefault(); closeChat(); $('#chat-search').focus(); }
    if (event.key === 'Escape' && !$('dialog[open]')) handleBack();
  });
  window.Libo = { handleBack, onExportSaved: () => notify('Экспорт сохранён') };
}

let emojiBuilt = false;
function buildEmojiPicker() {
  if (emojiBuilt) return;
  emojiBuilt = true;
  for (const emoji of ['😊', '💜', '', '✨', '👍', '❤️', '😂', '🥰', '', '', '🤗', '☕']) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = emoji; button.setAttribute('aria-label', emoji);
    button.onclick = () => {
      const input = $('#message-input');
      if (input.value.length + emoji.length > MAX_TEXT) return;
      input.setRangeText(emoji, input.selectionStart, input.selectionEnd, 'end');
      input.focus(); updateComposer(); rememberDraft();
    };
    $('#emoji-picker').appendChild(button);
  }
}

async function main() {
  await store.open();
  state.profile = await store.getMeta('profile');
  if (!state.profile || !normalizePeerCode(state.profile.id)) {
    state.profile = { id: makePeerId(), name: 'Пользователь LIBO' };
    await store.setMeta('profile', state.profile);
  }
  const defaultServer = import.meta.env.DEV ? new URL('/peerjs', location.origin).href : 'https://0.peerjs.com';
  state.settings = {
    theme: 'light', sound: false, signalUrl: defaultServer, turnUrl: '', turnUser: '', turnPassword: '',
    ...recallUi(), ...await store.getMeta('settings'),
  };
  state.blocked = await store.getMeta('blocked') || [];
  state.chats = await store.getChats();
  state.chats = state.chats.filter(chat => !state.blocked.includes(chat.id));
  if (!state.chats.some(chat => chat.id === 'saved')) {
    await changeChat('saved', chat => { chat.name = 'Избранное'; }, { request: false });
  }
  try { state.drafts = JSON.parse(localStorage.getItem('libo-v2-drafts') || '{}') || {}; } catch { state.drafts = {}; }
  $('#profile-button').textContent = initials(state.profile.name);
  $('#app-version').textContent = VERSION;
  $$('.github-link').forEach(link => { link.href = REPO_URL; });
  $('#download-apk').href = APK_URL;
  const savedSeen = await store.getMeta('lastSeen');
  if (savedSeen && typeof savedSeen === 'object') for (const [id, at] of Object.entries(savedSeen)) state.lastSeen.set(id, at);
  if (!window.MediaRecorder || !navigator.mediaDevices) $('#voice-button').hidden = true;
  bindEvents(); applyTheme(); applyWall(); renderSidebar(); renderNetwork();
  if (lockState()) {
    $('#lock-screen').hidden = false;
    setTimeout(() => $('#lock-input').focus(), 50);
    await new Promise(resolve => { unlockResolve = resolve; });
    $('#lock-screen').hidden = true;
  }
  transport.start(state.profile, state.settings);
  setInterval(retryConnections, 6000);
}

main().catch(error => {
  const banner = $('#boot-error');
  banner.hidden = false;
  banner.textContent = `LIBO не может открыть хранилище. Проверьте свободное место, разрешите хранение данных в браузере и обновите Android System WebView. Данные не отправлены в сеть. ${error.message || ''}`;
  console.error('LIBO startup failed', error);
});
