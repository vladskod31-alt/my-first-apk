export const VERSION = '2.11.4.5';
// Standalone package avoids Android's signature conflict with legacy app.libo.messenger builds.
export const APK_URL = 'https://github.com/vladskod31-alt/my-first-apk/raw/arena/3f1b3fb8-my-first-apk/downloads/LIBO-2.11.4.5-standalone.apk';

// The limits below are the actual limits enforced by the browser client and packet
// validator. Large attachments are held as Blobs in IndexedDB and travel in small,
// acknowledged chunks; they are never put in one giant Base64 message.
export const MAX_TEXT = 4000;
export const MAX_IMAGE_FILE_SIZE = 12 * 1024 * 1024;
export const MAX_AUDIO_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_DOCUMENT_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_VOICE_MESSAGE_SIZE = 5 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 60;
export const FILE_CHUNK_SIZE = 24 * 1024;
export const MAX_FILE_CHUNKS = Math.ceil(MAX_DOCUMENT_FILE_SIZE / FILE_CHUNK_SIZE);
export const MAX_FILE_CHUNK_DATA = Math.ceil(FILE_CHUNK_SIZE / 3) * 4 + 8;

// Compatibility guards for 2.8.x packets. New 2.9 attachments use fileId + chunks.
export const MAX_IMAGE_DATA = 1_400_000;
export const MAX_ATT_DATA = 2_000_000;
export const MAX_ATTACH_BYTES = MAX_DOCUMENT_FILE_SIZE;
export const MAX_PINS = 10;
export const MAX_MESSAGES = 500;
export const MAX_CHATS = 100;
export const MAX_POLL_OPTIONS = 8;
export const TTL_OPTIONS = [0, 10, 30, 60, 300, 3600, 86400, 604800];
export const WALLPAPERS = ['plain', 'dusk', 'mint', 'mono'];
export const FOLDERS = { personal: 'Личные', work: 'Работа' };
export const REACTIONS = ['thumb', 'heart', 'laugh', 'surprise', 'sad', 'fire'];
export const REACTION_EMOJI = {
  thumb: '👍', heart: '❤️', laugh: '😂', surprise: '😮', sad: '😢', fire: '🔥',
};
export const CAPABILITIES = Object.freeze(['chunk-files-v1', 'profiles-v1', 'mentions-v1', 'links-v1', 'calls-v1']);

export const FEATURES = {
  delivery: 'Очередь офлайн и реальные статусы: отправлено, принято устройством, прочитано.',
  files: 'Аудио, музыка, видео и документы до 100 МБ передаются подтверждёнными частями.',
  profile: 'Профиль: имя, @username, био, статус и компактный аватар для известных контактов.',
  mentions: 'Упоминания известных контактов с автодополнением и переходом в профиль.',
  drafts: 'Черновики текста, ответа и безопасно сохранённого вложения для каждого чата.',
  reactions: 'Шесть реакций: 👍 ❤️ 😂 😮 😢 🔥.',
  polls: 'Опросы до восьми вариантов с голосованием и живыми итогами в личном чате.',
  links: 'QR и безопасные ссылки libo://user/… для профиля и приглашения.',
  security: 'ECDH P-256 + AES-256-GCM поверх DTLS, с проверкой отпечатка пары.',
  search: 'Поиск по локальной истории, людям, вложениям и ссылкам с фильтрами.',
  calls: 'Прямые 1:1 аудио- и видеозвонки WebRTC с реальными состояниями, mute/camera и diagnostics.',
};

const PEER_ID = /^libo-[a-f0-9]{32}$/;
const MESSAGE_ID = /^[a-f0-9-]{16,64}$/;
const FILE_ID = /^[a-f0-9-]{16,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MIME = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,63}$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const STREAM_KINDS = new Set(['image', 'audio', 'music', 'video', 'file', 'voice']);
const STATUS_VALUES = new Set(['online', 'away', 'busy', 'offline']);

