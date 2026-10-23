import qrcode from 'qrcode-generator';
import { Store } from './lib/storage.mjs';
import { Transport } from './lib/transport.mjs';
import { AttachmentTransferManager, bytesToBase64, sha256Blob } from './lib/attachments.mjs';
import {
  APK_URL, VERSION, MAX_TEXT, MAX_MESSAGES, MAX_CHATS, MAX_VOICE_SECONDS,
  MAX_IMAGE_FILE_SIZE, MAX_VOICE_MESSAGE_SIZE, FILE_CHUNK_SIZE, MAX_PINS,
  FEATURES, REACTIONS, REACTION_EMOJI, CAPABILITIES,
  makePeerId, makeFileId, normalizePeerCode, normalizeName, normalizeUsername, normalizeBio,
  initials, avatarColor, previewText, safeFilename, parseSignalingUrl, makeIceServers,
  toPacket, textExport, verificationCode, classifyAttachment, maxAttachmentBytes, normalizeMime,
  makeAckPacket, makeEditPacket, makeDeletePacket, makePinPacket, makeReactPacket,
  makeReadPacket, makePollVotePacket, mergePollVote, pollTally,
  TTL_OPTIONS, WALLPAPERS, FOLDERS, makeLiboLink, parseLiboLink,
} from './lib/core.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const svg = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const store = new Store();
const state = {
  profile: null, settings: null, chats: [], blocked: [], current: null, loadingChat: null, storageReady: false,
  filter: 'all', network: 'connecting', networkDetail: '', contactStates: new Map(),
  typing: new Map(), drafts: {}, reply: null, attachment: null, sending: false,
  lastSeen: new Map(), recording: null, archiveNotice: false,
  folderTab: '', selection: null, ttl: 0, highlight: null,
  transfers: new Map(), attachmentUrls: new Map(), attachmentPreviewUrl: '', pendingAudioFile: null, nativeSave: null,
  mentionTarget: null, reminders: [], attachmentRenderGeneration: 0,
  // A call only exists while PeerJS has a live MediaConnection. No message state or
  // decorative timer is used as a substitute for an actual WebRTC call.
  call: null, callTerminalTimer: null,
};
const ttlTimers = new Map();
const reminderTimers = new Map();
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
let draftPersistTimer;
let transferManager;
let chatOpenSequence = 0;

