export const VERSION = '2.8.2';
export const APK_URL = 'https://github.com/vladskod31-alt/my-first-apk/raw/refs/tags/v2.8.2/downloads/LIBO-2.8.2.apk';
// 2.8.2: twelve Telegram-style features (text markup, spoilers, quoted replies,
// hashtags, gestures, unread divider, pinned and archived chats, scheduled and silent
// messages, quiz polls, chat media panel) plus two extras (scheduled dark theme and
// screenshot protection in the APK). The About screen lists them from this map.
export const FEATURES = {
  markup: 'Разметка текста: жирный, курсив, подчёркнутый, зачёркнутый и моноширинный — панель «Aa» над полем ввода.',
  spoilers: 'Спойлеры: скрытый текст открывается нажатием и не виден в превью списка чатов.',
  quote: 'Ответ с цитатой: выделенный фрагмент собеседника переносится в ответ отдельным блоком.',
  tags: 'Хэштеги и ссылки: #теги стали кнопками поиска, адреса открываются одним нажатием.',
  gestures: 'Жесты: двойной тап по сообщению — быстрая реакция, свайп по строке — ответ.',
  unread: 'Разделитель «Непрочитанные» и кнопка вниз со счётчиком новых сообщений.',
  pinnedChats: 'Закреплённые чаты: важные диалоги всегда наверху списка.',
  archive: 'Архив чатов: лишние диалоги уезжают в отдельную полку со счётчиком непрочитанных.',
  scheduled: 'Отложенные сообщения: отправка через минуту, час, вечером или утром.',
  silent: 'Тихие сообщения: отправка без звукового сигнала у собеседника.',
  quiz: 'Опросы-квизы: правильный ответ, несколько вариантов и живые итоги.',
  media: 'Медиа-панель чата: фотографии, файлы, голосовые и теги в одном окне.',
  night: 'Бонус: ночная тема включается по расписанию в настройках.',
  secure: 'Бонус: в APK — защита от скриншотов и предпросмотра в списке задач.',
};
export const MAX_TEXT = 4000;
export const MAX_IMAGE_DATA = 1_400_000;
export const MAX_ATT_DATA = 2_000_000;
export const MAX_ATTACH_BYTES = 1_500_000;
export const MAX_VOICE_SECONDS = 60;
export const MAX_PINS = 10;
// Telegram-style extras of 2.8.0.
export const TTL_OPTIONS = [0, 10, 60, 3600];
export const WALLPAPERS = ['plain', 'dusk', 'mint', 'mono'];
export const FOLDERS = { personal: 'Личные', work: 'Работа' };
export const MAX_POLL_OPTIONS = 4;
// LIBO SVG-emoji: reaction keys, rendered from the inline symbol library (no fonts).
export const REACTIONS = ['heart', 'smile', 'spark', 'thumb', 'wow', 'hug'];
// 2.8.2: a double tap leaves the same reaction Telegram sends by default.
export const DEFAULT_REACTION = 'heart';
export const SCHEDULE_PRESETS = [
  { id: '1m', label: 'Через 1 минуту', ms: 60_000 },
  { id: '5m', label: 'Через 5 минут', ms: 300_000 },
  { id: '1h', label: 'Через 1 час', ms: 3_600_000 },
  { id: 'evening', label: 'В 19:00', hour: 19 },
  { id: 'morning', label: 'Завтра в 9:00', hour: 9, tomorrow: true },
];
export const NIGHT_DEFAULT = { enabled: false, from: '22:00', to: '07:00' };
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

