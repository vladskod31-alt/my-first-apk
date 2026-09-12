import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { hashHex } from './crypto.mjs';
export const VERSION = '2.3.0';
export const MAX_TEXT = 4000;
export const MAX_IMAGE_DATA = 1_400_000;
export const MAX_MESSAGES = 500;
export const MAX_CHATS = 100;
const PEER_ID = /^libo-[a-f0-9]{32}$/;
const MESSAGE_ID = /^[a-f0-9-]{16,64}$/;

export function normalizeNickname(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/^@/, '').normalize('NFKC').toLowerCase();
  return name.length <= 24 && /^[\p{L}\p{N}_]{3,24}$/u.test(name) && !['пользователь_libo', 'libo', 'admin'].includes(name) ? name : null;
}
export async function peerIdForNickname(value) {
  const nick = normalizeNickname(value);
  if (!nick) throw new Error('NAME_INVALID');
  return `libo-${(await hashHex('LIBO-NICK-2.1:' + nick)).slice(0,32)}`;
}
export function normalizePhone(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 60 || !/^\+[\d ().-]+$/.test(value)) return null;
  const phone = parsePhoneNumberFromString(value);
  return phone?.isValid() ? phone.number : null;
}

export function normalizePeerId(value) {
  return typeof value === 'string' && PEER_ID.test(value) ? value : null;
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

export function previewText(message, t = value => value) {
  if (!message) return t('Начните с простого «привет»');
  const prefix = message.direction === 'out' ? t('Вы: ') : '';
  return prefix + (message.text || (message.image ? t('📷 Фотография') : t('Сообщение')));
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
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 2) return null;
  if (['read', 'read-ack'].includes(value.type)) {
    if (!Array.isArray(value.ids) || !value.ids.length || value.ids.length > 100 || value.ids.some(id => typeof id !== 'string' || !MESSAGE_ID.test(id))) return null;
    return { v: 2, type: value.type, ids: [...new Set(value.ids)] };
  }
  if (value.type === 'ack') {
    return typeof value.id === 'string' && MESSAGE_ID.test(value.id) ? { v: 2, type: 'ack', id: value.id } : null;
  }
  if (value.type === 'typing') {
    return typeof value.active === 'boolean' ? { v: 2, type: 'typing', active: value.active } : null;
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
  return { v: 2, type: 'message', id: value.id, text: value.text, at: value.at, image, reply };
}

export function toPacket(message) {
  return {
    v: 2, type: 'message', id: message.id, text: message.text,
    at: message.at, image: message.image || null, reply: message.reply || null,
  };
}

export function textExport(chats, profile) {
  return JSON.stringify({
    app: 'LIBO', version: VERSION, exportedAt: new Date().toISOString(),
    note: 'Text export. Photos, phone numbers, encryption keys and connection settings are not included.',
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
