export const VERSION = '2.0.0-beta.1';
export const APK_URL = 'https://github.com/vladskod31-alt/my-first-apk/releases/download/v2.0.0-beta.1/LIBO-2.0.0-beta.1.apk';
export const REPO_URL = 'https://github.com/vladskod31-alt/my-first-apk/tree/arena/01a0708b-my-first-apk';
export const MAX_TEXT = 4000;
export const MAX_IMAGE_DATA = 1_400_000;
export const MAX_MESSAGES = 500;
export const MAX_CHATS = 100;
const PEER_ID = /^libo-[a-f0-9]{32}$/;
const MESSAGE_ID = /^[a-f0-9-]{16,64}$/;

export function makePeerId() {
  return `libo-${crypto.randomUUID().replaceAll('-', '')}`;
}

export function normalizePeerCode(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const text = value.trim().toLowerCase();
  const id = text.startsWith('libo:') ? text.slice(5).trim() : text;
  return PEER_ID.test(id) ? id : null;
}

export function normalizeName(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '';
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
  return prefix + (message.text || (message.image ? '📷 Фотография' : 'Сообщение'));
}

export function safeFilename(name) {
  return String(name || 'libo-export.json').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 90) || 'libo-export.json';
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

// Never spread untrusted data into application state. Each packet is copied and bounded.
export function validatePacket(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1) return null;
  if (value.type === 'hello') {
    const name = normalizeName(value.name);
    if (!PEER_ID.test(value.id) || !name || typeof value.name !== 'string' || value.name.length > 80) return null;
    return { v: 1, type: 'hello', id: value.id, name };
  }
  if (value.type === 'ack') {
    return typeof value.id === 'string' && MESSAGE_ID.test(value.id) ? { v: 1, type: 'ack', id: value.id } : null;
  }
  if (value.type === 'typing') {
    return typeof value.active === 'boolean' ? { v: 1, type: 'typing', active: value.active } : null;
  }
  if (value.type !== 'message' || typeof value.id !== 'string' || !MESSAGE_ID.test(value.id)) return null;
  if (typeof value.text !== 'string' || value.text.length > MAX_TEXT) return null;
  if (!Number.isSafeInteger(value.at) || value.at < 1 || value.at > 8_640_000_000_000_000) return null;
  let image = null;
  if (value.image != null) {
    if (typeof value.image !== 'object' || typeof value.image.data !== 'string' || value.image.data.length > MAX_IMAGE_DATA) return null;
    if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.image.data)) return null;
    image = { data: value.image.data, name: safeFilename(value.image.name || 'photo.jpg') };
  }
  if (!value.text.trim() && !image) return null;
  let reply = null;
  if (value.reply != null) {
    if (typeof value.reply !== 'object' || typeof value.reply.text !== 'string' || value.reply.text.length > 160) return null;
    if (typeof value.reply.name !== 'string' || value.reply.name.length > 40) return null;
    reply = { text: value.reply.text, name: normalizeName(value.reply.name) };
  }
  return { v: 1, type: 'message', id: value.id, text: value.text, at: value.at, image, reply };
}

export function toPacket(message) {
  return {
    v: 1, type: 'message', id: message.id, text: message.text,
    at: message.at, image: message.image || null, reply: message.reply || null,
  };
}

export function textExport(chats, profile) {
  return JSON.stringify({
    app: 'LIBO', version: VERSION, exportedAt: new Date().toISOString(),
    note: 'Текстовый экспорт. Фотографии, личный код и настройки подключения не включены.',
    profile: { name: profile.name },
    chats: chats.map(chat => ({
      name: chat.name,
      messages: chat.messages.map(m => ({
        text: m.text, at: m.at, direction: m.direction, status: m.status,
        reply: m.reply || null, photoFilename: m.image?.name || null,
      })),
    })),
  }, null, 2);
}