const transport = new Transport({
  onState(status, detail = '') {
    state.network = status;
    state.networkDetail = detail;
    renderNetwork();
    renderHeader();
  },
  onReady: retryConnections,
  isAllowed: id => !!normalizePeerCode(id) && id !== state.profile?.id && !state.blocked.includes(id),
  async onHello(id, name, caps = [], profile = null) {
    await changeChat(id, chat => {
      chat.name = name;
      chat.capabilities = Array.isArray(caps) ? caps.filter(cap => CAPABILITIES.includes(cap)) : [];
      if (profile) {
        chat.username = profile.username || '';
        chat.bio = profile.bio || '';
        chat.presenceStatus = profile.status || 'online';
        chat.avatar = profile.avatar || '';
      }
    }, { request: true });
    renderSidebar();
    if (state.current === id) { renderHeader(); renderProfileAvatar(); }
  },
  onContactState(id, status) {
    state.contactStates.set(id, status);
    if (status === 'online') state.lastSeen.set(id, Date.now());
    else if (state.contactStates.get(id) !== 'offline') { state.lastSeen.set(id, Date.now()); void store.setMeta('lastSeen', Object.fromEntries(state.lastSeen)).catch(() => {}); }
    if (status !== 'online') state.typing.delete(id);
    renderSidebar();
    if (state.current === id) renderHeader();
  },
  onConnected(id) { void flushPending(id); void resumeTransfers(id); },
  async onMessage(id, packet) {
    try {
      let fresh = false;
      const receivedAt = Date.now();
      await changeChat(id, chat => {
        if (chat.messages.some(m => m.id === packet.id)) return false;
        if (chat.request && chat.messages.length >= 10) throw new Error('Сначала примите запрос на общение.');
        // Do not evict undelivered outgoing messages to make room for an incoming message.
        makeRoom(chat);
        fresh = true;
        chat.messages.push({
          id: packet.id, text: packet.text, image: packet.image, reply: packet.reply,
          att: packet.att || null, mentions: packet.mentions || [], editedAt: packet.editedAt || null,
          ttl: packet.ttl || 0, fwd: packet.fwd || null,
          timing: { ...(packet.timing || {}), recipientReceivedAt: receivedAt },
          at: Math.min(packet.at, Date.now() + 60_000), direction: 'in',
          status: isChunkedAttachment(packet.att) ? 'receiving' : 'received',
        });
        if (state.current !== id || document.hidden) chat.unread = (chat.unread || 0) + 1;
        chat.updatedAt = Date.now();
      });
      if (isChunkedAttachment(packet.att)) await prepareIncomingAttachment(id, packet.att);
      // An ACK is emitted only after message metadata (and, for a file, its receiving
      // record) have committed to IndexedDB. It is not a fake file-delivery receipt.
      await transport.send(id, makeAckPacket(packet.id, receivedAt));
      state.typing.delete(id);
      if (fresh) {
        if (packet.ttl) scheduleExpiry(id, packet.id, packet.ttl, packet.at);
        renderSidebar();
        if (state.current === id) { renderMessages(); renderHeader(); sendReadReceipt(id); noteIncoming(); }
        playMessageSound(id);
      }
    } catch (error) {
      transport.closeContact(id);
      notify(error.message?.includes('запрос') ? error.message : 'Сообщение не сохранено: проверьте свободное место на устройстве.', true);
    }
  },
  async onAck(id, messageId, ack = {}) {
    try {
      await changeChat(id, chat => {
        const index = chat.messages.findIndex(m => m.id === messageId && m.direction === 'out');
        if (index < 0 || chat.messages[index].status === 'delivered') return false;
        const message = chat.messages[index];
        chat.messages[index] = {
          ...message,
          // File metadata is safely accepted here, but Delivered waits for file-ack
          // after every chunk has been assembled and SHA-256 verified.
          status: isChunkedAttachment(message.att) ? 'uploading' : 'delivered',
          timing: { ...(message.timing || {}), ...(ack.recipientReceivedAt ? { recipientReceivedAt: ack.recipientReceivedAt } : {}), ackAt: Date.now() },
        };
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
      const previous = chat.messages[index];
      const edits = [...(previous.edits || []), { text: previous.text, at: previous.editedAt || previous.at }].slice(-20);
      chat.messages[index] = { ...previous, text: packet.text, editedAt: packet.editedAt, edits };
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
  async onRead(id, upTo, readAt = Date.now()) {
    await changeChat(id, chat => {
      if ((chat.readUpTo || 0) >= upTo) return false;
      chat.readUpTo = upTo;
      chat.readAt = readAt;
      chat.messages = chat.messages.map(message => message.direction === 'out' && message.at <= upTo
        ? { ...message, timing: { ...(message.timing || {}), readAt } } : message);
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
  onFileChunk(id, packet) { return transferManager?.onFileChunk(id, packet); },
  onFileReceipt(id, packet) { return transferManager?.onFileReceipt(id, packet); },
  onFileResume(id, packet) { return transferManager?.onFileResume(id, packet); },
  onFileState(id, packet) { return transferManager?.onFileState(id, packet); },
  onFileComplete(id, packet) { return transferManager?.onFileComplete(id, packet); },
  onFileMissing(id, packet) { return transferManager?.onFileMissing(id, packet); },
  onFileAck(id, packet) { return transferManager?.onFileAck(id, packet); },
  onFileCancel(id, packet) { return transferManager?.onFileCancel(id, packet); },
  onSecurity(id) { if (state.current === id && $('#security-dialog').open) void openSecurity(); },
  onMtDrop(id) {
    // A key generation change swallowed an envelope: let the queue retransmit at once.
    const chat = state.chats.find(item => item.id === id);
    if (chat) for (const message of chat.messages) lastSent.delete(message.id);
    void flushPending(id);
  },
  onIncomingCall({ id, kind }) {
    if (state.call) { transport.rejectCall(id, 'Линия занята.'); return; }
    const chat = state.chats.find(item => item.id === id);
    if (!chat) { transport.rejectCall(id, 'Неизвестный контакт.'); return; }
    state.call = { peerId: id, kind, direction: 'incoming', status: 'ringing', detail: '', localStream: null, remoteStream: null, muted: false, cameraOff: false };
    renderCall();
  },
  onCallState(id, status, detail = '', meta = {}) {
    if (!state.call || state.call.peerId !== id) return;
    state.call = { ...state.call, status, detail: detail || state.call.detail, kind: meta.kind || state.call.kind, direction: meta.direction || state.call.direction };
    renderCall();
  },
  onCallStream(id, stream) {
    if (!state.call || state.call.peerId !== id) return;
    state.call = { ...state.call, remoteStream: stream, status: 'connected', detail: '' };
    renderCall();
    void refreshCallDiagnostics();
  },
  onCallEnded(id, status, detail = '', meta = {}) {
    if (!state.call || state.call.peerId !== id) return;
    const finished = { ...state.call, status, detail: detail || terminalCallDetail(status), kind: meta.kind || state.call.kind, direction: meta.direction || state.call.direction };
    stopLocalCallStream(finished.localStream);
    state.call = finished;
    renderCall();
    clearTimeout(state.callTerminalTimer);
    state.callTerminalTimer = setTimeout(() => { if (state.call?.peerId === id) { state.call = null; renderCall(); renderHeader(); } }, 1800);
  },
  onStorageError() { notify('Не удалось сохранить контакт. Проверьте свободное место.', true); },
});

function isChunkedAttachment(att) {
  return Boolean(att?.fileId && Number.isInteger(att.totalChunks) && Number.isInteger(att.size));
}

async function prepareIncomingAttachment(peerId, att) {
  const existing = await store.getAttachment(att.fileId);
  if (existing && (existing.peerId !== peerId || existing.direction !== 'in')) throw new Error('Получен конфликтующий идентификатор файла.');
  if (existing && ['size', 'chunkSize', 'totalChunks', 'sha256', 'mime'].some(key => existing[key] !== att[key])) {
    throw new Error('Метаданные файла с повторным идентификатором не совпадают.');
  }
  if (existing?.state === 'received' && existing.sha256 === att.sha256) return existing;
  const record = {
    ...(existing || {}), ...att, id: att.fileId, peerId, direction: 'in',
    state: existing?.state === 'receiving' ? 'receiving' : 'receiving',
    nextChunk: Number.isInteger(existing?.nextChunk) ? existing.nextChunk : 0,
    receivedBytes: Number.isInteger(existing?.receivedBytes) ? existing.receivedBytes : 0,
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(), error: '',
  };
  await store.putAttachment(record);
  state.transfers.set(att.fileId, { state: record.state, receivedBytes: record.receivedBytes, size: att.size, totalChunks: att.totalChunks, nextChunk: record.nextChunk });
  return record;
}

async function markAttachmentDelivered({ fileId, peerId, chatId, messageId }) {
  const candidates = chatId ? [state.chats.find(chat => chat.id === chatId)].filter(Boolean) : state.chats.filter(chat => chat.id === peerId);
  for (const chat of candidates) {
    const message = chat.messages.find(item => item.id === messageId || item.att?.fileId === fileId);
    if (!message || message.direction !== 'out') continue;
    await changeChat(chat.id, next => {
      const index = next.messages.findIndex(item => item.id === message.id || item.att?.fileId === fileId);
      if (index < 0 || next.messages[index].status === 'delivered') return false;
      next.messages[index] = { ...next.messages[index], status: 'delivered', timing: { ...(next.messages[index].timing || {}), ackAt: Date.now() } };
    });
    if (state.current === chat.id) renderMessages(false);
    renderSidebar();
    break;
  }
}

async function markIncomingAttachmentComplete(record) {
  for (const chat of state.chats) {
    const message = chat.messages.find(item => item.att?.fileId === record.id && item.direction === 'in');
    if (!message) continue;
    await changeChat(chat.id, next => {
      const index = next.messages.findIndex(item => item.att?.fileId === record.id && item.direction === 'in');
      if (index < 0) return false;
      next.messages[index] = { ...next.messages[index], status: 'received' };
    });
    if (state.current === chat.id) renderMessages(false);
    break;
  }
}

function reportTransfer(fileId, details) {
  state.transfers.set(fileId, { ...(state.transfers.get(fileId) || {}), ...details });
  updateAttachmentNodes(fileId);
}

async function resumeTransfers(peerId) {
  const chat = state.chats.find(item => item.id === peerId);
  if (!chat || !transferManager || !transport.supports(peerId, 'chunk-files-v1')) return;
  const items = chat.messages
    .filter(message => message.direction === 'out' && isChunkedAttachment(message.att) && !['delivered', 'local'].includes(message.status))
    .map(message => ({ chatId: chat.id, messageId: message.id, att: message.att, status: message.status }));
  await transferManager.resumeForPeer(peerId, items);
}

transferManager = new AttachmentTransferManager({
  store,
  transport,
  onProgress: reportTransfer,
  onOutgoingComplete: markAttachmentDelivered,
  onIncomingComplete: markIncomingAttachmentComplete,
  onError(fileId, message) { notify(`Передача файла остановлена: ${message}`, true); },
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
  if (!el) return;
  el.className = `network-status ${state.network}`;
  el.dataset.state = state.network;
  el.querySelector('span').textContent = {
    ready: 'Сигнал доступен', connecting: 'Подключаемся к сигналу…',
    offline: 'Связь с сигналом потеряна', error: 'Сигнальный сервер недоступен',
  }[state.network] || 'Статус сигнала неизвестен';
  el.title = state.networkDetail || 'Это только связь с сигнальным сервером PeerJS, а не статус собеседника. История хранится на этом устройстве; облачной синхронизации нет.';
}

function renderStorage() {
  const el = $('#storage-status');
  if (!el) return;
  el.className = `storage-status ${state.storageReady ? 'ready' : 'waiting'}`;
  el.querySelector('span').textContent = state.storageReady ? 'История локально' : 'Открываем локальную историю…';
  el.title = state.storageReady
    ? 'История и черновики хранятся только на этом устройстве. Облачной синхронизации нет.'
    : 'Подключаем локальное хранилище этого устройства.';
}

function hideBootLoader() {
  const loader = $('#boot-loader');
  if (!loader || loader.hidden) return;
  loader.classList.add('is-hidden');
  loader.setAttribute('aria-hidden', 'true');
  setTimeout(() => { loader.hidden = true; }, 260);
}

function paintAvatar(element, { name, id, avatar = '', saved = false }) {
  if (!element) return;
  element.className = `avatar ${saved ? 'saved' : avatarColor(id)}`;
  element.style.backgroundImage = '';
  element.style.backgroundSize = '';
  element.style.backgroundPosition = '';
  if (saved) { element.innerHTML = svg('bookmark'); return; }
  element.textContent = initials(name);
  if (avatar) {
    element.style.backgroundImage = `url("${avatar}")`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.textContent = '';
  }
}

function renderProfileAvatar() {
  if (!state.profile) return;
  const own = { name: state.profile.name, id: state.profile.id, avatar: state.profile.avatar || '' };
  paintAvatar($('#settings-avatar'), own);
  const top = $('#profile-button');
  if (top) {
    top.textContent = initials(state.profile.name);
    top.style.backgroundImage = own.avatar ? `url("${own.avatar}")` : '';
    top.style.backgroundSize = own.avatar ? 'cover' : '';
    top.style.backgroundPosition = own.avatar ? 'center' : '';
  }
}

function displayStatus(status) {
  return { online: 'В сети', away: 'Отошёл(ла)', busy: 'Не беспокоить', offline: 'Не в сети' }[status] || 'Не в сети';
}

function openContactProfile(id = state.current) {
  // A mention of the local user is meaningful too: show the same read-only profile
  // card rather than silently doing nothing because there is no self-chat record.
  const self = id === state.profile?.id;
  const chat = self ? { ...state.profile, presenceStatus: state.profile.status } : state.chats.find(item => item.id === id);
  if (!chat || chat.id === 'saved') return;
  paintAvatar($('#contact-profile-avatar'), { name: chat.name, id: chat.id, avatar: chat.avatar || '' });
  $('#contact-profile-name').textContent = chat.name;
  $('#contact-profile-username').textContent = chat.username ? `@${chat.username}` : 'Username не задан';
  $('#contact-profile-status').textContent = !self && transport.isOpen(chat.id) ? 'В сети · прямое соединение' : displayStatus(chat.presenceStatus);
  $('#contact-profile-bio').textContent = chat.bio || 'Нет описания';
  $('#contact-profile-code').textContent = makeLiboLink('user', chat.id);
  openDialog('profile-dialog');
}

function parseSearchQuery(raw) {
  const filter = { words: [], from: '', in: '', media: '', hasLink: false, hasMedia: false, before: null, after: null };
  for (const token of String(raw || '').trim().match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
    const clean = token.replace(/^"|"$/g, '');
    const lower = clean.toLocaleLowerCase('ru');
    if (lower.startsWith('from:@')) filter.from = normalizeUsername(lower.slice(6));
    else if (lower.startsWith('in:')) filter.in = lower.slice(3).replace(/^@/, '');
    else if (['audio:', 'video:', 'file:'].includes(lower)) filter.media = lower.slice(0, -1);
    else if (lower === 'has:link') filter.hasLink = true;
    else if (lower === 'has:media') filter.hasMedia = true;
    else if (lower.startsWith('before:')) { const at = Date.parse(lower.slice(7)); if (Number.isFinite(at)) filter.before = at; }
    else if (lower.startsWith('after:')) { const at = Date.parse(lower.slice(6)); if (Number.isFinite(at)) filter.after = at; }
    else if (clean) filter.words.push(lower);
  }
  return filter;
}

function messageMatchesSearch(message, filter) {
  if (message.deleted) return false;
  const kind = message.att?.kind || (message.image ? 'image' : '');
  if (filter.media === 'audio' && !['audio', 'music', 'voice'].includes(kind)) return false;
  if (filter.media === 'video' && kind !== 'video') return false;
  if (filter.media === 'file' && !['file', 'audio', 'music', 'voice', 'video', 'image'].includes(kind)) return false;
  if (filter.hasMedia && !kind) return false;
  const joined = `${message.text || ''} ${message.att?.name || ''} ${message.att?.title || ''} ${message.att?.artist || ''}`.toLocaleLowerCase('ru');
  if (filter.hasLink && !/(?:https?:\/\/|libo:\/\/)/i.test(joined)) return false;
  if (filter.before && message.at >= filter.before) return false;
  if (filter.after && message.at <= filter.after) return false;
  return filter.words.every(word => joined.includes(word));
}

function localMessageMatches(chat, message, filter) {
  if (filter.from) {
    const sender = message.direction === 'out' ? state.profile?.username : chat.username;
    if (sender !== filter.from) return false;
  }
  if (filter.in) {
    const chatText = `${chat.name || ''} ${chat.username || ''}`.toLocaleLowerCase('ru');
    if (!chatText.includes(filter.in)) return false;
  }
  return messageMatchesSearch(message, filter);
}

function chatMatchesSearch(chat, filter) {
  if (filter.from && chat.username !== filter.from) return false;
  const chatText = `${chat.name || ''} ${chat.username || ''}`.toLocaleLowerCase('ru');
  if (filter.in && !chatText.includes(filter.in)) return false;
  if (!filter.words.length && !filter.media && !filter.hasLink && !filter.hasMedia && !filter.before && !filter.after && !filter.from && !filter.in) return true;
  return filter.words.every(word => chatText.includes(word)) || chat.messages.some(message => messageMatchesSearch(message, filter));
}

function renderSidebar() {
  if (!state.profile) return;
  const query = $('#chat-search').value.trim().toLocaleLowerCase('ru');
  const search = parseSearchQuery($('#chat-search').value);
  const chats = [...state.chats].sort((a, b) => a.id === 'saved' ? -1 : b.id === 'saved' ? 1 : (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.updatedAt - a.updatedAt);
  const filtered = chats.filter(chat => {
    if (state.folderTab && (chat.folder || '') !== state.folderTab) return false;
    if (state.filter === 'unread' && !chat.unread) return false;
    return !query || chatMatchesSearch(chat, search);
  });
  const list = $('#chat-list');
  list.replaceChildren();
  for (const chat of filtered) {
    const row = document.createElement('button');
    row.className = `chat-row${chat.id === state.current ? ' selected' : ''}${chat.unread ? ' has-unread' : ''}`;
    row.dataset.chatId = chat.id;
    row.setAttribute('aria-label', `Открыть чат ${chat.name}`);
    row.setAttribute('aria-current', chat.id === state.current ? 'true' : 'false');
    const online = transport.isOpen(chat.id);
    const avatar = document.createElement('span');
    paintAvatar(avatar, { name: chat.name, id: chat.id, avatar: chat.avatar || '', saved: chat.id === 'saved' });
    if (online) avatar.classList.add('online');
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
    const draft = state.drafts[chat.id];
    const draftText = typeof draft === 'string' ? draft : draft?.text;
    const excerptNode = body.querySelector('p');
    if (draftText && !query) {
      // A saved draft is more actionable than the last message, so it wins the row.
      excerptNode.textContent = '';
      const label = document.createElement('span'); label.className = 'draft-label'; label.textContent = 'Черновик: ';
      excerptNode.append(label, document.createTextNode(draftText.slice(0, 80)));
      excerptNode.classList.add('has-draft');
      excerptNode.title = draftText.slice(0, 300);
    } else {
      excerptNode.textContent = !last && chat.id === 'saved' ? 'Ваши заметки, ссылки и идеи' : previewText(excerpt);
      excerptNode.title = '';
    }
    if (chat.id !== 'saved' && (chat.starred || chat.muted || chat.folder || chat.archive)) {
      const flags = [chat.starred && 'близкий', chat.muted && 'без звука', chat.folder && `папка: ${FOLDERS[chat.folder] || ''}`, chat.archive && 'архив'].filter(Boolean);
      body.title = flags.join(' · ');
    }
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
        if (!messageMatchesSearch(message, search)) continue;
        hits.push({ chat, message });
        if (hits.length >= 8) break;
      }
      if (hits.length >= 8) break;
    }
    if (hits.length) {
      const heading = document.createElement('div');
      heading.className = 'global-results-heading';
      heading.textContent = `Сообщения на этом устройстве: ${hits.length}`;
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
  paintAvatar(avatar, { name: chat.name, id: chat.id, avatar: chat.avatar || '', saved: chat.id === 'saved' });
  if (transport.isOpen(chat.id)) avatar.classList.add('online');
  $('#chat-title').textContent = chat.name;
  const presence = $('#chat-presence');
  presence.classList.toggle('is-online', transport.isOpen(chat.id));
  if (chat.id === 'saved') presence.textContent = 'Личное пространство · только на этом устройстве';
  else if (state.typing.get(chat.id) > Date.now()) presence.textContent = 'печатает…';
  else if (chat.request) presence.textContent = 'Новый запрос на общение';
  else if (transport.isOpen(chat.id)) presence.textContent = 'В сети · прямое соединение';
  else if (state.contactStates.get(chat.id) === 'connecting') presence.textContent = 'Ищем собеседника…';
  else if (state.lastSeen.get(chat.id)) presence.textContent = `Был(а) в сети ${relativeTime(state.lastSeen.get(chat.id))}`;
  else presence.textContent = 'Не подключён · откройте LIBO на обоих устройствах';
  presence.title = chat.id === 'saved' ? 'Заметки не передаются другим устройствам.' : `Код собеседника: LIBO:${chat.id}`;
  $('#request-bar').hidden = !chat.request;
  $('#composer-zone').hidden = !!chat.request || !!chat.archive;
  $('#archive-bar').hidden = !chat.archive;
  $('#security-button').hidden = chat.id === 'saved' || !!chat.archive;
  // Do not expose a call control until both online peers have advertised the call
  // protocol and this browser/WebView can request real capture devices.
  const callAvailable = chat.id !== 'saved' && !chat.archive && !chat.request
    && !state.call && !!navigator.mediaDevices?.getUserMedia
    && transport.isOpen(chat.id) && transport.supports(chat.id, 'calls-v1');
  $('#audio-call-button').hidden = !callAvailable;
  $('#video-call-button').hidden = !callAvailable;
  $('#block-contact').hidden = chat.id === 'saved';
  $('#verify-code').hidden = chat.id === 'saved' || !!chat.archive;
  $('#star-contact').hidden = chat.id === 'saved';
  $('#star-contact').querySelector('span').textContent = chat.starred ? 'Убрать из близких' : 'В близкие';
  $('#composer-hint').textContent = chat.id === 'saved'
    ? 'Сохранено на этом устройстве. Последние 500 сообщений в чате.'
    : 'Оба собеседника в приложении · ✓ сохранено у собеседника, ✓✓ прочитано';
}

function terminalCallDetail(status) {
  return {
    ended: 'Дзвінок завершено.',
    failed: 'Не вдалося встановити WebRTC-з’єднання.',
  }[status] || '';
}

function callStateLabel(call) {
  const kind = call.kind === 'video' ? 'відеодзвінок' : 'аудіодзвінок';
  if (call.status === 'ringing') return `Вхідний ${kind}`;
  if (call.status === 'calling') return `Викликаємо · ${kind}`;
  if (call.status === 'connecting') return 'З’єднання WebRTC…';
  if (call.status === 'connected') return 'З’єднано · WebRTC';
  if (call.status === 'reconnecting') return 'WebRTC перепідключається…';
  if (call.status === 'failed') return 'Не вдалося з’єднатися';
  if (call.status === 'ended') return 'Дзвінок завершено';
  return 'Підготовка виклику…';
}

function stopLocalCallStream(stream) {
  try { stream?.getTracks?.().forEach(track => track.stop()); } catch { /* Device may have already stopped capture. */ }
}

function assignMediaStream(element, stream) {
  if (!element || element.srcObject === stream) return;
  element.srcObject = stream || null;
  if (stream) void element.play().catch(() => { /* Playback still follows browser/WebView policy. */ });
}

function renderCall() {
  const call = state.call;
  const overlay = $('#call-overlay');
  if (!call) {
    overlay.hidden = true;
    assignMediaStream($('#call-local-video'), null);
    assignMediaStream($('#call-remote-video'), null);
    assignMediaStream($('#call-remote-audio'), null);
    $('#call-diagnostics').hidden = true;
    return;
  }
  overlay.hidden = false;
  const chat = state.chats.find(item => item.id === call.peerId);
  paintAvatar($('#call-avatar'), { name: chat?.name || 'LIBO', id: call.peerId, avatar: chat?.avatar || '' });
  $('#call-avatar').classList.add('call-avatar');
  $('#call-name').textContent = chat?.name || 'Контакт LIBO';
  $('#call-state').textContent = callStateLabel(call);
  const detail = $('#call-detail');
  detail.hidden = !call.detail;
  detail.textContent = call.detail || '';
  const incoming = call.direction === 'incoming' && call.status === 'ringing';
  const terminal = ['ended', 'failed'].includes(call.status);
  $('#call-accept').hidden = !incoming;
  $('#call-end').querySelector('span').textContent = incoming ? 'Відхилити' : terminal ? 'Закрити' : 'Завершити';
  $('#call-end').disabled = false;
  const hasLocal = !!call.localStream;
  const active = hasLocal && !terminal;
  const mute = $('#call-mute');
  const camera = $('#call-camera');
  const diagnostics = $('#call-diagnostics-toggle');
  mute.hidden = !active;
  camera.hidden = !active || call.kind !== 'video';
  diagnostics.hidden = !call.remoteStream || terminal;
  mute.classList.toggle('active', !!call.muted);
  camera.classList.toggle('active', !!call.cameraOff);
  mute.setAttribute('aria-label', call.muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон');
  mute.title = mute.getAttribute('aria-label');
  camera.setAttribute('aria-label', call.cameraOff ? 'Увімкнути камеру' : 'Вимкнути камеру');
  camera.title = camera.getAttribute('aria-label');
  const media = $('#call-media');
  const showVideo = call.kind === 'video' && (call.localStream || call.remoteStream);
  media.hidden = !showVideo;
  media.classList.toggle('video', !!showVideo);
  assignMediaStream($('#call-local-video'), call.localStream);
  assignMediaStream($('#call-remote-video'), call.remoteStream);
  assignMediaStream($('#call-remote-audio'), call.remoteStream);
}

async function requestCallStream(kind) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Цей WebView не підтримує доступ до мікрофона або камери.');
  const constraints = {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function startDirectCall(kind) {
  const chat = activeChat();
  if (!chat || chat.id === 'saved' || !transport.canCall(chat.id)) {
    notify('Для дзвінка обидва контакти мають бути онлайн у LIBO 2.11.4.5.', true);
    return;
  }
  clearTimeout(state.callTerminalTimer);
  let stream;
  try {
    stream = await requestCallStream(kind);
  } catch (error) {
    notify(error?.name === 'NotAllowedError' ? 'Надайте LIBO доступ до мікрофона або камери в Android.' : (error?.message || 'Не вдалося отримати доступ до пристрою.'), true);
    return;
  }
  // A permissions prompt may have left the chat or connection state changed.
  if (!transport.canCall(chat.id)) {
    stopLocalCallStream(stream);
    notify('З’єднання з контактом змінилося. Спробуйте ще раз.', true);
    return;
  }
  state.call = { peerId: chat.id, kind, direction: 'outgoing', status: 'calling', detail: '', localStream: stream, remoteStream: null, muted: false, cameraOff: false };
  if (!transport.startCall(chat.id, stream, kind)) {
    stopLocalCallStream(stream);
    state.call = null;
    renderCall();
    notify('Не вдалося розпочати WebRTC-виклик.', true);
    return;
  }
  renderCall(); renderHeader();
}

async function acceptIncomingCall() {
  const call = state.call;
  if (!call || call.direction !== 'incoming' || call.status !== 'ringing') return;
  let stream;
  try {
    stream = await requestCallStream(call.kind);
  } catch (error) {
    transport.rejectCall(call.peerId, 'Доступ до мікрофона або камери не надано.');
    notify(error?.name === 'NotAllowedError' ? 'Доступ до мікрофона або камери не надано.' : 'Не вдалося відкрити пристрій.', true);
    return;
  }
  if (!transport.answerCall(call.peerId, stream)) {
    stopLocalCallStream(stream);
    notify('Виклик уже завершився.', true);
    return;
  }
  state.call = { ...state.call, localStream: stream, status: 'connecting', detail: '' };
  renderCall(); renderHeader();
}

function endCurrentCall() {
  const call = state.call;
  if (!call) return;
  if (!transport.endCall(call.peerId)) {
    stopLocalCallStream(call.localStream);
    state.call = null;
    renderCall(); renderHeader();
  }
}

function toggleCallMute() {
  const call = state.call;
  const tracks = call?.localStream?.getAudioTracks?.() || [];
  if (!call || !tracks.length) return;
  const muted = tracks.some(track => track.enabled);
  tracks.forEach(track => { track.enabled = !muted; });
  state.call = { ...call, muted };
  renderCall();
}

function toggleCallCamera() {
  const call = state.call;
  const tracks = call?.localStream?.getVideoTracks?.() || [];
  if (!call || !tracks.length) return;
  const cameraOff = tracks.some(track => track.enabled);
  tracks.forEach(track => { track.enabled = !cameraOff; });
  state.call = { ...call, cameraOff };
  renderCall();
}

function formatCallMetric(value) { return Number.isFinite(value) ? `${value} мс` : '—'; }

async function refreshCallDiagnostics() {
  const call = state.call;
  if (!call?.remoteStream || ['ended', 'failed'].includes(call.status)) return;
  const diagnostics = await transport.callDiagnostics(call.peerId);
  if (!diagnostics || state.call?.peerId !== call.peerId) return;
  $('#call-diag-connection').textContent = diagnostics.connectionState || '—';
  $('#call-diag-ice').textContent = diagnostics.iceConnectionState || '—';
  $('#call-diag-rtt').textContent = formatCallMetric(diagnostics.rttMs);
  $('#call-diag-jitter').textContent = formatCallMetric(diagnostics.jitterMs);
  $('#call-diag-loss').textContent = diagnostics.packetsLost == null || diagnostics.packetsReceived == null
    ? '—' : `${diagnostics.packetsLost}/${diagnostics.packetsLost + diagnostics.packetsReceived}`;
}

async function showCallDiagnostics() {
  const panel = $('#call-diagnostics');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) await refreshCallDiagnostics();
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
  if (state.loadingChat === chat.id) {
    box.setAttribute('aria-busy', 'true');
    const loading = document.createElement('div');
    loading.className = 'message-loading';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');
    loading.innerHTML = '<div class="orb-loader" aria-hidden="true"><span class="orb orb-violet"></span><span class="orb orb-pink"></span></div><div class="message-loading-copy"><strong>Открываем переписку</strong><span>Читаем сохранённые данные</span></div>';
    box.replaceChildren(loading);
    return;
  }
  box.setAttribute('aria-busy', 'false');
  const previousTop = box.scrollTop;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const rawQuery = $('#message-search').value.trim();
  const query = rawQuery.toLocaleLowerCase('ru');
  const search = parseSearchQuery(rawQuery);
  const messages = chat.messages.filter(message => !query || localMessageMatches(chat, message, search));
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
      const text = document.createElement('p'); text.className = 'message-text';
      appendMessageText(text, message.text, message.mentions || []);
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
        chip.innerHTML = '<span class="reaction-glyph"></span><span class="reaction-count"></span>';
        chip.querySelector('.reaction-glyph').textContent = REACTION_EMOJI[key] || '✦';
        chip.querySelector('.reaction-count').textContent = String(mine.includes(key) && theirs.includes(key) ? 2 : 1);
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
      const edited = document.createElement('button'); edited.type = 'button'; edited.className = 'edited-mark'; edited.dataset.editHistory = message.id; edited.textContent = 'изменено';
      edited.title = 'Показать локальную историю изменений';
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
      const labels = {
        queued: 'В очереди: ждём подключения', sent: 'Отправлено: ждём подтверждения устройства',
        uploading: 'Метаданные приняты: файл передаётся и ещё не подтверждён',
        delivered: 'Сохранено и подтверждено устройством собеседника',
        failed: 'Передача не завершена: можно возобновить файл', local: 'Сохранено только на этом устройстве',
      };
      status.title = labels[message.status] || 'Статус передачи';
      status.setAttribute('aria-label', status.title);
      const read = message.status === 'delivered' && (chat.readUpTo || 0) >= message.at;
      status.classList.toggle('read', read);
      status.innerHTML = svg({ queued: 'clock', sent: 'check', uploading: 'clock', delivered: read ? 'checks' : 'check', failed: 'info', local: 'bookmark' }[message.status] || 'clock');
      status.title = read ? 'Прочитано собеседником' : status.title;
      meta.appendChild(status);
    }
    bubble.appendChild(meta);
    const actions = document.createElement('button'); actions.className = 'reply-message message-actions-button'; actions.dataset.actions = message.id;
    actions.innerHTML = svg('more'); actions.title = 'Действия с сообщением'; actions.setAttribute('aria-label', 'Действия с сообщением');
    const swipeHint = document.createElement('span'); swipeHint.className = 'swipe-hint'; swipeHint.setAttribute('aria-hidden', 'true'); swipeHint.innerHTML = svg('reply');
    row.append(swipeHint, bubble, actions); box.appendChild(row);
  }
  if (scroll && nearBottom) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  else box.scrollTop = previousTop;
}

function formatBytes(size) {
  if (!Number.isFinite(size)) return '';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} МБ`;
}

function formatDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return '';
  const seconds = Math.round(duration / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function attachmentStatus(att) {
  const transfer = state.transfers.get(att.fileId) || {};
  const size = transfer.size || att.size || 0;
  const bytes = transfer.sentBytes ?? transfer.receivedBytes ?? 0;
  const percent = size ? Math.min(100, Math.round(bytes / size * 100)) : 0;
  const status = transfer.state || (att.fileId ? 'queued' : '');
  const labels = {
    queued: 'В очереди', uploading: `Передача ${percent}%`, receiving: `Загрузка ${percent}%`,
    received: 'Получено и проверено', delivered: 'Доставлено и проверено',
    failed: 'Передача остановлена', cancelled: 'Передача отменена',
  };
  return { state: status, percent, label: labels[status] || 'Подготовка файла', error: transfer.error || '' };
}

function updateAttachmentNodes(fileId) {
  const entries = [...document.querySelectorAll('[data-file-id]')].filter(node => node.dataset.fileId === fileId);
  for (const node of entries) {
    const transfer = state.transfers.get(fileId) || {};
    const status = node.querySelector('[data-file-status]');
    const progress = node.querySelector('[data-file-progress]');
    const error = node.querySelector('[data-file-error]');
    const att = node.__liboAttachment;
    if (!att) continue;
    const details = attachmentStatus(att);
    if (status) status.textContent = details.label;
    if (progress) progress.value = details.percent;
    if (error) { error.hidden = !details.error; error.textContent = details.error; }
    const cancel = node.querySelector('[data-attachment-cancel]');
    const resume = node.querySelector('[data-attachment-resume]');
    if (cancel) cancel.hidden = !['queued', 'uploading', 'receiving'].includes(details.state);
    if (resume) resume.hidden = !['failed', 'cancelled', 'queued'].includes(details.state);
  }
}

async function attachmentObjectUrl(fileId) {
  const cached = state.attachmentUrls.get(fileId);
  if (cached) return cached;
  const record = await store.getAttachment(fileId);
  if (!record?.blob) return '';
  const url = URL.createObjectURL(record.blob);
  state.attachmentUrls.set(fileId, url);
  return url;
}

function revokeAttachmentUrls() {
  for (const url of state.attachmentUrls.values()) URL.revokeObjectURL(url);
  state.attachmentUrls.clear();
}

function createStreamAttachment(message) {
  const att = message.att;
  const wrap = document.createElement('section');
  wrap.className = `attachment-card ${att.kind === 'file' ? 'att-file-card' : `att-${att.kind}`}`;
  wrap.dataset.fileId = att.fileId;
  wrap.__liboAttachment = att;
  const info = document.createElement('div'); info.className = `attachment-info${att.kind === 'file' ? ' att-file' : ''}`;
  const title = document.createElement(att.kind === 'file' ? 'span' : 'strong');
  title.className = 'attachment-name';
  title.textContent = att.kind === 'music' ? (att.title || att.name) : att.name;
  const detail = document.createElement(att.kind === 'file' ? 'small' : 'span');
  const parts = [att.mime, formatBytes(att.size), formatDuration(att.dur)].filter(Boolean);
  if (att.kind === 'music' && att.artist) parts.unshift(att.artist + (att.album ? ` · ${att.album}` : ''));
  detail.textContent = parts.join(' · ');
  info.append(title, detail);

  if (att.kind === 'music' && att.cover) {
    const cover = document.createElement('img'); cover.className = 'music-cover'; cover.src = att.cover; cover.alt = 'Обкладинка альбому';
    wrap.appendChild(cover);
  }
  if (att.kind === 'image') {
    const photo = document.createElement('button'); photo.className = 'message-photo attachment-media';
    photo.dataset.photoFile = att.fileId; photo.setAttribute('aria-label', 'Открыть фотографию');
    const placeholder = document.createElement('span'); placeholder.className = 'attachment-placeholder'; placeholder.textContent = 'Загрузка изображения…';
    photo.appendChild(placeholder); wrap.appendChild(photo);
  } else {
    const icon = document.createElement('span'); icon.className = 'attachment-type-icon';
    icon.textContent = { music: '♫', audio: '♪', voice: '●', video: '▶', file: '▤' }[att.kind] || '⌁';
    wrap.append(icon, info);
    const media = document.createElement('div'); media.className = 'attachment-media'; media.dataset.attachmentMedia = '';
    wrap.appendChild(media);
  }
  if (att.kind === 'image') wrap.appendChild(info);

  const footer = document.createElement('div'); footer.className = 'attachment-transfer';
  const status = document.createElement('span'); status.dataset.fileStatus = '';
  const progress = document.createElement('progress'); progress.dataset.fileProgress = ''; progress.max = 100;
  const download = document.createElement('button'); download.type = 'button'; download.dataset.attachmentDownload = att.fileId; download.textContent = 'Сохранить';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.dataset.attachmentCancel = att.fileId; cancel.textContent = 'Отменить';
  const resume = document.createElement('button'); resume.type = 'button'; resume.dataset.attachmentResume = att.fileId; resume.textContent = 'Возобновить';
  footer.append(status, progress, download, cancel, resume);
  const error = document.createElement('small'); error.dataset.fileError = ''; error.hidden = true;
  wrap.append(footer, error);
  queueMicrotask(() => void hydrateStreamAttachment(wrap, att));
  return wrap;
}

async function hydrateStreamAttachment(wrap, att) {
  if (!wrap.isConnected) return;
  const record = await store.getAttachment(att.fileId);
  if (!wrap.isConnected) return;
  if (record) {
    state.transfers.set(att.fileId, {
      ...(state.transfers.get(att.fileId) || {}), state: record.state,
      size: record.size, sentBytes: record.sentBytes, receivedBytes: record.receivedBytes,
      nextChunk: record.nextChunk, totalChunks: record.totalChunks, error: record.error || '',
    });
  }
  updateAttachmentNodes(att.fileId);
  if (!record?.blob) return;
  const url = await attachmentObjectUrl(att.fileId);
  if (!url || !wrap.isConnected) return;
  if (att.kind === 'image') {
    const photo = wrap.querySelector('[data-photo-file]');
    if (!photo || photo.querySelector('img')) return;
    photo.replaceChildren();
    const image = document.createElement('img'); image.src = url; image.alt = att.name || 'Фотография'; image.loading = 'lazy';
    photo.appendChild(image);
    return;
  }
  const media = wrap.querySelector('[data-attachment-media]');
  if (!media || media.firstChild) return;
  if (att.kind === 'video') {
    const video = document.createElement('video');
    video.className = 'message-video'; video.controls = true; video.preload = 'metadata'; video.src = url; video.setAttribute('playsinline', '');
    video.addEventListener('error', () => {
      const fallback = document.createElement('p'); fallback.className = 'media-fallback'; fallback.textContent = 'Этот формат видео не воспроизводится в данном WebView. Сохраните исходный файл.';
      media.appendChild(fallback);
    }, { once: true });
    media.appendChild(video);
  } else if (['audio', 'music', 'voice'].includes(att.kind)) {
    const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = url;
    audio.addEventListener('loadedmetadata', () => {
      if (!att.dur && Number.isFinite(audio.duration)) {
        const detail = wrap.querySelector('.attachment-info span');
        if (detail) detail.textContent = `${detail.textContent} · ${formatDuration(audio.duration * 1000)}`;
      }
    }, { once: true });
    audio.addEventListener('error', () => {
      const fallback = document.createElement('p'); fallback.className = 'media-fallback'; fallback.textContent = 'Этот аудиоформат не воспроизводится в данном WebView. Сохраните исходный файл.';
      media.appendChild(fallback);
    }, { once: true });
    media.appendChild(audio);
  }
}

function renderLegacyAttachment(message) {
  const att = message.att;
  if (att.kind === 'voice' || att.kind === 'audio') {
    const wrap = document.createElement('div'); wrap.className = 'att-voice';
    wrap.innerHTML = `${svg('mic')}<audio controls preload="metadata"></audio><span></span>`;
    wrap.querySelector('audio').src = att.data;
    wrap.querySelector('span').textContent = att.dur ? `${Math.round(att.dur / 1000)} с` : 'аудио';
    return wrap;
  }
  if (att.kind === 'video') {
    const video = document.createElement('video');
    video.className = 'message-video'; video.controls = true; video.preload = 'metadata'; video.src = att.data; video.setAttribute('playsinline', '');
    return video;
  }
  const link = document.createElement('button'); link.className = 'att-file'; link.dataset.attach = message.id;
  link.innerHTML = `${svg('file')}<span></span><small></small>`;
  link.querySelector('span').textContent = att.name;
  link.querySelector('small').textContent = 'Скачать файл';
  link.title = att.name;
  return link;
}

function renderAttachment(message) {
  const att = message.att;
  if (isChunkedAttachment(att)) return createStreamAttachment(message);
  if (att.kind === 'poll') {
    const wrap = document.createElement('div'); wrap.className = 'att-poll';
    const tally = pollTally(att);
    const total = tally.reduce((sum, value) => sum + value, 0);
    const head = document.createElement('strong'); head.textContent = att.q;
    wrap.appendChild(head);
    att.opts.forEach((opt, index) => {
      const option = document.createElement('button');
      option.className = 'poll-option'; option.dataset.vote = index; option.dataset.messageId = message.id;
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
  return renderLegacyAttachment(message);
}

function appendMessageText(node, text, mentions) {
  const byUsername = new Map((mentions || []).map(item => [`@${item.username.toLowerCase()}`, item]));
  const expression = /@[a-z][a-z0-9_]{2,31}/gi;
  let position = 0;
  for (const match of text.matchAll(expression)) {
    const token = match[0];
    const mention = byUsername.get(token.toLowerCase());
    if (!mention) continue;
    node.append(document.createTextNode(text.slice(position, match.index)));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'mention';
    button.dataset.profileId = mention.userId; button.textContent = token; button.title = `Открыть профиль ${token}`;
    node.appendChild(button);
    position = (match.index || 0) + token.length;
  }
  node.append(document.createTextNode(text.slice(position)));
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
    button.textContent = REACTION_EMOJI[key] || '✦';
    button.setAttribute('aria-label', `Реакция ${key}`);
    strip.appendChild(button);
  }
  menu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = 210;
  menu.style.top = `${Math.min(window.innerHeight - 260, Math.max(8, rect.bottom + 6))}px`;
  menu.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, rect.left - width + 34))}px`;
}

function reminderSummary(chat, message) {
  return (message.text || message.att?.title || message.att?.name || 'Вложение').slice(0, 120);
}

function armBrowserReminder(reminder) {
  const old = reminderTimers.get(reminder.id);
  if (old) clearTimeout(old);
  const delay = reminder.at - Date.now();
  if (delay <= 0) { void fireReminder(reminder); return; }
  const timer = setTimeout(() => void fireReminder(reminder), Math.min(delay, 2_147_000_000));
  reminderTimers.set(reminder.id, timer);
}

async function fireReminder(reminder) {
  reminderTimers.delete(reminder.id);
  state.reminders = state.reminders.filter(item => item.id !== reminder.id);
  await store.setMeta('reminders', state.reminders).catch(() => {});
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification('LIBO: напоминание', { body: reminder.body, tag: `libo-reminder-${reminder.id}` });
      notification.onclick = () => { window.focus(); void openReminderTarget(reminder.chatId, reminder.messageId); };
    } catch { /* WebView may expose Notification without a working constructor. */ }
  }
  notify(`Напоминание: ${reminder.body}`);
}

async function openReminderTarget(chatId, messageId) {
  await openChat(chatId);
  const row = document.querySelector(`[data-message-id="${messageId}"]`);
  if (row) { state.highlight = messageId; row.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => { state.highlight = null; }, 2400); }
}

function openReminderDialog(chat, message) {
  $('#reminder-dialog').dataset.chatId = chat.id;
  $('#reminder-dialog').dataset.messageId = message.id;
  $('#reminder-preview').textContent = reminderSummary(chat, message);
  $('#reminder-date').value = '';
  openDialog('reminder-dialog');
}

async function scheduleReminder(at) {
  const chatId = $('#reminder-dialog').dataset.chatId;
  const messageId = $('#reminder-dialog').dataset.messageId;
  const chat = state.chats.find(item => item.id === chatId);
  const message = chat?.messages.find(item => item.id === messageId);
  if (!chat || !message || !Number.isFinite(at) || at <= Date.now() + 5_000) { notify('Выберите время минимум через несколько секунд.', true); return; }
  const reminder = { id: crypto.randomUUID(), chatId, messageId, at, body: `${chat.name}: ${reminderSummary(chat, message)}`, createdAt: Date.now() };
  state.reminders.push(reminder);
  await store.setMeta('reminders', state.reminders);
  armBrowserReminder(reminder);
  if (window.LiboAndroid?.scheduleReminder) {
    // Native Android schedules an AlarmManager notification that opens this exact
    // chat/message; browser fallback stays honest about its platform limits.
    window.LiboAndroid.scheduleReminder(reminder.id, 'LIBO: напоминание', reminder.body, reminder.at, chatId, messageId);
  } else if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* Optional browser permission. */ }
  }
  closeDialogs();
  notify('Напоминание создано.');
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
  if (action === 'save') {
    state.forwardIds = [messageId];
    await forwardTo('saved');
    return;
  }
  if (action === 'reminder') {
    openReminderDialog(chat, message);
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

function showEditHistory(messageId) {
  const message = activeChat()?.messages.find(item => item.id === messageId);
  if (!message?.editedAt) return;
  const list = $('#edit-history-list'); list.replaceChildren();
  const entries = [...(message.edits || []), { text: message.text, at: message.editedAt, current: true }];
  for (const entry of entries) {
    const row = document.createElement('article'); row.className = 'edit-history-row';
    const when = document.createElement('time'); when.textContent = `${entry.current ? 'Текущая версия' : 'Предыдущая версия'} · ${new Date(entry.at).toLocaleString('ru')}`;
    const text = document.createElement('p'); text.textContent = entry.text;
    row.append(when, text); list.appendChild(row);
  }
  openDialog('edit-history-dialog');
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
    const previous = next.messages[index];
    const edits = [...(previous.edits || []), { text: previous.text, at: previous.editedAt || previous.at }].slice(-20);
    next.messages[index] = { ...previous, text, editedAt, edits };
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

function formatLatency(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  return value < 1000 ? `${Math.round(value)} мс` : `${(value / 1000).toFixed(2)} с`;
}

function latestDeliveryDebug(chat) {
  const message = [...(chat?.messages || [])].reverse().find(item => item.direction === 'out' && item.timing?.recipientReceivedAt);
  if (!message) return 'Нет подтверждённой доставки в этом чате.';
  const timing = message.timing;
  const parts = [];
  if (timing.clientCreatedAt && timing.sendStartedAt) parts.push(`очередь: ${formatLatency(timing.sendStartedAt - timing.clientCreatedAt)}`);
  if (timing.sendStartedAt && timing.recipientReceivedAt) parts.push(`доставка: ${formatLatency(timing.recipientReceivedAt - timing.sendStartedAt)}`);
  if (timing.recipientReceivedAt && timing.ackAt) parts.push(`ACK: ${formatLatency(timing.ackAt - timing.recipientReceivedAt)}`);
  if (timing.clientCreatedAt && timing.readAt) parts.push(`прочитано: ${formatLatency(timing.readAt - timing.clientCreatedAt)}`);
  return parts.length ? parts.join(' · ') : 'Получено устройством, без полного набора меток.';
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
  $('#sec-latency').textContent = latestDeliveryDebug(chat);
  openDialog('security-dialog');
}

// Connection summary opens only for an active direct chat; without one it remains inactive.
function syncSecurityLink() {
  const link = $('#security-connection-link');
  if (!link) return;
  const chat = activeChat();
  const personal = chat && chat.id !== 'saved' ? chat.id : null;
  if (personal) {
    link.dataset.chatId = personal;
    link.classList.remove('disabled');
  } else {
    delete link.dataset.chatId;
    link.classList.add('disabled');
  }
}

async function gotoSecurity(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) { notify('Откройте чат, чтобы увидеть безопасность соединения.', true); return; }
  await openChat(id);
  await openSecurity();
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
  const text = $('#message-input').value.slice(0, MAX_TEXT);
  const reply = state.reply ? { ...state.reply } : null;
  // Only attachment metadata is kept in a draft. Its Blob has already been saved in
  // IndexedDB, so reload restores a safe local attachment without serialising bytes.
  const attachment = state.attachment ? { ...state.attachment } : null;
  if (text || reply || attachment) state.drafts[state.current] = { text, reply, attachment, timestamp: Date.now() };
  else delete state.drafts[state.current];
  try { localStorage.setItem('libo-v2-drafts', JSON.stringify(state.drafts)); }
  catch { notify('Черновик не сохранён: на устройстве мало места.', true); }
  clearTimeout(draftPersistTimer);
  draftPersistTimer = setTimeout(() => { void store.setMeta('drafts', state.drafts).catch(() => {}); }, 300);
}

function resetComposerExtras() {
  state.reply = null;
  state.attachment = null;
  photoGeneration++;
  if (state.attachmentPreviewUrl) { URL.revokeObjectURL(state.attachmentPreviewUrl); state.attachmentPreviewUrl = ''; }
  $('#reply-bar').hidden = true;
  $('#attachment-preview').hidden = true;
  $('#attachment-image').removeAttribute('src');
  $('#photo-input').value = '';
  $('#emoji-picker').hidden = true;
  $('#emoji-button').setAttribute('aria-expanded', 'false');
}

async function restoreDraft(id) {
  const raw = state.drafts[id];
  const draft = typeof raw === 'string' ? { text: raw } : raw || {};
  $('#message-input').value = String(draft.text || '').slice(0, MAX_TEXT);
  if (draft.reply?.text && draft.reply?.name) {
    state.reply = { text: String(draft.reply.text).slice(0, 160), name: normalizeName(draft.reply.name) };
    if (state.reply.name) {
      $('#reply-name').textContent = state.reply.name;
      $('#reply-text').textContent = state.reply.text;
      $('#reply-bar').hidden = false;
    }
  }
  if (draft.attachment?.fileId) {
    const record = await store.getAttachment(draft.attachment.fileId);
    if (record?.blob && record.direction === 'out') await showAttachmentDraft({ ...draft.attachment });
    else {
      state.drafts[id] = { ...draft, attachment: null };
      rememberDraft();
    }
  }
}

async function openChat(id) {
  if (!state.chats.some(chat => chat.id === id)) return;
  const sequence = ++chatOpenSequence;
  rememberDraft();
  state.current = id;
  state.loadingChat = id;
  closeMessageActions();
  $('#shell').classList.add('chat-open');
  $('#welcome').hidden = true;
  $('#conversation').hidden = false;
  closeChatMenu();
  closeMessageSearch();
  setSelection(null);
  state.highlight = null;
  resetComposerExtras();
  renderHeader(); renderMessages(); renderSidebar();
  try { await restoreDraft(id); }
  catch { if (sequence === chatOpenSequence) notify('Не удалось восстановить черновик на этом устройстве.', true); }
  if (sequence !== chatOpenSequence || state.current !== id) return;
  state.loadingChat = null;
  updateComposer();
  renderHeader(); renderMessages(); renderSidebar();
  state.newBelow = 0;
  requestAnimationFrame(() => { $('#messages').scrollTop = $('#messages').scrollHeight; updateScrollButton(); });
  if (id !== 'saved') transport.connect(id);
  sendReadReceipt(id);
  try { await changeChat(id, chat => { if (!chat.unread) return false; chat.unread = 0; }); renderSidebar(); }
  catch { notify('Не удалось обновить счётчик сообщений.', true); }
}

function closeChat() {
  ++chatOpenSequence;
  state.loadingChat = null;
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
  const maxHeight = 180;
  input.style.height = `${Math.min(maxHeight, Math.max(37, input.scrollHeight))}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  $('#send-button').disabled = state.sending || (!input.value.trim() && !state.attachment);
}

function extractMentions(text) {
  const byUsername = new Map(state.chats.filter(chat => chat.id !== 'saved' && chat.username).map(chat => [`@${chat.username.toLowerCase()}`, chat]));
  const out = [];
  const seen = new Set();
  for (const match of text.matchAll(/@[a-z][a-z0-9_]{2,31}/gi)) {
    const chat = byUsername.get(match[0].toLowerCase());
    if (chat && !seen.has(chat.id)) {
      seen.add(chat.id);
      out.push({ type: 'mention', userId: chat.id, username: chat.username });
    }
  }
  return out;
}

async function sendMessage(event) {
  event?.preventDefault();
  const chat = activeChat();
  const text = $('#message-input').value.trim().slice(0, MAX_TEXT);
  if (!chat || chat.request || chat.archive || state.sending || (!text && !state.attachment)) return;
  const id = chat.id;
  const attachment = state.attachment;
  if (isChunkedAttachment(attachment) && id !== 'saved' && transport.isOpen(id) && !transport.supports(id, 'chunk-files-v1')) {
    notify('У собеседника старая версия LIBO. Для файлов до 100 МБ обновите оба приложения до 2.11.4.5.', true);
    return;
  }
  const createdAt = Date.now();
  const message = {
    id: crypto.randomUUID(), text, image: null, att: attachment || null,
    mentions: extractMentions(text), reply: state.reply, ttl: state.ttl || 0,
    timing: { clientCreatedAt: createdAt },
    at: createdAt, direction: 'out', status: id === 'saved' ? 'local' : 'queued',
  };
  state.sending = true; updateComposer();
  try {
    await changeChat(id, next => { makeRoom(next); next.messages.push(message); next.updatedAt = message.at; });
    if (state.current === id) {
      $('#message-input').value = '';
      resetComposerExtras(); rememberDraft();
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
  const pending = chat.messages
    .filter(m => m.direction === 'out' && ['sent', 'queued'].includes(m.status) && Date.now() - (lastSent.get(m.id) || 0) > 15_000)
    .slice(0, 25);
  const sent = new Set();
  const unsupported = new Set();
  for (const message of pending) {
    if (isChunkedAttachment(message.att) && !transport.supports(id, 'chunk-files-v1')) {
      unsupported.add(message.id);
      continue;
    }
    const packet = toPacket({ ...message, timing: { ...(message.timing || {}), sendStartedAt: Date.now() } });
    if (await transport.send(id, packet)) {
      sent.add(message.id);
      lastSent.set(message.id, Date.now());
      if (isChunkedAttachment(message.att)) void transferManager.start(id, chat.id, message.id, message.att);
    }
  }
  if (!sent.size && !unsupported.size) return;
  try {
    await changeChat(id, next => {
      next.messages = next.messages.map(m => {
        if (unsupported.has(m.id)) return { ...m, status: 'failed', attachmentError: 'Собеседник не поддерживает передачу частями. Нужна версия 2.11.4.5.' };
        return sent.has(m.id) && m.status === 'queued'
          ? { ...m, status: 'sent', timing: { ...(m.timing || {}), sendStartedAt: Date.now() } }
          : m;
      });
    });
    if (state.current === id) renderMessages(false);
    if (unsupported.size) notify('Файл не отправлен: собеседнику нужно обновить LIBO до 2.11.4.5.', true);
  } catch { notify('Не удалось сохранить статус отправки.', true); }
}

function retryConnections() {
  if (state.network !== 'ready') return;
  for (const chat of state.chats) {
    if (chat.id === 'saved' || chat.request) continue;
    if (chat.id === state.current || chat.messages.some(m => m.direction === 'out' && ['queued', 'sent', 'uploading'].includes(m.status))) {
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
    const link = makeLiboLink('user', state.profile.id);
    $('#my-code').textContent = code;
    $('#invite-name').textContent = state.profile.name;
    const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
    $('#invite-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  if (id === 'new-dialog') { $('#contact-error').hidden = true; $('#contact-code').value = ''; }
  if (id === 'settings-dialog') { populateSettings(); syncSecurityLink(); }
  if (id === 'blocked-dialog') renderBlocked();
  if (id === 'about-dialog') {
    const features = [
      FEATURES.delivery, FEATURES.files, FEATURES.profile, FEATURES.mentions,
      FEATURES.drafts, FEATURES.reactions, FEATURES.polls, FEATURES.links,
      FEATURES.security, FEATURES.search, FEATURES.calls,
      // 2.12 interface upgrades
      FEATURES.palette, FEATURES.gestures, FEATURES.draftsList, FEATURES.presence,
      FEATURES.emoji2, FEATURES.appearance, FEATURES.chatSheet, FEATURES.scrollCapsule,
      FEATURES.contextMenu,
    ];
    $('#about-features').innerHTML = features.map(text => `<li>${text}</li>`).join('');
  }
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

async function openLiboLink(value) {
  const link = parseLiboLink(value);
  if (!link) { notify('Некорректная ссылка LIBO.', true); return; }
  if (link.type === 'user' || link.type === 'chat') {
    const chat = state.chats.find(item => item.id === link.id);
    if (chat) { await openChat(chat.id); if (link.type === 'user') openContactProfile(chat.id); return; }
    openDialog('new-dialog');
    $('#contact-code').value = `LIBO:${link.id}`;
    notify('Проверьте личный код и добавьте контакт.');
    return;
  }
  if (link.type === 'message') {
    const hit = state.chats.map(chat => ({ chat, message: chat.messages.find(message => message.id === link.id) })).find(item => item.message);
    if (hit) { await openReminderTarget(hit.chat.id, hit.message.id); return; }
    notify('Сообщение из ссылки не найдено на этом устройстве.', true);
    return;
  }
  if (link.type === 'file') {
    const hit = state.chats.map(chat => ({ chat, message: chat.messages.find(message => message.att?.fileId === link.id) })).find(item => item.message);
    if (hit) { await openChat(hit.chat.id); await downloadAttachment(link.id); return; }
    notify('Файл из ссылки не найден на этом устройстве.', true);
    return;
  }
  // Channels require a server-backed membership model, which the private P2P build
  // deliberately does not pretend to have.
  notify('Ссылки на каналы доступны только в серверной редакции LIBO.', true);
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
  try { localStorage.setItem(UI_KEY, JSON.stringify({ theme: state.settings.theme, wall: state.settings.wall || 'plain', accent: state.settings.accent, density: state.settings.density, font: state.settings.font })); }
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
  $('#profile-username').value = state.profile.username || '';
  $('#profile-bio').value = state.profile.bio || '';
  $('#profile-status').value = state.profile.status || 'online';
  renderProfileAvatar();
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
  applyAppearance();
}

async function saveSettings(event) {
  event.preventDefault();
  const error = $('#settings-error'); error.hidden = true;
  const name = normalizeName($('#profile-name').value);
  const usernameRaw = $('#profile-username').value.trim();
  const username = normalizeUsername(usernameRaw);
  const bio = normalizeBio($('#profile-bio').value);
  const status = ['online', 'away', 'busy', 'offline'].includes($('#profile-status').value) ? $('#profile-status').value : 'online';
  if (!name) { error.textContent = 'Напишите, как вас называть.'; error.hidden = false; return; }
  if (usernameRaw && !username) { error.textContent = 'Username: 3–32 латинских символа, цифры или _, начинается с буквы.'; error.hidden = false; return; }
  const collision = state.chats.find(chat => chat.id !== 'saved' && chat.username && chat.username === username);
  if (username && collision) { error.textContent = `@${username} уже виден у контакта «${collision.name}» на этом устройстве.`; error.hidden = false; return; }
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
    const profile = { ...state.profile, name, username, bio, status };
    await store.setMeta('settings', settings);
    await store.setMeta('profile', profile);
    state.settings = settings; state.profile = profile;
    renderProfileAvatar();
    applyTheme(); applyWall(); rememberUi();
    if (reconnect) {
      state.contactStates.clear();
      transport.start(profile, settings);
    } else transport.updateProfile(profile);
    closeDialogs(); renderSidebar(); renderHeader();
    notify('Ваши настройки сохранены');
  } catch (err) { error.textContent = err.message || 'Не удалось сохранить настройки.'; error.hidden = false; }
}

async function setProfileAvatar(file) {
  if (!file) return;
  if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type) || file.size > MAX_IMAGE_FILE_SIZE) {
    notify(`Для аватара выберите JPG, PNG или WebP до ${formatBytes(MAX_IMAGE_FILE_SIZE)}.`, true);
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 160;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 160, 160);
    const scale = Math.max(160 / image.naturalWidth, 160 / image.naturalHeight);
    const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
    context.drawImage(image, (160 - width) / 2, (160 - height) / 2, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .76));
    if (!blob || blob.size > 200_000) throw new Error('Аватар слишком большой после сжатия.');
    const avatar = await readAsDataUrl(blob);
    const profile = { ...state.profile, avatar };
    await store.setMeta('profile', profile);
    state.profile = profile;
    renderProfileAvatar();
    transport.updateProfile(profile);
    notify('Аватар сохранён и будет отправлен известным контактам при подключении.');
  } catch (error) { notify(error.message || 'Не удалось подготовить аватар.', true); }
  finally { URL.revokeObjectURL(url); $('#profile-avatar-input').value = ''; }
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
  const text = `Добавьте меня в LIBO!\n\nLIBO:${state.profile.id}\n\nДля переписки откройте приложение на обоих устройствах.`;
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

async function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(blob);
  });
}

function mediaDuration(blob, tagName) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const media = document.createElement(tagName);
    const finish = value => { URL.revokeObjectURL(url); media.remove(); resolve(value); };
    const timer = setTimeout(() => finish(null), 8000);
    media.preload = 'metadata'; media.src = url;
    media.onloadedmetadata = () => { clearTimeout(timer); finish(Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : null); };
    media.onerror = () => { clearTimeout(timer); finish(null); };
  });
}

function decodeId3Text(bytes, encoding) {
  try {
    if (encoding === 0 || encoding === 3) return new TextDecoder(encoding === 0 ? 'iso-8859-1' : 'utf-8').decode(bytes).replace(/\0/g, '').trim();
    return new TextDecoder('utf-16').decode(bytes).replace(/\0/g, '').trim();
  } catch { return ''; }
}

function syncSafe(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}

function standardInt(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function zeroTerminator(bytes, offset, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let index = offset; index + 1 < bytes.length; index += 2) if (bytes[index] === 0 && bytes[index + 1] === 0) return index + 2;
    return bytes.length;
  }
  for (let index = offset; index < bytes.length; index++) if (bytes[index] === 0) return index + 1;
  return bytes.length;
}

async function readMusicMetadata(file) {
  const fallback = safeFilename(file.name || 'music') || 'Без названия';
  const metadata = { title: fallback, artist: '', album: '', cover: '' };
  try {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1_100_000)).arrayBuffer());
    if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== 'ID3') return metadata;
    const version = bytes[3];
    if (![3, 4].includes(version)) return metadata;
    const end = Math.min(bytes.length, 10 + syncSafe(bytes, 6));
    let offset = 10;
    while (offset + 10 <= end) {
      const frameId = String.fromCharCode(...bytes.slice(offset, offset + 4));
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
      const length = version === 4 ? syncSafe(bytes, offset + 4) : standardInt(bytes, offset + 4);
      const dataStart = offset + 10;
      const dataEnd = dataStart + length;
      if (!length || dataEnd > end) break;
      const frame = bytes.slice(dataStart, dataEnd);
      if (['TIT2', 'TPE1', 'TALB'].includes(frameId) && frame.length) {
        const text = decodeId3Text(frame.slice(1), frame[0]);
        if (text) metadata[{ TIT2: 'title', TPE1: 'artist', TALB: 'album' }[frameId]] = text.slice(0, 120);
      }
      if (frameId === 'APIC' && frame.length > 8 && !metadata.cover) {
        const encoding = frame[0];
        let cursor = 1;
        const mimeEnd = zeroTerminator(frame, cursor, 0);
        const mime = new TextDecoder('ascii').decode(frame.slice(cursor, Math.max(cursor, mimeEnd - 1))).toLowerCase();
        cursor = mimeEnd + 1; // picture type
        cursor = zeroTerminator(frame, cursor, encoding);
        const image = frame.slice(cursor);
        if (/^image\/(?:jpeg|png|webp)$/.test(mime) && image.length && image.length <= 200_000) {
          metadata.cover = await readAsDataUrl(new Blob([image], { type: mime }));
        }
      }
      offset = dataEnd;
    }
  } catch { /* Metadata is optional; the original file still goes untouched. */ }
  return metadata;
}

async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .84));
    if (!blob) throw new Error('Не удалось сжать фотографию.');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

async function persistAttachment(blob, name, kind, extras = {}) {
  const mime = normalizeMime(blob.type, name);
  const size = blob.size;
  const max = maxAttachmentBytes(kind);
  if (!size || size > max) throw new Error(`Максимальный размер: ${formatBytes(max)}.`);
  const fileId = makeFileId();
  const duration = extras.dur ?? (['audio', 'music', 'voice'].includes(kind) ? await mediaDuration(blob, 'audio') : kind === 'video' ? await mediaDuration(blob, 'video') : null);
  const att = {
    kind, fileId, name: safeFilename(name), mime, size, chunkSize: FILE_CHUNK_SIZE,
    totalChunks: Math.ceil(size / FILE_CHUNK_SIZE), sha256: await sha256Blob(blob),
    ...(Number.isFinite(duration) && duration > 0 ? { dur: duration } : {}),
    ...Object.fromEntries(Object.entries(extras).filter(([key, value]) => key !== 'dur' && value)),
  };
  await store.putAttachment({ ...att, id: fileId, direction: 'out', state: 'queued', nextChunk: 0, sentBytes: 0, createdAt: Date.now(), updatedAt: Date.now(), blob, error: '' });
  state.transfers.set(fileId, { state: 'queued', size, sentBytes: 0, totalChunks: att.totalChunks, nextChunk: 0 });
  return att;
}

async function showAttachmentDraft(att) {
  state.attachment = att;
  if (state.attachmentPreviewUrl) { URL.revokeObjectURL(state.attachmentPreviewUrl); state.attachmentPreviewUrl = ''; }
  $('#attachment-preview').hidden = false;
  $('#attachment-label').textContent = att.kind === 'music'
    ? `Музыка: ${att.title || att.name}${att.artist ? ` · ${att.artist}` : ''}`
    : `${att.name} · ${formatBytes(att.size)}${att.dur ? ` · ${formatDuration(att.dur)}` : ''}`;
  const image = $('#attachment-image');
  image.hidden = att.kind !== 'image';
  if (att.kind === 'image') {
    state.attachmentPreviewUrl = await attachmentObjectUrl(att.fileId);
    image.src = state.attachmentPreviewUrl;
  } else image.removeAttribute('src');
  updateComposer();
  rememberDraft();
}

async function attachPhoto(file) {
  if (!file || !activeChat() || activeChat().request) return;
  if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type)) { notify('Поддерживаются фотографии JPG, PNG и WebP.', true); return; }
  if (file.size > MAX_IMAGE_FILE_SIZE) { notify(`Выберите фотографию до ${formatBytes(MAX_IMAGE_FILE_SIZE)}.`, true); return; }
  try {
    const blob = await compressPhoto(file);
    const name = safeFilename(file.name.replace(/\.[^.]+$/, '') + '.jpg');
    await showAttachmentDraft(await persistAttachment(blob, name, 'image'));
  } catch (error) { notify(error.message || 'Не удалось подготовить фотографию.', true); }
  finally { $('#photo-input').value = ''; }
}

async function attachFile(file, mode = '') {
  const chat = activeChat();
  if (!file || !chat || chat.request || chat.archive) return;
  let kind = classifyAttachment(file.type, file.name, mode === 'music');
  if (kind === 'audio' && !mode) {
    state.pendingAudioFile = file;
    $('#audio-kind-name').textContent = `${safeFilename(file.name)} · ${formatBytes(file.size)}`;
    openDialog('audio-kind-dialog');
    return;
  }
  if (mode === 'music') kind = 'music';
  const max = maxAttachmentBytes(kind);
  if (file.size > max) { notify(`«${safeFilename(file.name)}» больше лимита ${formatBytes(max)}.`, true); return; }
  try {
    const extras = kind === 'music' ? await readMusicMetadata(file) : {};
    await showAttachmentDraft(await persistAttachment(file, file.name, kind, extras));
  } catch (error) { notify(error.message || 'Не удалось подготовить файл.', true); }
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
      button.classList.remove('recording'); button.setAttribute('aria-label', 'Записать голосовое сообщение');
      const dur = Date.now() - startedAt;
      if (dur < 700) { notify('Слишком короткая запись.', true); return; }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > MAX_VOICE_MESSAGE_SIZE) { notify(`Голосовое сообщение больше ${formatBytes(MAX_VOICE_MESSAGE_SIZE)}.`, true); return; }
      try { await showAttachmentDraft(await persistAttachment(blob, 'voice.webm', 'voice', { dur })); }
      catch (error) { notify(error.message || 'Не удалось сохранить голосовое сообщение.', true); }
    };
    recorder.start();
    state.recording = recorder;
    button.classList.add('recording'); button.setAttribute('aria-label', 'Остановить запись');
    setTimeout(() => { if (state.recording === recorder) recorder.stop(); }, MAX_VOICE_SECONDS * 1000);
  } catch { notify('Нет доступа к микрофону. Разрешите запись в настройках Android.', true); }
}

function scheduleExpiry(chatId, messageId, ttl, at) {
  const key = `${chatId}|${messageId}`;
  if (ttlTimers.has(key)) return;
  const left = at + ttl * 1000 - Date.now();
  const timer = setTimeout(() => {
    ttlTimers.delete(key);
    // Timers longer than one hour are re-armed rather than deleted early; browser
    // timeout values are bounded and cannot safely hold a seven-day delay at once.
    if (at + ttl * 1000 > Date.now()) scheduleExpiry(chatId, messageId, ttl, at);
    else void expireMessage(chatId, messageId);
  }, Math.max(0, Math.min(left, 3_600_000)));
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
  if (!$('#palette').hidden) { closePalette(); return true; }
  if (!$('#action-sheet').hidden) { closeActionSheet(); return true; }
  if (!$('#emoji-picker').hidden) { closeEmojiPicker(); return true; }
  if (state.call) { endCurrentCall(); return true; }
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

function hideMentionPicker() {
  const picker = $('#mention-picker');
  if (!picker) return;
  picker.hidden = true;
  picker.replaceChildren();
}

function updateMentionPicker() {
  const picker = $('#mention-picker');
  const input = $('#message-input');
  if (!picker || !input || state.current === 'saved') return hideMentionPicker();
  const beforeCursor = input.value.slice(0, input.selectionStart);
  const found = beforeCursor.match(/(?:^|\s)@([a-z0-9_]*)$/i);
  if (!found) return hideMentionPicker();
  const query = found[1].toLowerCase();
  const matches = state.chats
    .filter(chat => chat.id !== 'saved' && chat.username && chat.username.startsWith(query))
    .slice(0, 5);
  if (!matches.length) return hideMentionPicker();
  picker.replaceChildren();
  for (const chat of matches) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.mentionId = chat.id;
    button.innerHTML = '<strong></strong><span></span>';
    button.querySelector('strong').textContent = `@${chat.username}`;
    button.querySelector('span').textContent = chat.name;
    picker.appendChild(button);
  }
  picker.hidden = false;
}

function insertMention(chatId) {
  const chat = state.chats.find(item => item.id === chatId && item.username);
  const input = $('#message-input');
  if (!chat || !input) return;
  const before = input.value.slice(0, input.selectionStart);
  const match = before.match(/@([a-z0-9_]*)$/i);
  if (!match) return;
  const start = input.selectionStart - match[0].length;
  input.setRangeText(`@${chat.username} `, start, input.selectionEnd, 'end');
  input.focus(); updateComposer(); rememberDraft(); hideMentionPicker();
}

async function downloadAttachment(fileId) {
  const record = await store.getAttachment(fileId);
  if (!record?.blob) { notify('Файл ещё не получен полностью.', true); return; }
  if (window.LiboAndroid?.startSaveFile) {
    if (state.nativeSave) { notify('Сначала завершите текущее сохранение файла.', true); return; }
    state.nativeSave = { fileId, blob: record.blob, index: 0, name: record.name || 'LIBO-file', mime: record.mime || 'application/octet-stream' };
    window.LiboAndroid.startSaveFile(state.nativeSave.name, state.nativeSave.mime, record.blob.size);
    return;
  }
  const url = await attachmentObjectUrl(fileId);
  if (!url) { notify('Не удалось открыть сохранённый файл.', true); return; }
  const link = document.createElement('a'); link.href = url; link.download = record.name || 'LIBO-file';
  document.body.appendChild(link); link.click(); link.remove();
  notify('Открыто системное сохранение файла.');
}

async function sendNativeSaveChunk() {
  const pending = state.nativeSave;
  if (!pending) return;
  const start = pending.index * FILE_CHUNK_SIZE;
  if (start >= pending.blob.size) { window.LiboAndroid?.finishSaveFile(); return; }
  const bytes = new Uint8Array(await pending.blob.slice(start, Math.min(pending.blob.size, start + FILE_CHUNK_SIZE)).arrayBuffer());
  pending.index++;
  window.LiboAndroid?.writeSaveChunk(bytesToBase64(bytes));
}

function nativeSaveReady(ok, detail = '') {
  if (!state.nativeSave) return;
  if (!ok) { state.nativeSave = null; notify(detail || 'Не удалось открыть место для сохранения.', true); return; }
  void sendNativeSaveChunk().catch(error => { state.nativeSave = null; notify(error.message || 'Не удалось сохранить файл.', true); });
}

function nativeSaveChunkWritten(ok, detail = '') {
  if (!state.nativeSave) return;
  if (!ok) { state.nativeSave = null; notify(detail || 'Не удалось записать файл.', true); return; }
  void sendNativeSaveChunk().catch(error => { state.nativeSave = null; notify(error.message || 'Не удалось сохранить файл.', true); });
}

function nativeSaveFinished(ok, detail = '') {
  const pending = state.nativeSave;
  state.nativeSave = null;
  notify(ok ? `Файл «${pending?.name || ''}» сохранён.` : (detail || 'Не удалось завершить сохранение файла.'), !ok);
}

async function openStreamPhoto(fileId) {
  const record = await store.getAttachment(fileId);
  if (!record?.blob) { notify('Фотография ещё загружается.', true); return; }
  const url = await attachmentObjectUrl(fileId);
  if (url) { openDialog('photo-dialog'); $('#full-photo').src = url; }
}

async function resumeAttachment(fileId) {
  const record = await store.getAttachment(fileId);
  if (!record) return;
  const hit = state.chats.map(chat => ({ chat, message: chat.messages.find(message => message.att?.fileId === fileId) })).find(item => item.message);
  if (record.direction === 'out' && hit) {
    await store.updateAttachment(fileId, { state: 'queued', error: '' });
    await changeChat(hit.chat.id, chat => {
      const index = chat.messages.findIndex(message => message.att?.fileId === fileId);
      if (index < 0) return false;
      chat.messages[index] = { ...chat.messages[index], status: 'queued', attachmentError: '' };
    });
    reportTransfer(fileId, { state: 'queued', sentBytes: record.sentBytes || 0, size: record.size, error: '' });
    transport.connect(hit.chat.id);
    if (transport.isOpen(hit.chat.id)) await transferManager.start(hit.chat.id, hit.chat.id, hit.message.id, hit.message.att);
    notify('Передача будет продолжена при соединении с собеседником.');
  } else if (record.direction === 'in') {
    await store.updateAttachment(fileId, { state: 'receiving', error: '' });
    reportTransfer(fileId, { state: 'receiving', receivedBytes: record.receivedBytes || 0, size: record.size, error: '' });
    transport.connect(record.peerId);
    notify('Запрос на продолжение ждёт подключения отправителя.');
  }
}

function bindEvents() {
  document.addEventListener('click', event => {
    const dialogButton = event.target.closest('[data-dialog]');
    if (dialogButton) { openDialog(dialogButton.dataset.dialog); return; }
    if (event.target.closest('[data-close]')) { event.target.closest('dialog')?.close(); return; }
    const row = event.target.closest('[data-chat-id]');
    if (row) void openChat(row.dataset.chatId);
    const mention = event.target.closest('[data-mention-id]');
    if (mention) { insertMention(mention.dataset.mentionId); return; }
    const profile = event.target.closest('[data-profile-id]');
    if (profile) { openContactProfile(profile.dataset.profileId); return; }
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
  $$('#reminder-dialog [data-remind-ms]').forEach(button => { button.onclick = () => void scheduleReminder(Date.now() + Number(button.dataset.remindMs)); });
  $('#reminder-dialog [data-remind-tomorrow]').onclick = () => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0); void scheduleReminder(tomorrow.getTime()); };
  $('#reminder-custom').onclick = () => { const at = new Date($('#reminder-date').value).getTime(); void scheduleReminder(at); };
  $('#add-contact-form').onsubmit = addContact;
  $('#settings-form').onsubmit = saveSettings;
  $('#settings-avatar').onclick = () => $('#profile-avatar-input').click();
  $('#profile-avatar-input').onchange = () => void setProfileAvatar($('#profile-avatar-input').files[0]);
  $('#chat-avatar').onclick = () => openContactProfile();
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
  $('#audio-call-button').onclick = () => void startDirectCall('audio');
  $('#video-call-button').onclick = () => void startDirectCall('video');
  $('#call-accept').onclick = () => void acceptIncomingCall();
  $('#call-end').onclick = endCurrentCall;
  $('#call-mute').onclick = toggleCallMute;
  $('#call-camera').onclick = toggleCallCamera;
  $('#call-diagnostics-toggle').onclick = () => void showCallDiagnostics();
  for (const type of ['all', 'unread']) $(`#filter-${type}`).onclick = () => {
    state.filter = type;
    $$('.filter').forEach(button => { const active = button.id === `filter-${type}`; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    renderSidebar();
  };
  $('#composer').onsubmit = sendMessage;
  $('#message-input').addEventListener('input', () => {
    updateComposer(); rememberDraft(); updateMentionPicker();
    if (state.current !== 'saved' && Date.now() - typingSentAt > 1000) {
      typingSentAt = Date.now(); transport.send(state.current, { v: 1, type: 'typing', active: !!$('#message-input').value });
    }
  });
  $('#message-input').addEventListener('keydown', event => {
    // Enter is a normal newline. Ctrl/Cmd+Enter sends, matching a multiline messenger
    // composer and avoiding the old one-character-per-line failure mode.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); void sendMessage(); }
    if (event.key === 'Escape') hideMentionPicker();
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
    const editHistory = event.target.closest('[data-edit-history]');
    if (editHistory) { showEditHistory(editHistory.dataset.editHistory); return; }
    const download = event.target.closest('[data-attachment-download]');
    if (download) { void downloadAttachment(download.dataset.attachmentDownload); return; }
    const cancel = event.target.closest('[data-attachment-cancel]');
    if (cancel) { void transferManager.cancel(cancel.dataset.attachmentCancel); return; }
    const resume = event.target.closest('[data-attachment-resume]');
    if (resume) { void resumeAttachment(resume.dataset.attachmentResume); return; }
    const streamPhoto = event.target.closest('[data-photo-file]');
    if (streamPhoto) { void openStreamPhoto(streamPhoto.dataset.photoFile); return; }
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
    $('#ttl-label').textContent = { 10: '10с', 30: '30с', 60: '1м', 300: '5м', 3600: '1ч', 86400: '1д', 604800: '7д' }[state.ttl] || '';
    button.title = state.ttl ? `Секретный таймер: ${$('#ttl-label').textContent}` : 'Секретный таймер: выключен';
    syncTtlChip();
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
  $('#audio-as-file').onclick = () => { const file = state.pendingAudioFile; state.pendingAudioFile = null; closeDialogs(); if (file) void attachFile(file, 'audio'); };
  $('#audio-as-music').onclick = () => { const file = state.pendingAudioFile; state.pendingAudioFile = null; closeDialogs(); if (file) void attachFile(file, 'music'); };
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); }
    if (event.key === 'Escape' && !$('dialog[open]')) handleBack();
  });
  window.Libo = {
    handleBack,
    onExportSaved: () => notify('Экспорт сохранён'),
    onNativeReminder(chatId, messageId) { void openReminderTarget(chatId, messageId); },
    onNativeSaveReady: nativeSaveReady,
    onNativeSaveChunkWritten: nativeSaveChunkWritten,
    onNativeSaveFinished: nativeSaveFinished,
    openLink(link) { void openLiboLink(link); },
  };
}


/* ==========================================================================
   LIBO 2.12 «polished» interface upgrades
   --------------------------------------------------------------------------
   1. ⌘K command palette — chats, messages and actions in one keystroke.
   2. Swipe-to-reply + long-press menu on every message row.
   3. Double-tap / double-click quick ❤️ reaction.
   4. Draft previews (and their real text) in the chat list.
   5. Relative presence («5 мин назад») in the chat header.
   6. Emoji panel 2.0 with categories, search and recents.
   7. Appearance: six accents, compact density, three text sizes.
   8. Chat context sheet on long-press / right-click.
   9. Scroll-to-bottom capsule with an unread-in-view counter.
   Everything is local: no new network call, storage key or permission.
   ========================================================================== */

const ACCENTS = ['violet', 'mint', 'blue', 'peach', 'rose', 'graphite'];
const FONT_SIZES = ['s', 'm', 'l'];
const EMOJI_RECENT_KEY = 'libo-v2-emoji-recent';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* 5 — relative presence ---------------------------------------------------- */
function relativeTime(at) {
  if (!Number.isFinite(at)) return 'недавно';
  const diff = Math.max(0, Date.now() - at);
  if (diff < 45_000) return 'только что';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} мин назад`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ч назад`;
  if (diff < 172_800_000) return 'вчера';
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} дн назад`;
  return dateFormat.format(new Date(at));
}

/* 7 — appearance ----------------------------------------------------------- */
function applyAppearance() {
  const settings = state.settings || {};
  const root = document.documentElement;
  const accent = ACCENTS.includes(settings.accent) ? settings.accent : 'violet';
  root.dataset.accent = accent;
  root.dataset.density = settings.density === 'compact' ? 'compact' : 'comfortable';
  root.dataset.font = FONT_SIZES.includes(settings.font) ? settings.font : 'm';
  $$('.accent-swatches [data-accent]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.accent === accent));
  });
  if ($('#density-select')) $('#density-select').value = root.dataset.density;
  if ($('#font-select')) $('#font-select').value = root.dataset.font;
}

async function setAppearance(patch) {
  const previous = state.settings;
  state.settings = { ...state.settings, ...patch };
  applyAppearance(); rememberUi();
  try { await store.setMeta('settings', state.settings); }
  catch { state.settings = previous; applyAppearance(); notify('Оформление не сохранено.', true); }
}

/* 6 — emoji panel 2.0 ------------------------------------------------------ */
const EMOJI_GROUPS = [
  { id: 'recent', glyph: '🕘', label: 'Недавние', items: [] },
  { id: 'smileys', glyph: '😊', label: 'Смайлы', items: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👻', '💀', '🤖', '🎃'] },
  { id: 'gestures', glyph: '👍', label: 'Жесты', items: ['👍', '👎', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '💪', '🦾', '👏', '🙌', '👐', '🤲', '🤜', '🤛', '✊', '👊', '🫶', '🫰', '🤌'] },
  { id: 'hearts', glyph: '❤️', label: 'Сердца', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💝', '💘', '💌', '💋', '🫀', '🫂'] },
  { id: 'objects', glyph: '✨', label: 'Символы', items: ['✨', '🌟', '⭐️', '💫', '🔥', '💥', '💦', '💨', '🎉', '🎊', '🎁', '🎈', '🎂', '🍰', '☕️', '🍵', '🍕', '🍔', '🍟', '🌮', '🍫', '🍿', '🥂', '🍾', '🌙', '☀️', '🌈', '☁️', '🌧️', '❄️', '🌸', '🌺', '🌻', '🍀', '🌿', '🌊', '🎵', '🎧', '📷', '📎', '📌', '✏️', '📝', '⏰', '⌛️', '🔔', '🔒', '🔑', '💡', '🚀', '✈️', '🏠', '🎯', '⚽️', '🎮', '✅', '❌', '➡️', '⬅️', '♾️'] },
];

let emojiGroup = 'recent';
let emojiQuery = '';

function emojiRecent() {
  try {
    const value = JSON.parse(localStorage.getItem(EMOJI_RECENT_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 24) : [];
  } catch { return []; }
}

function rememberEmoji(emoji) {
  const next = [emoji, ...emojiRecent().filter(item => item !== emoji)].slice(0, 24);
  try { localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(next)); } catch { /* cosmetic only */ }
}

function emojiItems() {
  if (emojiQuery) {
    const direct = [...new Set(EMOJI_GROUPS.flatMap(group => group.items))].filter(item => item.includes(emojiQuery));
    if (direct.length) return direct.slice(0, 64);
    const groups = EMOJI_GROUPS.filter(group => group.id !== 'recent' && group.label.toLocaleLowerCase('ru').includes(emojiQuery));
    return groups.flatMap(group => group.items);
  }
  if (emojiGroup === 'recent') return emojiRecent();
  return EMOJI_GROUPS.find(group => group.id === emojiGroup)?.items || [];
}

function renderEmojiGrid() {
  const grid = $('#emoji-grid');
  if (!grid) return;
  const items = emojiItems();
  grid.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'emoji-empty';
    empty.textContent = emojiQuery ? 'Ничего не нашлось' : 'Пока пусто — выберите эмодзи, и он появится здесь.';
    grid.appendChild(empty);
    return;
  }
  for (const emoji of items) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = emoji; button.setAttribute('aria-label', emoji);
    button.onclick = () => {
      const input = $('#message-input');
      if (input.value.length + emoji.length > MAX_TEXT) return;
      input.setRangeText(emoji, input.selectionStart, input.selectionEnd, 'end');
      rememberEmoji(emoji);
      input.focus(); updateComposer(); rememberDraft();
    };
    grid.appendChild(button);
  }
}

function buildEmojiPicker() {
  const picker = $('#emoji-picker');
  if (!picker) return;
  picker.replaceChildren();
  const head = document.createElement('div');
  head.className = 'emoji-head';
  const search = document.createElement('label');
  search.className = 'emoji-search';
  search.innerHTML = svg('search');
  const input = document.createElement('input');
  input.type = 'search'; input.placeholder = 'Поиск эмодзи'; input.value = emojiQuery;
  input.setAttribute('aria-label', 'Поиск эмодзи'); input.autocomplete = 'off';
  input.addEventListener('input', () => { emojiQuery = input.value.trim().toLocaleLowerCase('ru'); renderEmojiGrid(); });
  search.appendChild(input);
  head.appendChild(search);
  picker.appendChild(head);

  const categories = document.createElement('div');
  categories.className = 'emoji-cats'; categories.setAttribute('role', 'tablist');
  for (const group of EMOJI_GROUPS) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = group.glyph; button.title = group.label;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-label', group.label);
    button.classList.toggle('active', group.id === emojiGroup && !emojiQuery);
    button.onclick = () => { emojiGroup = group.id; emojiQuery = ''; buildEmojiPicker(); };
    categories.appendChild(button);
  }
  picker.appendChild(categories);

  const grid = document.createElement('div');
  grid.className = 'emoji-grid'; grid.id = 'emoji-grid';
  picker.appendChild(grid);
  renderEmojiGrid();
}

function closeEmojiPicker() {
  const picker = $('#emoji-picker');
  if (!picker || picker.hidden) return false;
  picker.hidden = true;
  $('#emoji-button').setAttribute('aria-expanded', 'false');
  return true;
}

/* 9 — scroll-to-bottom capsule -------------------------------------------- */
function noteIncoming() {
  const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  state.newBelow = nearBottom ? 0 : (state.newBelow || 0) + 1;
  requestAnimationFrame(updateScrollButton);
}

function updateScrollButton() {
  const button = $('#scroll-down');
  if (!button) return;
  const box = $('#messages');
  if (!state.current || $('#conversation').hidden) { button.hidden = true; return; }
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (nearBottom) state.newBelow = 0;
  button.hidden = nearBottom;
  const count = $('#scroll-down-count');
  if (count) {
    count.hidden = !state.newBelow;
    count.textContent = state.newBelow > 99 ? '99+' : String(state.newBelow || '');
  }
}

/* reusable action sheet (features 2, 8 and the mobile composer tray) -------- */
function openActionSheet(title, items) {
  const list = $('#sheet-list');
  if (!list) return;
  $('#sheet-title').textContent = title || '';
  list.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sheet-item${item.danger ? ' danger' : ''}`;
    if (item.checked) button.dataset.checked = 'true';
    const icon = document.createElement('span');
    icon.className = 'sheet-icon'; icon.innerHTML = svg(item.icon || 'info');
    const text = document.createElement('span');
    text.className = 'sheet-text';
    const strong = document.createElement('strong');
    strong.textContent = item.label;
    text.appendChild(strong);
    if (item.hint) {
      const small = document.createElement('small');
      small.textContent = item.hint;
      text.appendChild(small);
    }
    button.append(icon, text);
    button.onclick = () => {
      closeActionSheet();
      try { void Promise.resolve(item.run?.()).catch(error => notify(error.message || 'Не удалось выполнить действие.', true)); }
      catch (error) { notify(error.message || 'Не удалось выполнить действие.', true); }
    };
    list.appendChild(button);
  }
  $('#action-sheet').hidden = false;
}