const EXTENSION_MIME = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/opus', webm: 'audio/webm', mp4: 'video/mp4',
  mov: 'video/quicktime', mkv: 'video/x-matroska', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  txt: 'text/plain', json: 'application/json', zip: 'application/zip',
};

export function makePeerId() {
  return `libo-${crypto.randomUUID().replaceAll('-', '')}`;
}

export function makeFileId() { return crypto.randomUUID(); }

export function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  const username = value.trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z][a-z0-9_]{2,31}$/.test(username) ? username : '';
}

export function normalizeName(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '';
}

export function normalizeBio(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) : '';
}

export function normalizePeerCode(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const text = value.trim().toLowerCase();
  const link = parseLiboLink(text);
  if (link?.type === 'user') return link.id;
  const id = text.startsWith('libo:') ? text.slice(5).trim() : text;
  return PEER_ID.test(id) ? id : null;
}

export function parseLiboLink(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'libo:' || url.username || url.password || url.port || url.search || url.hash) return null;
    const type = url.hostname.toLowerCase();
    const id = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, '')).toLowerCase();
    if (!['user', 'chat', 'channel', 'message', 'file'].includes(type)) return null;
    if (!id || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) return null;
    if ((type === 'user' || type === 'chat') && !PEER_ID.test(id)) return null;
    return { type, id };
  } catch { return null; }
}

export function makeLiboLink(type, id) {
  if (!['user', 'chat', 'channel', 'message', 'file'].includes(type)) return '';
  const normalized = String(id || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(normalized)) return '';
  if ((type === 'user' || type === 'chat') && !PEER_ID.test(normalized)) return '';
  return `libo://${type}/${normalized}`;
}

export function initials(name) {
  const parts = String(name || 'Л').trim().split(/\s+/);
  return parts.slice(0, 2).map(part => [...part][0] || '').join('').toUpperCase();
}

export function avatarColor(id) {
  let hash = 0;
  for (const char of String(id)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return ['violet', 'mint', 'rose', 'peach', 'blue'][Math.abs(hash) % 5];
}

export function previewText(message) {
  if (!message) return 'Начните с простого «привет»';
  const prefix = message.direction === 'out' ? 'Вы: ' : '';
  const kind = message.att?.kind;
  const label = kind === 'music' ? '🎵 Музыка' : kind === 'audio' ? '🎧 Аудио' : kind === 'voice' ? '🎙 Голосовое'
    : kind === 'video' ? '🎬 Видео' : kind === 'image' || message.image ? '📷 Фотография'
      : kind === 'file' ? `📎 ${message.att.name || 'Файл'}` : 'Сообщение';
  return prefix + (message.text || label);
}

export function safeFilename(name) {
  return String(name || 'libo-file').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^\.+$/, '_').slice(0, 90) || 'libo-file';
}

export function mimeFromFilename(name) {
  const extension = String(name || '').split('.').pop()?.toLowerCase();
  return EXTENSION_MIME[extension] || 'application/octet-stream';
}

export function normalizeMime(value, filename = '') {
  const mime = String(value || '').trim().toLowerCase();
  return MIME.test(mime) ? mime : mimeFromFilename(filename);
}

export function isAudioMime(mime) { return /^audio\/[a-z0-9.+-]+$/i.test(mime); }
export function isVideoMime(mime) { return /^video\/(?:mp4|webm|quicktime|x-matroska)$/i.test(mime); }
export function isImageMime(mime) { return /^image\/(?:jpeg|png|webp|gif)$/i.test(mime); }

export function classifyAttachment(mime, filename = '', music = false) {
  const normalized = normalizeMime(mime, filename);
  if (isImageMime(normalized)) return 'image';
  if (isAudioMime(normalized)) return music ? 'music' : 'audio';
  if (isVideoMime(normalized)) return 'video';
  return 'file';
}