// Telegram-style inline markup. The scanner is deliberately flat (no nesting) and
// bounded, so a hostile peer cannot make the renderer build deep trees.
const MARKUP = [
  ['bold', '**'], ['underline', '__'], ['strike', '~~'], ['spoiler', '||'],
  ['mono', '`'], ['italic', '_'], ['bold', '*'], ['strike', '~'],
];
const HASHTAG = /^#[\p{L}\p{N}_]{1,32}/u;
const LINK = /^(?:https?:\/\/|www\.)[^\s<>"'`]{2,300}/u;
const RICH_LIMIT = 300;

function markupAt(text, index) {
  for (const [type, token] of MARKUP) {
    if (!text.startsWith(token, index)) continue;
    const from = index + token.length;
    const inner = text[from];
    if (!inner || inner === ' ' || inner === '\n' || inner === token[0]) continue;
    const to = text.indexOf(token, from);
    if (to <= from) continue;
    const body = text.slice(from, to);
    if (body.length > RICH_LIMIT || body.includes('\n') || body.trim() !== body) continue;
    return { type, text: body, end: to + token.length };
  }
  return null;
}

// Pure tokenizer for message text: [{ type, text }]. Types: text, bold, italic,
// underline, strike, mono, spoiler, hashtag, link. Rendering is the caller's job.
export function richTokens(value) {
  const text = typeof value === 'string' ? value : '';
  const tokens = [];
  const push = (type, body) => {
    if (!body) return;
    const last = tokens.at(-1);
    if (last && last.type === type) last.text += body;
    else tokens.push({ type, text: body });
  };
  let index = 0;
  while (index < text.length) {
    const mark = markupAt(text, index);
    if (mark) {
      push(mark.type, mark.text);
      index = mark.end;
      continue;
    }
    const boundary = index === 0 || /\s|[(«"']/.test(text[index - 1]);
    if (boundary) {
      const rest = text.slice(index);
      const hashtag = rest.match(HASHTAG);
      if (hashtag) { push('hashtag', hashtag[0]); index += hashtag[0].length; continue; }
      const link = text[index] === 'w' || rest.startsWith('http') ? rest.match(LINK) : null;
      if (link) { push('link', link[0].replace(/[.,;:!?)]+$/, '')); index += link[0].replace(/[.,;:!?)]+$/, '').length; continue; }
    }
    push('text', text[index]);
    index += 1;
  }
  return tokens;
}

// Markup markers are never shown in previews, quotes or exports.
export function plainText(value) {
  return richTokens(value).map(token => token.text).join('');
}

export function hashtags(value) {
  const found = [];
  for (const token of richTokens(value)) {
    if (token.type !== 'hashtag') continue;
    const tag = token.text.toLowerCase();
    if (!found.includes(tag)) found.push(tag);
    if (found.length >= 20) break;
  }
  return found;
}

export function previewText(message) {
  if (!message) return 'Начните с простого «привет»';
  if (message.deleted) return 'Сообщение удалено';
  const prefix = message.direction === 'out' ? 'Вы: ' : '';
  const body = plainText(message.text || '')
    || (message.image ? '📷 Фотография' : { poll: '📊 Опрос', voice: '🎤 Голосовое', video: '🎬 Видео', file: '📎 Файл' }[message.att?.kind] || 'Сообщение');
  return prefix + body;
}

// «Отправить позже»: presets resolve to an absolute timestamp, so a reload or a
// suspended tab still fires the message at the intended moment.
export function scheduleAt(preset, now = Date.now()) {
  const entry = SCHEDULE_PRESETS.find(item => item.id === preset);
  if (!entry) return null;
  if (entry.ms) return now + entry.ms;
  const target = new Date(now);
  target.setHours(entry.hour, 0, 0, 0);
  if (entry.tomorrow || target.getTime() <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function minutesOfDay(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

// Night theme window supports windows that cross midnight (22:00 → 07:00).
export function isNightNow(at = Date.now(), from = NIGHT_DEFAULT.from, to = NIGHT_DEFAULT.to) {
  const start = minutesOfDay(from);
  const end = minutesOfDay(to);
  if (start == null || end == null || start === end) return false;
  const date = new Date(at);
  const now = date.getHours() * 60 + date.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
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
    if (!/^turns?:[a-z0-9.[\]:-]+(?::\d+)?(?:\?transport=(?:tcp|udp))?$/i.test(settings.turnUrl)) {
      throw new Error('TURN-адрес должен начинаться с turn: или turns:.');
    }
    if (!settings.turnUser || !settings.turnPassword) {
      throw new Error('Добавьте имя пользователя и пароль TURN-сервера.');
    }
    servers.push({ urls: settings.turnUrl, username: settings.turnUser, credential: settings.turnPassword });
  }
  return servers;
}

const ATT_MIME = {
  voice: /^audio\/(?:webm|mp4|mpeg|ogg|x-m4a|aac)$/,
  video: /^video\/(?:mp4|webm|quicktime|x-matroska)$/,
  file: /^(?:application|text)\/[a-z0-9.+-]{1,40}$|^image\/(?:jpeg|png|webp|gif)$/,
};

function validateAttachment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind === 'poll') {
    if (typeof value.q !== 'string' || !value.q.trim() || value.q.length > 300) return null;
    if (!Array.isArray(value.opts) || value.opts.length < 2 || value.opts.length > MAX_POLL_OPTIONS) return null;
    const opts = value.opts.map(opt => typeof opt === 'string' ? opt.trim().slice(0, 100) : '');
    if (opts.some(opt => !opt)) return null;
    const poll = { kind: 'poll', q: value.q.trim().slice(0, 300), opts, votes: {} };
    // 2.8.2: Telegram-style quiz (one right answer) and multiple-choice polls.
    if (value.quiz === true) {
      if (!Number.isInteger(value.correct) || value.correct < 0 || value.correct >= opts.length) return null;
      poll.quiz = true;
      poll.correct = value.correct;
    } else if (value.multi === true) {
      poll.multi = true;
    }
    return poll;
  }
  const kind = ['voice', 'video', 'file'].includes(value.kind) ? value.kind : null;
  if (!kind) return null;
  if (typeof value.data !== 'string' || value.data.length > MAX_ATT_DATA) return null;
  const prefix = { voice: 'data:audio/', video: 'data:video/', file: 'data:' }[kind];
  if (!value.data.startsWith(prefix)) return null;
  const mime = value.data.slice(5, value.data.indexOf(';base64,'));
  if (kind !== 'file' && !ATT_MIME[kind].test(mime)) return null;
  if (kind === 'file' && !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) return null;
  const att = { kind, data: value.data, name: safeFilename(value.name || ({ voice: 'voice.webm', video: 'video.mp4', file: 'file.bin' }[kind])), mime };
  if (value.dur != null) {
    if (!Number.isFinite(value.dur) || value.dur < 0 || value.dur > 3_600_000) return null;
    att.dur = Math.round(value.dur);
  }
  return att;
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
  if (value.type === 'edit') {
    if (typeof value.id !== 'string' || !MESSAGE_ID.test(value.id)) return null;
    if (typeof value.text !== 'string' || value.text.length > MAX_TEXT || !value.text.trim()) return null;
    if (!Number.isSafeInteger(value.editedAt) || value.editedAt < 1 || value.editedAt > 8_640_000_000_000_000) return null;
    return { v: 1, type: 'edit', id: value.id, text: value.text, editedAt: value.editedAt };
  }
  if (value.type === 'delete') {
    if (!Array.isArray(value.ids) || !value.ids.length || value.ids.length > 20) return null;
    const ids = value.ids.filter(id => typeof id === 'string' && MESSAGE_ID.test(id));
    if (!ids.length) return null;
    return { v: 1, type: 'delete', ids };
  }
  if (value.type === 'pin') {
    return typeof value.id === 'string' && MESSAGE_ID.test(value.id) && typeof value.pinned === 'boolean'
      ? { v: 1, type: 'pin', id: value.id, pinned: value.pinned } : null;
  }
  if (value.type === 'react') {
    return typeof value.id === 'string' && MESSAGE_ID.test(value.id)
      && REACTIONS.includes(value.key) && typeof value.on === 'boolean'
      ? { v: 1, type: 'react', id: value.id, key: value.key, on: value.on } : null;
  }
  if (value.type === 'read') {
    return Number.isSafeInteger(value.upTo) && value.upTo > 0 ? { v: 1, type: 'read', upTo: value.upTo } : null;
  }
  if (value.type === 'pollvote') {
    if (typeof value.pid !== 'string' || !MESSAGE_ID.test(value.pid)) return null;
    if (Array.isArray(value.opt)) {
      // 2.8.2: multiple answers travel as a sorted list of distinct option indexes.
      const picks = value.opt.filter(opt => Number.isInteger(opt) && opt >= 0 && opt < MAX_POLL_OPTIONS);
      if (!picks.length || picks.length !== value.opt.length || new Set(picks).size !== picks.length) return null;
      return { v: 1, type: 'pollvote', pid: value.pid, opt: [...picks].sort((a, b) => a - b) };
    }
    return Number.isSafeInteger(value.opt) && value.opt >= -1 && value.opt < MAX_POLL_OPTIONS
      ? { v: 1, type: 'pollvote', pid: value.pid, opt: value.opt } : null;
  }
  if (value.type === 'mt-hello') {
    return typeof value.pub === 'string' && value.pub.length <= 200 ? { v: 1, type: 'mt-hello', pub: value.pub } : null;
  }
  if (value.type === 'mt') {
    if (!Number.isSafeInteger(value.msg_id)) return null;
    if (typeof value.mk !== 'string' || value.mk.length > 44) return null;
    if (typeof value.iv !== 'string' || value.iv.length > 44) return null;
    if (typeof value.ct !== 'string' || value.ct.length > MAX_ATT_DATA + 400_000) return null;
    return { v: 1, type: 'mt', msg_id: value.msg_id, mk: value.mk, iv: value.iv, ct: value.ct };
  }
  if (value.type !== 'message' || typeof value.id !== 'string' || !MESSAGE_ID.test(value.id)) return null;
  if (typeof value.text !== 'string' || value.text.length > MAX_TEXT) return null;
  if (!Number.isSafeInteger(value.at) || value.at < 1 || value.at > 8_640_000_000_000_000) return null;
  const att = validateAttachment(value.att);
  if (value.att != null && !att) return null;
  let image = null;
  if (value.image != null) {
    if (typeof value.image !== 'object' || typeof value.image.data !== 'string' || value.image.data.length > MAX_IMAGE_DATA) return null;
    if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value.image.data)) return null;
    image = { data: value.image.data, name: safeFilename(value.image.name || 'photo.jpg') };
  }
  if (!value.text.trim() && !image && !att) return null;
  let reply = null;
  if (value.reply != null) {
    if (typeof value.reply !== 'object' || typeof value.reply.text !== 'string' || value.reply.text.length > 160) return null;
    if (typeof value.reply.name !== 'string' || value.reply.name.length > 40) return null;
    reply = { text: value.reply.text, name: normalizeName(value.reply.name) };
    // 2.8.2: quoted replies carry the fragment the author selected.
    if (value.reply.quote != null) {
      if (typeof value.reply.quote !== 'string' || value.reply.quote.length > 400) return null;
      const quote = value.reply.quote.trim().slice(0, 160);
      if (quote) reply.quote = quote;
    }
  }
  const packet = { v: 1, type: 'message', id: value.id, text: value.text, at: value.at, image, reply };
  if (att) packet.att = att;
  if (value.silent === true) packet.silent = true;
  if (TTL_OPTIONS.includes(value.ttl)) packet.ttl = value.ttl;
  if (value.fwd != null) {
    if (typeof value.fwd !== 'object' || typeof value.fwd.from !== 'string' || !value.fwd.from.length || value.fwd.from.length > 40) return null;
    packet.fwd = { from: value.fwd.from };
  }
  if (Number.isSafeInteger(value.editedAt) && value.editedAt >= value.at && value.editedAt <= 8_640_000_000_000_000) {
    packet.editedAt = value.editedAt;
  }
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
  if (message.editedAt) packet.editedAt = message.editedAt;
  if (message.ttl) packet.ttl = message.ttl;
  if (message.fwd) packet.fwd = message.fwd;
  if (message.silent) packet.silent = true;
  return packet;
}