function closeActionSheet() {
  const sheet = $('#action-sheet');
  if (sheet) sheet.hidden = true;
}

function openComposerSheet() {
  const chat = activeChat();
  if (!chat) return;
  const options = [
    { icon: 'attach', label: 'Фото или скриншот', hint: 'JPG, PNG, WebP до 12 МБ', run: () => $('#photo-input').click() },
    { icon: 'file', label: 'Файл, аудио или видео', hint: 'До 100 МБ частями с SHA-256', run: () => $('#file-input').click() },
    { icon: 'mic', label: 'Голосовое сообщение', hint: 'До 60 секунд', run: () => $('#voice-button').click() },
    { icon: 'poll', label: 'Опрос', hint: 'До восьми вариантов', run: () => $('#poll-button').click() },
    { icon: 'timer', label: state.ttl ? 'Секретный таймер включён' : 'Секретный таймер', hint: 'Самоуничтожение новых сообщений', checked: !!state.ttl, run: () => $('#ttl-button').click() },
  ];
  if (chat.id === 'saved') options.pop();
  openActionSheet('Вложение', options);
}

/* 8 — chat context sheet --------------------------------------------------- */
async function patchChat(id, mutate) {
  const chat = await changeChat(id, mutate);
  renderSidebar();
  if (state.current === id) renderHeader();
  return chat;
}