export function maxAttachmentBytes(kind) {
  if (kind === 'voice') return MAX_VOICE_MESSAGE_SIZE;
  if (kind === 'image') return MAX_IMAGE_FILE_SIZE;
  if (kind === 'audio' || kind === 'music') return MAX_AUDIO_FILE_SIZE;
  if (kind === 'video') return MAX_VIDEO_FILE_SIZE;
  return MAX_DOCUMENT_FILE_SIZE;
}

export function parseSignalingUrl(value, origin = '') {
  const url = new URL(value);
  const local = origin && url.origin === origin && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Сигнальному серверу нужен адрес HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Укажите адрес сервера без пароля, параметров и #.');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    path: url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`,
    secure: url.protocol === 'https:',
  };
}

export function makeIceServers(settings) {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (settings.turnUrl) {
    if (!/^turns?:[a-z0-9.\[\]:-]+(?::\d+)?(?:\?transport=(?:tcp|udp))?$/i.test(settings.turnUrl)) {
      throw new Error('TURN-адрес должен начинаться с turn: или turns:.');
    }
    if (!settings.turnUser || !settings.turnPassword) {
      throw new Error('Добавьте имя пользователя и пароль TURN-сервера.');
    }
    servers.push({ urls: settings.turnUrl, username: settings.turnUser, credential: settings.turnPassword });
  }
  return servers;
}

function validInlineImage(value, maxLength = 280_000) {
  return typeof value === 'string' && value.length <= maxLength
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
}

export function normalizePublicProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const username = normalizeUsername(value.username);
  const bio = normalizeBio(value.bio);
  const status = STATUS_VALUES.has(value.status) ? value.status : 'online';
  const avatar = validInlineImage(value.avatar) ? value.avatar : '';
  if (value.username != null && value.username !== '' && !username) return null;
  if (value.bio != null && typeof value.bio !== 'string') return null;
  if (value.status != null && !STATUS_VALUES.has(value.status)) return null;
  if (value.avatar != null && value.avatar !== '' && !avatar) return null;
  return { username, bio, status, avatar };
}

function attachmentMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = STREAM_KINDS.has(value.kind) ? value.kind : null;
  if (!kind || typeof value.fileId !== 'string' || !FILE_ID.test(value.fileId)) return null;
  const name = safeFilename(value.name);
  const mime = normalizeMime(value.mime, name);
  if ((kind === 'image' && !isImageMime(mime)) || ((kind === 'audio' || kind === 'music' || kind === 'voice') && !isAudioMime(mime)) || (kind === 'video' && !isVideoMime(mime))) return null;
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > maxAttachmentBytes(kind)) return null;
  if (!Number.isSafeInteger(value.chunkSize) || value.chunkSize < 8 * 1024 || value.chunkSize > FILE_CHUNK_SIZE) return null;
  const expectedChunks = Math.ceil(value.size / value.chunkSize);
  if (!Number.isSafeInteger(value.totalChunks) || value.totalChunks !== expectedChunks || value.totalChunks < 1 || value.totalChunks > MAX_FILE_CHUNKS) return null;
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) return null;
  const att = { kind, fileId: value.fileId, name, mime, size: value.size, chunkSize: value.chunkSize, totalChunks: value.totalChunks, sha256: value.sha256 };
  if (value.dur != null) {
    if (!Number.isFinite(value.dur) || value.dur < 0 || value.dur > 86_400_000) return null;
    att.dur = Math.round(value.dur);
  }
  for (const [key, limit] of [['title', 120], ['artist', 120], ['album', 120]]) {
    if (value[key] != null) {
      if (typeof value[key] !== 'string') return null;
      att[key] = value[key].replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
    }
  }
  if (value.cover != null) {
    if (!validInlineImage(value.cover)) return null;
    att.cover = value.cover;
  }
  if (value.preview != null) {
    if (!validInlineImage(value.preview)) return null;
    att.preview = value.preview;
  }
  return att;
}