export function makeReadPacket(upTo) {
  return { v: 1, type: 'read', upTo };
}

export function makePollVotePacket(pid, opt) {
  return { v: 1, type: 'pollvote', pid, opt };
}

// Pure poll helpers: votes never leave the pair, each side stores its own choice.
// A vote is a single index or, for multiple-choice polls, an array of indexes.
export function normalizeVote(value, max = MAX_POLL_OPTIONS) {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  const clean = [...new Set(items.filter(item => Number.isInteger(item) && item >= 0 && item < max))].sort((a, b) => a - b);
  if (!clean.length) return null;
  return Array.isArray(value) ? clean : clean[0];
}

export function mergePollVote(votes, who, opt) {
  const next = { ...(votes || {}) };
  const value = normalizeVote(opt);
  if (value == null) delete next[who]; else next[who] = value;
  return next;
}

export function votesOf(votes, who) {
  const value = votes?.[who];
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function hasVoted(votes, who, index) {
  return votesOf(votes, who).includes(index);
}

export function pollTally(att) {
  const tally = att.opts.map(() => 0);
  for (const who of ['mine', 'theirs']) {
    for (const opt of votesOf(att.votes, who)) {
      if (opt >= 0 && opt < tally.length) tally[opt] += 1;
    }
  }
  return tally;
}

// 2.5.0 control packets. Older versions ignore unknown types after validation,
// so mixed-version chats keep exchanging plain messages.
export function makeEditPacket(id, text, editedAt) {
  return { v: 1, type: 'edit', id, text: String(text).slice(0, MAX_TEXT), editedAt };
}

export function makeDeletePacket(ids) {
  return { v: 1, type: 'delete', ids: ids.slice(0, 20) };
}

export function makePinPacket(id, pinned) {
  return { v: 1, type: 'pin', id, pinned: Boolean(pinned) };
}

export function makeReactPacket(id, key, on) {
  return { v: 1, type: 'react', id, key, on: Boolean(on) };
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