function openChatSheet(id) {
  const chat = state.chats.find(item => item.id === id);
  if (!chat) return;
  const items = [];
  if (chat.id !== 'saved') {
    items.push({
      icon: 'star', checked: !!chat.starred,
      label: chat.starred ? 'Убрать из близких' : 'Добавить в близкие',
      hint: 'Закрепляет чат выше в списке',
      run: () => patchChat(id, next => { next.starred = !next.starred; }),
    });
    items.push({
      icon: 'mute', checked: !!chat.muted,
      label: chat.muted ? 'Включить звук' : 'Отключить звук',
      hint: chat.muted ? 'Уведомления снова включены' : 'Чат не будет звучать',
      run: () => patchChat(id, next => { next.muted = !next.muted; }),
    });
  }
  items.push({
    icon: 'checks', checked: !chat.unread,
    label: chat.unread ? 'Отметить прочитанным' : 'Отметить непрочитанным',
    hint: chat.unread ? 'Счётчик сбросится' : 'Останется напоминание в списке',
    run: () => patchChat(id, next => { next.unread = next.unread ? 0 : Math.max(1, next.unread || 1); }),
  });
  if (chat.id !== 'saved') {
    items.push({
      icon: 'folder', checked: !!chat.folder,
      label: chat.folder ? 'Убрать из папки' : 'В папку «Работа»',
      hint: 'Локальная сортировка списка',
      run: () => patchChat(id, next => { next.folder = next.folder ? '' : 'work'; }),
    });
    items.push({
      icon: 'download', label: 'Экспорт переписки', hint: 'Текстовая копия на устройстве',
      run: () => exportChats([chat]),
    });
  }
  items.push({
    icon: 'trash', label: 'Очистить историю', hint: 'Только на этом устройстве', danger: true,
    run: () => confirmDialog('Очистить историю?', `Сообщения чата «${chat.name}» удалятся только на этом устройстве. Собеседник сохранит свою копию.`, async () => {
      await changeChat(id, next => { next.messages = []; next.unread = 0; next.updatedAt = 0; });
      renderSidebar();
      if (state.current === id) { renderMessages(); renderHeader(); }
      notify('История очищена на этом устройстве');
    }, 'Очистить'),
  });
  openActionSheet(chat.name, items);
}