function legacyAttachment(value) {
  if (value.kind === 'poll') {
    if (typeof value.q !== 'string' || !value.q.trim() || value.q.length > 300) return null;
    if (!Array.isArray(value.opts) || value.opts.length < 2 || value.opts.length > MAX_POLL_OPTIONS) return null;
    const opts = value.opts.map(opt => typeof opt === 'string' ? opt.trim().slice(0, 100) : '');
    if (opts.some(opt => !opt)) return null;
    return {
      kind: 'poll', q: value.q.trim().slice(0, 300), opts, votes: {},
      multi: Boolean(value.multi), anonymous: Boolean(value.anonymous), quiz: Boolean(value.quiz),
      correct: Number.isInteger(value.correct) && value.correct >= 0 && value.correct < opts.length ? value.correct : undefined,
    };
  }
  const kind = ['voice', 'video', 'file', 'audio'].includes(value.kind) ? value.kind : null;
  if (!kind || typeof value.data !== 'string' || value.data.length > MAX_ATT_DATA) return null;
  const prefix = { voice: 'data:audio/', audio: 'data:audio/', video: 'data:video/', file: 'data:' }[kind];
  if (!value.data.startsWith(prefix)) return null;
  const separator = value.data.indexOf(';base64,');
  if (separator < 6) return null;
  const mime = value.data.slice(5, separator).toLowerCase();
  if ((kind === 'voice' || kind === 'audio') && !isAudioMime(mime)) return null;
  if (kind === 'video' && !isVideoMime(mime)) return null;
  if (kind === 'file' && !MIME.test(mime)) return null;
  const att = { kind, data: value.data, name: safeFilename(value.name || ({ voice: 'voice.webm', audio: 'audio.bin', video: 'video.mp4', file: 'file.bin' }[kind])), mime };
  if (value.dur != null) {
    if (!Number.isFinite(value.dur) || value.dur < 0 || value.dur > 3_600_000) return null;
    att.dur = Math.round(value.dur);
  }
  return att;
}

function validateAttachment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value.data != null || value.kind === 'poll' ? legacyAttachment(value) : attachmentMeta(value);
}

function validateMentions(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 20) return false;
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || item.type !== 'mention' || !PEER_ID.test(item.userId)) return false;
    const username = normalizeUsername(item.username);
    if (!username || seen.has(item.userId)) return false;
    seen.add(item.userId);
    out.push({ type: 'mention', userId: item.userId, username });
  }
  return out;
}

function copyTiming(value, at) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const timing = {};
  for (const key of ['clientCreatedAt', 'sendStartedAt']) {
    if (value[key] != null) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > 8_640_000_000_000_000) return false;
      timing[key] = value[key];
    }
  }
  if (timing.clientCreatedAt != null && timing.clientCreatedAt > at + 60_000) return false;
  return timing;
}

function validControlFileId(value) { return typeof value === 'string' && FILE_ID.test(value); }