function bindChatGestures() {
  const list = $('#chat-list');
  let timer = null, row = null, startX = 0, startY = 0, suppress = 0;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  list.addEventListener('pointerdown', event => {
    row = event.target.closest('.chat-row');
    if (!row || event.button === 2) return;
    startX = event.clientX; startY = event.clientY;
    cancel();
    timer = setTimeout(() => {
      suppress = Date.now();
      navigator.vibrate?.(14);
      openChatSheet(row.dataset.chatId);
    }, 460);
  });
  list.addEventListener('pointermove', event => {
    if (!row) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 9) cancel();
  });
  list.addEventListener('pointerup', cancel);
  list.addEventListener('pointercancel', () => { cancel(); row = null; });
  list.addEventListener('contextmenu', event => {
    const target = event.target.closest('.chat-row');
    if (!target) return;
    event.preventDefault();
    suppress = Date.now();
    openChatSheet(target.dataset.chatId);
  });
  list.addEventListener('click', event => {
    if (Date.now() - suppress < 700) { event.preventDefault(); event.stopPropagation(); }
  }, true);
}

/* 2 + 3 — swipe-to-reply, long-press menu and double-tap reaction ---------- */
function bindMessageGestures() {
  const box = $('#messages');
  let row = null, startX = 0, startY = 0, moved = false, swiping = false;
  let timer = null, lastTapId = null, lastTapAt = 0, suppress = 0;

  const resetRow = () => {
    if (row) { row.style.transform = ''; row.classList.remove('swiping', 'swipe-reply'); }
    row = null; swiping = false;
  };

  box.addEventListener('pointerdown', event => {
    if (event.button === 2 || state.selection) return;
    const target = event.target.closest('.message-row');
    if (!target) return;
    row = target; startX = event.clientX; startY = event.clientY; moved = false; swiping = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!row || moved) return;
      suppress = Date.now();
      navigator.vibrate?.(14);
      openMessageActions(row.querySelector('[data-actions]'), row.dataset.messageId);
      resetRow();
    }, 480);
  }, { passive: true });

  box.addEventListener('pointermove', event => {
    if (!row) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { moved = true; if (timer) clearTimeout(timer); }
    if (!swiping && event.pointerType !== 'mouse' && dx > 22 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiping = true; row.classList.add('swiping', 'swipe-reply');
    }
    if (swiping) row.style.transform = `translateX(${Math.min(84, dx)}px)`;
  }, { passive: true });

  const finish = event => {
    if (timer) clearTimeout(timer);
    const current = row;
    const wasSwipe = swiping;
    const dx = event.clientX - startX;
    if (wasSwipe) {
      row.style.transform = '';
      row.classList.remove('swiping', 'swipe-reply');
      swiping = false; row = null;
      if (dx > 64) {
        suppress = Date.now();
        navigator.vibrate?.(10);
        void actOnMessage('reply', current.dataset.messageId);
      }
      return;
    }
    resetRow();
    if (!current || moved || Date.now() - suppress < 400) return;
    if (event.target.closest('button, a, img, textarea, input')) return;
    const id = current.dataset.messageId;
    if (lastTapId === id && Date.now() - lastTapAt < 320) {
      lastTapId = null;
      current.classList.add('double-tapped');
      setTimeout(() => current.classList.remove('double-tapped'), 340);
      navigator.vibrate?.(8);
      void actOnMessage('react', id, 'heart');
      return;
    }
    lastTapId = id; lastTapAt = Date.now();
  };
  box.addEventListener('pointerup', finish, { passive: true });
  box.addEventListener('pointercancel', () => { if (timer) clearTimeout(timer); resetRow(); });
  box.addEventListener('contextmenu', event => {
    const target = event.target.closest('.message-row');
    if (!target) return;
    event.preventDefault();
    suppress = Date.now();
    openMessageActions(target.querySelector('[data-actions]'), target.dataset.messageId);
  });
}