// Never spread untrusted data into application state. Each packet is copied and bounded.
export function validatePacket(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1) return null;
  if (value.type === 'hello') {
    const name = normalizeName(value.name);
    if (!PEER_ID.test(value.id) || !name || typeof value.name !== 'string' || value.name.length > 80) return null;
    const packet = { v: 1, type: 'hello', id: value.id, name };
    if (value.caps != null) {
      if (!Array.isArray(value.caps) || value.caps.length > CAPABILITIES.length || value.caps.some(cap => typeof cap !== 'string')) return null;
      packet.caps = [...new Set(value.caps.filter(cap => CAPABILITIES.includes(cap)))];
    }
    if (value.profile != null) {
      const profile = normalizePublicProfile(value.profile);
      if (!profile) return null;
      packet.profile = profile;
    }
    return packet;
  }
  if (value.type === 'ack') {
    if (typeof value.id !== 'string' || !MESSAGE_ID.test(value.id)) return null;
    const packet = { v: 1, type: 'ack', id: value.id };
    if (value.recipientReceivedAt != null) {
      if (!Number.isSafeInteger(value.recipientReceivedAt) || value.recipientReceivedAt < 1 || value.recipientReceivedAt > 8_640_000_000_000_000) return null;
      packet.recipientReceivedAt = value.recipientReceivedAt;
    }
    return packet;
  }
  if (value.type === 'typing') return typeof value.active === 'boolean' ? { v: 1, type: 'typing', active: value.active } : null;
  if (value.type === 'edit') {
    if (typeof value.id !== 'string' || !MESSAGE_ID.test(value.id)) return null;
    if (typeof value.text !== 'string' || value.text.length > MAX_TEXT || !value.text.trim()) return null;
    if (!Number.isSafeInteger(value.editedAt) || value.editedAt < 1 || value.editedAt > 8_640_000_000_000_000) return null;
    return { v: 1, type: 'edit', id: value.id, text: value.text, editedAt: value.editedAt };
  }
  if (value.type === 'delete') {
    if (!Array.isArray(value.ids) || !value.ids.length || value.ids.length > 20) return null;
    const ids = value.ids.filter(id => typeof id === 'string' && MESSAGE_ID.test(id));
    return ids.length === value.ids.length ? { v: 1, type: 'delete', ids } : null;
  }
  if (value.type === 'pin') return typeof value.id === 'string' && MESSAGE_ID.test(value.id) && typeof value.pinned === 'boolean'
    ? { v: 1, type: 'pin', id: value.id, pinned: value.pinned } : null;
  if (value.type === 'react') return typeof value.id === 'string' && MESSAGE_ID.test(value.id)
    && REACTIONS.includes(value.key) && typeof value.on === 'boolean'
    ? { v: 1, type: 'react', id: value.id, key: value.key, on: value.on } : null;
  if (value.type === 'read') {
    if (!Number.isSafeInteger(value.upTo) || value.upTo < 1) return null;
    const packet = { v: 1, type: 'read', upTo: value.upTo };
    if (value.readAt != null) {
      if (!Number.isSafeInteger(value.readAt) || value.readAt < 1) return null;
      packet.readAt = value.readAt;
    }
    return packet;
  }
  if (value.type === 'pollvote') {
    if (typeof value.pid !== 'string' || !MESSAGE_ID.test(value.pid) || !Number.isSafeInteger(value.opt) || value.opt < -1 || value.opt >= MAX_POLL_OPTIONS) return null;
    return { v: 1, type: 'pollvote', pid: value.pid, opt: value.opt };
  }
  if (value.type === 'mt-hello') return typeof value.pub === 'string' && value.pub.length <= 200 ? { v: 1, type: 'mt-hello', pub: value.pub } : null;
  if (value.type === 'mt') {
    if (!Number.isSafeInteger(value.msg_id) || typeof value.mk !== 'string' || value.mk.length > 44 || typeof value.iv !== 'string' || value.iv.length > 44 || typeof value.ct !== 'string' || value.ct.length > Math.max(MAX_ATT_DATA + 400_000, MAX_FILE_CHUNK_DATA * 3)) return null;
    return { v: 1, type: 'mt', msg_id: value.msg_id, mk: value.mk, iv: value.iv, ct: value.ct };
  }
  if (value.type === 'file-chunk') {
    if (!validControlFileId(value.fileId) || !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= MAX_FILE_CHUNKS || typeof value.data !== 'string' || value.data.length < 4 || value.data.length > MAX_FILE_CHUNK_DATA || !BASE64.test(value.data)) return null;
    return { v: 1, type: 'file-chunk', fileId: value.fileId, index: value.index, data: value.data };
  }
  if (value.type === 'file-receipt') return validControlFileId(value.fileId) && Number.isSafeInteger(value.index) && value.index >= 0 && value.index < MAX_FILE_CHUNKS
    ? { v: 1, type: 'file-receipt', fileId: value.fileId, index: value.index } : null;
  if (value.type === 'file-resume') return validControlFileId(value.fileId) ? { v: 1, type: 'file-resume', fileId: value.fileId } : null;
  if (value.type === 'file-state') return validControlFileId(value.fileId) && Number.isSafeInteger(value.next) && value.next >= 0 && value.next <= MAX_FILE_CHUNKS
    ? { v: 1, type: 'file-state', fileId: value.fileId, next: value.next } : null;
  if (value.type === 'file-complete') return validControlFileId(value.fileId) ? { v: 1, type: 'file-complete', fileId: value.fileId } : null;
  if (value.type === 'file-missing') return validControlFileId(value.fileId) && Number.isSafeInteger(value.next) && value.next >= 0 && value.next < MAX_FILE_CHUNKS
    ? { v: 1, type: 'file-missing', fileId: value.fileId, next: value.next } : null;
  if (value.type === 'file-ack') {
    if (!validControlFileId(value.fileId) || typeof value.ok !== 'boolean') return null;
    if (value.reason != null && (typeof value.reason !== 'string' || value.reason.length > 160)) return null;
    return { v: 1, type: 'file-ack', fileId: value.fileId, ok: value.ok, ...(value.reason ? { reason: value.reason } : {}) };
  }
  if (value.type === 'file-cancel') {
    if (!validControlFileId(value.fileId)) return null;
    if (value.reason != null && (typeof value.reason !== 'string' || value.reason.length > 160)) return null;
    return { v: 1, type: 'file-cancel', fileId: value.fileId, ...(value.reason ? { reason: value.reason } : {}) };
  }
  if (value.type !== 'message' || typeof value.id !== 'string' || !MESSAGE_ID.test(value.id)) return null;
  if (typeof value.text !== 'string' || value.text.length > MAX_TEXT) return null;
  if (!Number.isSafeInteger(value.at) || value.at < 1 || value.at > 8_640_000_000_000_000) return null;
  const att = validateAttachment(value.att);
  if (value.att != null && !att) return null;
  let image = null;
  if (value.image != null) {
    if (typeof value.image !== 'object' || typeof value.image.data !== 'string' || value.image.data.length > MAX_IMAGE_DATA || !validInlineImage(value.image.data, MAX_IMAGE_DATA)) return null;
    image = { data: value.image.data, name: safeFilename(value.image.name || 'photo.jpg') };
  }
  if (!value.text.trim() && !image && !att) return null;
  let reply = null;
  if (value.reply != null) {
    if (typeof value.reply !== 'object' || typeof value.reply.text !== 'string' || value.reply.text.length > 160 || typeof value.reply.name !== 'string' || value.reply.name.length > 40) return null;
    const name = normalizeName(value.reply.name);
    if (!name) return null;
    reply = { text: value.reply.text, name };
  }
  const mentions = validateMentions(value.mentions);
  if (mentions === false) return null;
  const timing = copyTiming(value.timing, value.at);
  if (timing === false) return null;
  const packet = { v: 1, type: 'message', id: value.id, text: value.text, at: value.at, image, reply };
  if (att) packet.att = att;
  if (mentions?.length) packet.mentions = mentions;
  if (timing && Object.keys(timing).length) packet.timing = timing;
  if (TTL_OPTIONS.includes(value.ttl)) packet.ttl = value.ttl;
  if (value.fwd != null) {
    if (typeof value.fwd !== 'object' || typeof value.fwd.from !== 'string' || !value.fwd.from.trim() || value.fwd.from.length > 40) return null;
    packet.fwd = { from: normalizeName(value.fwd.from) };
    if (!packet.fwd.from) return null;
  }
  if (Number.isSafeInteger(value.editedAt) && value.editedAt >= value.at && value.editedAt <= 8_640_000_000_000_000) packet.editedAt = value.editedAt;
  return packet;
}