/* 1 — command palette ------------------------------------------------------ */
const paletteItems = [];
let paletteIndex = 0;
let paletteQuery = '';

function paletteCommands() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const locked = !!lockState();
  return [
    { icon: 'moon', title: dark ? 'Светлая тема' : 'Тёмная тема', hint: 'Оформление', run: () => void setTheme(dark ? 'light' : 'dark') },
    { icon: 'palette', title: 'Акцент, плотность и размер текста', hint: 'Настройки → Оформление', run: () => openDialog('settings-dialog') },
    { icon: 'settings', title: 'Настройки профиля', hint: 'Имя, @username, био, аватар', run: () => openDialog('settings-dialog') },
    { icon: 'link', title: 'Мой личный код', hint: 'QR и приглашение', run: () => openDialog('invite-dialog') },
    { icon: 'plus', title: 'Добавить контакт', hint: 'По коду LIBO', run: () => openDialog('new-dialog') },
    { icon: 'bookmark', title: 'Открыть «Избранное»', hint: 'Заметки только на этом устройстве', run: () => void openChat('saved') },
    { icon: 'bell-off', title: state.settings.sound ? 'Выключить звук сообщений' : 'Включить звук сообщений', hint: 'Когда LIBO открыт', run: () => void setAppearance({ sound: !state.settings.sound }).then(() => { $('#sound-enabled').checked = state.settings.sound; notify(state.settings.sound ? 'Звук включён' : 'Звук выключен'); }) },
    { icon: locked ? 'lock' : 'lock-open', title: locked ? 'Изменить код-замок' : 'Включить код-замок', hint: 'PIN 4–8 цифр, локально', run: () => openDialog('settings-dialog') },
    { icon: 'download-apk', title: `Скачать APK ${VERSION}`, hint: 'Android 8.0+', run: () => window.open(APK_URL, '_blank', 'noopener') },
    { icon: 'info', title: 'О LIBO', hint: `Версия ${VERSION}`, run: () => openDialog('about-dialog') },
  ];
}