// Short authentication string (SAS) for a chat pair. Both devices derive the same
// code from the two personal codes, so reading it aloud over a trusted channel
// confirms which code the connection was actually established with.
const VERIFY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export async function verificationCode(idA, idB) {
  const pair = [String(idA || '').toLowerCase(), String(idB || '').toLowerCase()].sort().join('|');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`libo-verify-v1|${pair}`)));
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 12) {
      out += VERIFY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `${out.slice(0, 4)} ${out.slice(4, 8)} ${out.slice(8, 12)}`;
}

export function toPacket(message) {
  const packet = {
    v: 1, type: 'message', id: message.id, text: message.text,
    at: message.at, image: message.image || null, reply: message.reply || null,
  };
  if (message.att) packet.att = message.att;
  if (message.mentions?.length) packet.mentions = message.mentions;
  if (message.timing) packet.timing = message.timing;
  if (message.editedAt) packet.editedAt = message.editedAt;
  if (message.ttl) packet.ttl = message.ttl;
  if (message.fwd) packet.fwd = message.fwd;
  return packet;
}

export const makeAckPacket = (id, recipientReceivedAt = Date.now()) => ({ v: 1, type: 'ack', id, recipientReceivedAt });
export const makeReadPacket = (upTo, readAt = Date.now()) => ({ v: 1, type: 'read', upTo, readAt });
export const makePollVotePacket = (pid, opt) => ({ v: 1, type: 'pollvote', pid, opt });
export const makeFileChunkPacket = (fileId, index, data) => ({ v: 1, type: 'file-chunk', fileId, index, data });
export const makeFileReceiptPacket = (fileId, index) => ({ v: 1, type: 'file-receipt', fileId, index });
export const makeFileResumePacket = fileId => ({ v: 1, type: 'file-resume', fileId });
export const makeFileStatePacket = (fileId, next) => ({ v: 1, type: 'file-state', fileId, next });
export const makeFileCompletePacket = fileId => ({ v: 1, type: 'file-complete', fileId });
export const makeFileMissingPacket = (fileId, next) => ({ v: 1, type: 'file-missing', fileId, next });
export const makeFileAckPacket = (fileId, ok, reason = '') => ({ v: 1, type: 'file-ack', fileId, ok: Boolean(ok), ...(reason ? { reason: String(reason).slice(0, 160) } : {}) });
export const makeFileCancelPacket = (fileId, reason = '') => ({ v: 1, type: 'file-cancel', fileId, ...(reason ? { reason: String(reason).slice(0, 160) } : {}) });

export function mergePollVote(votes, who, opt) {
  const next = { ...(votes || {}) };
  if (opt == null || opt < 0) delete next[who]; else next[who] = opt;
  return next;
}

export function pollTally(att) {
  const tally = att.opts.map(() => 0);
  for (const opt of Object.values(att.votes || {})) {
    if (Number.isInteger(opt) && opt >= 0 && opt < tally.length) tally[opt]++;
  }
  return tally;
}

export function makeEditPacket(id, text, editedAt) {
  return { v: 1, type: 'edit', id, text: String(text).slice(0, MAX_TEXT), editedAt };
}
export function makeDeletePacket(ids) { return { v: 1, type: 'delete', ids: ids.slice(0, 20) }; }
export function makePinPacket(id, pinned) { return { v: 1, type: 'pin', id, pinned: Boolean(pinned) }; }
export function makeReactPacket(id, key, on) { return { v: 1, type: 'react', id, key, on: Boolean(on) }; }

export function textExport(chats, profile) {
  return JSON.stringify({
    app: 'LIBO', version: VERSION, exportedAt: new Date().toISOString(),
    format: 'libo-text-export-v2',
    note: 'Текстовый экспорт. Бинарные вложения, личный код, идентификаторы контактов и настройки подключения не включены.',
    profile: { name: profile.name, username: profile.username || '' },
    chats: chats.map(chat => ({
      name: chat.name,
      username: chat.username || '',
      messages: chat.messages.map(m => ({
        text: m.text, at: m.at, direction: m.direction, status: m.status,
        reply: m.reply || null, photoFilename: m.image?.name || null,
        attachment: m.att ? { kind: m.att.kind, name: m.att.name || null, mime: m.att.mime || null, size: m.att.size || null } : null,
      })),
    })),
  }, null, 2);
}