function paletteSource() {
  const query = paletteQuery.trim().toLocaleLowerCase('ru');
  const match = value => !query || String(value || '').toLocaleLowerCase('ru').includes(query);
  const commands = paletteCommands().filter(item => match(item.title) || match(item.hint)).slice(0, query ? 6 : 6);
  const chats = state.chats
    .filter(chat => match(chat.name) || match(chat.username))
    .slice(0, query ? 6 : 6)
    .map(chat => ({
      icon: chat.id === 'saved' ? 'bookmark' : 'chat',
      title: chat.name,
      hint: chat.id === 'saved' ? 'Личные заметки' : previewText(chat.messages.at(-1)) || 'Нет сообщений',
      run: () => void openChat(chat.id),
    }));
  const messages = [];
  if (query.length > 1) {
    for (const chat of state.chats) {
      for (const message of [...chat.messages].reverse()) {
        if (!String(message.text || '').toLocaleLowerCase('ru').includes(query)) continue;
        messages.push({
          icon: 'search', title: message.text.slice(0, 90), group: 'Сообщения',
          hint: `${chat.name} · ${timeFormat.format(new Date(message.at))}`,
          run: () => { void openChat(chat.id).then(() => { state.highlight = message.id; renderMessages(); }); },
        });
        if (messages.length >= 6) break;
      }
      if (messages.length >= 6) break;
    }
  }
  return [
    ...(commands.length ? [{ group: 'Действия', items: commands }] : []),
    ...(chats.length ? [{ group: 'Чаты', items: chats }] : []),
    ...(messages.length ? [{ group: 'Сообщения', items: messages }] : []),
  ];
}

function renderPalette() {
  const results = $('#palette-results');
  if (!results) return;
  paletteItems.length = 0;
  results.replaceChildren();
  const groups = paletteSource();
  const query = paletteQuery.trim();
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'palette-empty';
    empty.textContent = 'Ничего не найдено. Попробуйте имя чата, слово из переписки или действие.';
    results.appendChild(empty);
    paletteIndex = 0;
    return;
  }
  const highlight = value => {
    const text = String(value);
    if (!query) return escapeHtml(text);
    const at = text.toLocaleLowerCase('ru').indexOf(query.toLocaleLowerCase('ru'));
    if (at < 0) return escapeHtml(text);
    return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(text.slice(at, at + query.length))}</mark>${escapeHtml(text.slice(at + query.length))}`;
  };
  for (const group of groups) {
    const heading = document.createElement('div');
    heading.className = 'palette-group';
    heading.textContent = group.group;
    results.appendChild(heading);
    for (const item of group.items) {
      const index = paletteItems.length;
      paletteItems.push(item);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'palette-item'; button.setAttribute('role', 'option');
      button.dataset.paletteIndex = String(index);
      button.innerHTML = `<span class="palette-icon">${svg(item.icon || 'info')}</span><span class="palette-text"><strong>${highlight(item.title)}</strong><small>${highlight(item.hint || '')}</small></span>`;
      button.addEventListener('mouseenter', () => selectPalette(index, false));
      button.addEventListener('click', () => runPalette(index));
      results.appendChild(button);
    }
  }
  paletteIndex = 0;
  selectPalette(0, true);
}

function selectPalette(index, scroll = true) {
  if (!paletteItems.length) return;
  paletteIndex = Math.max(0, Math.min(paletteItems.length - 1, index));
  $$('#palette-results .palette-item').forEach(button => {
    const selected = Number(button.dataset.paletteIndex) === paletteIndex;
    button.setAttribute('aria-selected', String(selected));
    if (selected && scroll) button.scrollIntoView({ block: 'nearest' });
  });
}

function runPalette(index) {
  const item = paletteItems[index];
  closePalette();
  if (item?.run) { try { item.run(); } catch (error) { notify(error.message || 'Действие не выполнено.', true); } }
}

function openPalette() {
  const palette = $('#palette');
  if (!palette) return;
  palette.hidden = false;
  paletteQuery = '';
  const input = $('#palette-input');
  input.value = '';
  renderPalette();
  setTimeout(() => input.focus(), 20);
}

function closePalette() {
  const palette = $('#palette');
  if (palette) palette.hidden = true;
}

function onPaletteKeydown(event) {
  if (event.key === 'ArrowDown') { event.preventDefault(); selectPalette(paletteIndex + 1); return; }
  if (event.key === 'ArrowUp') { event.preventDefault(); selectPalette(paletteIndex - 1); return; }
  if (event.key === 'Enter') { event.preventDefault(); runPalette(paletteIndex); return; }
  if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
}

/* TTL chip (visible on touch screens where the timer button lives in a tray) */
function syncTtlChip() {
  const chip = $('#ttl-active');
  if (!chip) return;
  const labels = { 10: '10 секунд', 30: '30 секунд', 60: '1 минуту', 300: '5 минут', 3600: '1 час', 86400: '1 день', 604800: '7 дней' };
  chip.hidden = !state.ttl;
  const label = $('#ttl-active-label');
  if (label && state.ttl) label.textContent = `Исчезнут через ${labels[state.ttl] || 'таймер'}`;
}

/* wiring ------------------------------------------------------------------ */

/* feature 4 — keep the sidebar draft line in sync without re-rendering the list */
function updateDraftRow(id, rawText) {
  const row = [...document.querySelectorAll('#chat-list .chat-row')].find(item => item.dataset.chatId === id);
  if (!row) return;
  const excerpt = row.querySelector('.chat-row-bottom p');
  if (!excerpt) return;
  const text = String(rawText || '').slice(0, MAX_TEXT);
  if (text.trim()) {
    excerpt.textContent = '';
    const label = document.createElement('span');
    label.className = 'draft-label';
    label.textContent = 'Черновик: ';
    excerpt.append(label, document.createTextNode(text.slice(0, 80)));
    excerpt.classList.add('has-draft');
    excerpt.title = text.slice(0, 300);
    return;
  }
  const chat = state.chats.find(item => item.id === id);
  const last = chat?.messages.at(-1);
  excerpt.classList.remove('has-draft');
  excerpt.title = '';
  excerpt.textContent = !last && id === 'saved' ? 'Ваши заметки, ссылки и идеи' : previewText(last);
}

function initInterface() {
  applyAppearance();
  bindMessageGestures();
  bindChatGestures();

  const box = $('#messages');
  let scheduled = 0;
  box.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => { scheduled = 0; updateScrollButton(); });
  }, { passive: true });
  $('#scroll-down').onclick = () => {
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    state.newBelow = 0;
    updateScrollButton();
  };

  $('#palette-input').addEventListener('keydown', onPaletteKeydown);
  $('#palette-input').addEventListener('input', event => {
    paletteQuery = event.target.value;
    renderPalette();
  });
  $('#palette').addEventListener('mousedown', event => { if (event.target.id === 'palette') closePalette(); });
  $('#sheet-close').onclick = closeActionSheet;
  $('#action-sheet').addEventListener('mousedown', event => { if (event.target.id === 'action-sheet') closeActionSheet(); });
  $('#composer-more').onclick = openComposerSheet;
  $('#message-input').addEventListener('input', () => {
    if (state.current) updateDraftRow(state.current, $('#message-input').value);
  });
  $('#ttl-active').onclick = () => $('#ttl-button').click();

  $$('.accent-swatches [data-accent]').forEach(button => {
    button.onclick = () => void setAppearance({ accent: button.dataset.accent });
  });
  if ($('#density-select')) $('#density-select').onchange = () => void setAppearance({ density: $('#density-select').value });
  if ($('#font-select')) $('#font-select').onchange = () => void setAppearance({ font: $('#font-select').value });

  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if ($('#palette').hidden) openPalette(); else closePalette();
    }
  }, true);

  updateScrollButton();
  syncTtlChip();
}

async function main() {
  await store.open();
  state.storageReady = true;
  renderStorage();
  state.profile = await store.getMeta('profile');
  if (!state.profile || !normalizePeerCode(state.profile.id)) {
    state.profile = { id: makePeerId(), name: 'Пользователь LIBO', username: '', bio: '', status: 'online', avatar: '' };
    await store.setMeta('profile', state.profile);
  } else {
    state.profile = {
      ...state.profile, username: normalizeUsername(state.profile.username), bio: normalizeBio(state.profile.bio),
      status: ['online', 'away', 'busy', 'offline'].includes(state.profile.status) ? state.profile.status : 'online',
      avatar: typeof state.profile.avatar === 'string' ? state.profile.avatar : '',
    };
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
  for (const chat of state.chats) {
    for (const message of chat.messages || []) if (message.ttl && !message.deleted) scheduleExpiry(chat.id, message.id, message.ttl, message.at);
  }
  try {
    state.drafts = await store.getMeta('drafts') || JSON.parse(localStorage.getItem('libo-v2-drafts') || '{}') || {};
  } catch { state.drafts = {}; }
  state.reminders = await store.getMeta('reminders') || [];
  for (const reminder of state.reminders.filter(item => item?.at > Date.now())) armBrowserReminder(reminder);
  $('#profile-button').textContent = initials(state.profile.name);
  $('#app-version').textContent = VERSION;
  $('#about-version').textContent = VERSION;
  $('#sidebar-version').textContent = `v${VERSION}`;
  $('#security-connection-link').classList.add('disabled');
  $('#security-connection-link').addEventListener('click', event => {
    event.preventDefault();
    if (event.currentTarget.dataset.chatId) void gotoSecurity(event.currentTarget.dataset.chatId);
  });
  $('#download-apk').href = APK_URL;
  const shareText = `LIBO ${VERSION} — local-first P2P-мессенджер для Android. История хранится на устройстве, собеседники общаются напрямую.`;
  $('#share-telegram').href = `https://t.me/share/url?url=${encodeURIComponent(APK_URL)}&text=${encodeURIComponent(shareText)}`;
  const savedSeen = await store.getMeta('lastSeen');
  if (savedSeen && typeof savedSeen === 'object') for (const [id, at] of Object.entries(savedSeen)) state.lastSeen.set(id, at);
  if (!window.MediaRecorder || !navigator.mediaDevices) $('#voice-button').hidden = true;
  bindEvents(); applyTheme(); applyWall(); applyAppearance(); initInterface(); renderSidebar(); renderNetwork(); renderStorage();
  hideBootLoader();
  if (lockState()) {
    $('#lock-screen').hidden = false;
    setTimeout(() => $('#lock-input').focus(), 50);
    await new Promise(resolve => { unlockResolve = resolve; });
    $('#lock-screen').hidden = true;
  }
  transport.start(state.profile, state.settings);
  setInterval(retryConnections, 6000);
  // Reads RTCPeerConnection statistics only while a remote stream is live.
  setInterval(() => { void refreshCallDiagnostics(); }, 2000);
}

main().catch(error => {
  hideBootLoader();
  const banner = $('#boot-error');
  banner.hidden = false;
  banner.textContent = `LIBO не может открыть хранилище. Проверьте свободное место, разрешите хранение данных в браузере и обновите Android System WebView. Данные не отправлены в сеть. ${error.message || ''}`;
  console.error('LIBO startup failed', error);
});
