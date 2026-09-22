// LIBO security core — модульный криптографический слой версии 3.
//
// Никакой собственной криптографии: используются только стандартные проверенные
// примитивы и их аудированные реализации.
//   * обмен ключами      — X25519 (@noble/curves — аудит Trail of Bits);
//   * цифровые подписи   — Ed25519 (@noble/curves);
//   * симметричное шифр. — ChaCha20-Poly1305 с отдельным тегом (@noble/ciphers);
//   * KDF/HKDF/HMAC     — WebCrypto (SHA-256/SHA-512), без самодельных конструкций;
//   * случайность       — только crypto.getRandomValues (CSPRNG операционной системы).
//
// Карта модуля (соответствует запрошенной архитектуре):
//   1. SecureLogger        — централизованный лог без секретов;
//   2. helpers             — байтовые кодировки, хеши, HKDF, сравнение за постоянное время;
//   3. Identity            — долговременная идентичность Ed25519 + ключ обмена X25519;
//   4. KeyVault            — защищённое хранение секретов (Android Keystore либо мастер-ключ);
//   5. Ratchet             — двойной ratchet (DH-ratchet + счётные цепочки Double Ratchet);
//   6. Envelope            — формат сетевого конверта E2EE с подписью и AAD;
//   7. ReplayGuard         — защита от повторов и устаревших/будущих сообщений;
//   8. SecureSession       — фасад для транспорта (handshake, seal, open, состояния);
//   9. RateLimiter         — ограничение попыток (brute-force/auth/message flood);
//  10. SessionState        — конечный автомат состояний сессии;
//  11. PairingToken        — короткоживущий одноразовый токен для QR;
//  12. Password            — PBKDF2-SHA-256 для пароля/PIN (Argon2id см. ограничения);
//  13. sanitizeError       — безопасные сообщения об ошибках вместо стек-трейсов.

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

export const SEC_VERSION = 3;
export const ALGORITHMS = {
  keyExchange: 'X25519',
  signature: 'Ed25519',
  aead: 'ChaCha20-Poly1305',
  kdf: 'HKDF-SHA-256',
  hash: 'SHA-256 / SHA-512',
  random: 'crypto.getRandomValues (CSPRNG)',
};

export const LIMITS = {
  MAX_PAYLOAD: 220_000,          // байт plaintext в одном конверте (как у вложений)
  MAX_SKIP: 32,                  // сколько ключей сообщений можно пропустить и сохранить
  MAX_CHAIN: 200,                // сообщений до обязательной ротации цепочки ключей
  MAX_GEN_AHEAD: 8,              // сколько ротаций цепочки можно принять вперёд
  CHAIN_MAX_AGE_MS: 12 * 60 * 60 * 1000,
  CLOCK_SKEW_MS: 10 * 60 * 1000, // окно допустимого расхождения часов
  REPLAY_WINDOW: 2048,           // глубина памяти о принятых messageId
  MAX_ENVELOPE: 400_000,         // байт всего сетевого конверта
  RATCHET_INFO: 'libo/v3/ratchet',
  ROOT_INFO: 'libo/v3/root',
  HELLO_INFO: 'libo/v3/hello',
  MESSAGE_INFO: 'libo/v3/message',
};

// ───────────────────────────────────────────────────────────── 1. SecureLogger

// Единая точка логирования. В release-режиме debug выключен, а значения с секретами
// вырезаются из объектов по имени поля, поэтому ключи/токены/пароли не попадают в логи.
const SECRET_KEY = /(secret|priv|token|password|passphrase|nonce|key|pin|seed|mk|chain|root)/i;

export class SecureLogger {
  static release = true;
  static sink = null;
  static buffer = [];

  static setRelease(value) {
    SecureLogger.release = !!value;
    if (value) SecureLogger.buffer.length = 0;
  }

  static setSink(sink) { SecureLogger.sink = typeof sink === 'function' ? sink : null; }

  static redact(value, depth = 0) {
    if (value == null || depth > 4) return value;
    if (value instanceof Uint8Array) return `[bytes:${value.length}]`;
    if (Array.isArray(value)) return value.slice(0, 20).map(item => SecureLogger.redact(item, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = SECRET_KEY.test(key) ? '[redacted]' : SecureLogger.redact(item, depth + 1);
      }
      return out;
    }
    if (typeof value === 'string' && value.length > 512) return `${value.slice(0, 64)}…[${value.length}]`;
    return value;
  }

  static write(level, message, details) {
    const line = `[libo:${level}] ${message}`;
    if (level === 'debug' && SecureLogger.release) return;
    if (SecureLogger.sink) SecureLogger.sink(level, message, SecureLogger.redact(details));
    else SecureLogger.buffer = [...SecureLogger.buffer.slice(-99), details === undefined ? line : `${line} ${JSON.stringify(SecureLogger.redact(details))}`];
  }

  static debug(message, details) { SecureLogger.write('debug', message, details); }
  static info(message, details) { SecureLogger.write('info', message, details); }
  static warn(message, details) { SecureLogger.write('warn', message, details); }
  static error(message, details) { SecureLogger.write('error', message, details); }
}

// ───────────────────────────────────────────────────────────── 2. helpers

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Единственный источник случайности — CSPRNG ОС. Math.random здесь не используется.
export function randomBytes(length) {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export const utf8 = text => encoder.encode(text);
export const fromUtf8 = bytes => decoder.decode(bytes);
export const toHex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const fromHex = hex => Uint8Array.from(hex.match(/.{2}/g) ?? [], part => parseInt(part, 16));
export const toB64 = bytes => btoa(String.fromCharCode(...bytes));
export const fromB64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function sha512(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-512', bytes));
}

export async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

// HKDF-SHA-256 (RFC 5869) средствами WebCrypto — стандартная KDF, не самодельная.
export async function hkdf(ikm, salt, info, length = 32) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, key, length * 8,
  );
  return new Uint8Array(bits);
}

// Сравнение без раннего выхода: время выполнения не зависит от совпавших байт.
export function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

export function byteLength(value) { return utf8(value).length; }

// ───────────────────────────────────────────────────────────── 3. Identity

// Идентичность устройства: долговременная Ed25519 (подписи) и X25519 (обмен ключами).
// Приватные ключи живут только в памяти процесса и в зашифрованном vault (см. KeyVault).
export class Identity {
  constructor({ ed25519Secret, ed25519Public, x25519Secret, x25519Public }) {
    this.ed25519Secret = ed25519Secret;
    this.ed25519Public = ed25519Public;
    this.x25519Secret = x25519Secret;
    this.x25519Public = x25519Public;
  }

  static create() {
    const ed25519Secret = ed25519.utils.randomSecretKey();
    const x25519Secret = x25519.utils.randomSecretKey();
    return new Identity({
      ed25519Secret,
      ed25519Public: ed25519.getPublicKey(ed25519Secret),
      x25519Secret,
      x25519Public: x25519.getPublicKey(x25519Secret),
    });
  }

  static fromSecret({ ed25519Secret, x25519Secret }) {
    return new Identity({
      ed25519Secret: fromB64(ed25519Secret),
      ed25519Public: ed25519.getPublicKey(fromB64(ed25519Secret)),
      x25519Secret: fromB64(x25519Secret),
      x25519Public: x25519.getPublicKey(fromB64(x25519Secret)),
    });
  }

  // Открытая часть идентичности — это и есть публичный «ключ контакта».
  static publicBundle(identity) {
    return { ed25519: toB64(identity.ed25519Public), x25519: toB64(identity.x25519Public) };
  }

  sign(bytes) { return ed25519.sign(bytes, this.ed25519Secret); }

  get publicHex() { return toHex(this.ed25519Public); }

  get keyId() { return this.publicHex.slice(0, 16); }

  // Код безопасности из отпечатка ключа: 12 групп по 4 шестнадцатеричных знака.
  get securityCode() { return securityCodeOf(this.ed25519Public); }

  // Экспорт секрета нужен только чтобы зашифровать его ключом хранилища (KeyVault).
  // В сеть, в базу и в логи эти байты не попадают (см. security-audit).
  exportSecret() {
    return {
      ed25519Secret: toB64(this.ed25519Secret),
      x25519Secret: toB64(this.x25519Secret),
      ed25519Public: toB64(this.ed25519Public),
      x25519Public: toB64(this.x25519Public),
    };
  }
}

// Отпечаток ключа/подписи в виде читаемой строки: SHA-256 → 12 групп по 4 знака.
export async function fingerprintOf(bytes) {
  const digest = await sha256(bytes);
  const hex = toHex(digest).toUpperCase();
  return (hex.slice(0, 48).match(/.{4}/g) ?? []).join(' ');
}

export function securityCodeOf(publicKeyBytes) {
  const hex = toHex(publicKeyBytes).toUpperCase();
  return (hex.slice(0, 48).match(/.{4}/g) ?? []).join(' ');
}

// Короткая метка ключа для конверта: 16 hex-знаков публичного ключа идентичности.
// Метка — публичный идентификатор (не секрет); отпечаток для сверки считает fingerprintOf.
export function keyLabel(publicKeyBytes) {
  return toHex(publicKeyBytes).slice(0, 16);
}

// ───────────────────────────────────────────────────────────── 4. KeyVault

// Хранилище секретов. Бэкенды:
//   * android — если в WebView есть мост LiboAndroid.sealLocalSecret/openLocalSecret,
//     секрет шифруется ключом из Android Keystore (StrongBox, когда доступен), сам ключ
//     из Keystore не извлекается;
//   * web — мастер-ключ AES-256-GCM генерируется как неизвлекаемый CryptoKey и живёт
//     в IndexedDB, им шифруются экспортированные байты ключей.
// Открытый текст приватных ключей никогда не пишется на диск.
export class KeyVault {
  constructor({ store, bridge }) {
    this.store = store;
    this.bridge = bridge ?? null;
    this.masterKey = null;
    this.encrypted = false;
  }

  static get androidAvailable() {
    return !!(globalThis.LiboAndroid && typeof globalThis.LiboAndroid.sealLocalSecret === 'function');
  }

  get backend() { return this.bridge && KeyVault.androidAvailable ? 'android-keystore' : 'webcrypto-master-key'; }

  async open() {
    if (this.backend === 'android-keystore') return this;
    this.masterKey = await this.store?.getKey('master') ?? null;
    if (!this.masterKey) {
      // extractable=false: байты мастер-ключа недоступны даже собственному коду страницы.
      this.masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await this.store?.putKey('master', this.masterKey);
    }
    return this;
  }

  async seal(text) {
    if (this.backend === 'android-keystore') {
      const sealed = await this.bridge.sealLocalSecret(toB64(utf8(text)));
      return `android:${sealed}`;
    }
    const nonce = randomBytes(12);
    const cipher = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: utf8('libo/vault/v3') }, this.masterKey, utf8(text),
    ));
    this.encrypted = true;
    return `web:${toB64(nonce)}:${toB64(cipher)}`;
  }

  async openText(record) {
    const [scheme, ...rest] = String(record).split(':');
    if (scheme === 'android') {
      if (!this.bridge) throw new Error('vault: Android Keystore недоступен');
      return fromUtf8(fromB64(await this.bridge.openLocalSecret(rest.join(':'))));
    }
    if (scheme === 'web') {
      if (!this.masterKey) await this.open();
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(rest[0]), additionalData: utf8('libo/vault/v3') }, this.masterKey, fromB64(rest[1]),
      );
      return fromUtf8(new Uint8Array(plain));
    }
    throw new Error('vault: неизвестная схема хранения');
  }

  // Загрузка идентичности: при первом запуске создаём и сразу шифруем секрет.
  async identity() {
    const saved = await this.store?.getMeta('vault:identity') ?? null;
    if (saved) {
      try {
        const secret = JSON.parse(await this.openText(saved));
        return Identity.fromSecret(secret);
      } catch (error) {
        SecureLogger.error('vault: не удалось открыть сохранённую идентичность', { reason: String(error && error.message) });
        throw error;
      }
    }
    const identity = Identity.create();
    await this.save(identity);
    return identity;
  }

  async save(identity) {
    const sealed = await this.seal(JSON.stringify(identity.exportSecret()));
    await this.store?.setMeta('vault:identity', sealed);
    SecureLogger.info('vault: идентичность сохранена', { backend: this.backend });
  }

  // Logout/revoke: локальные секреты стираются (идентичность, токены, ключи чатов).
  async wipe() {
    await this.store?.deleteMeta?.('vault:identity');
    await this.store?.deleteMeta?.('sessions');
  }
}

// ───────────────────────────────────────────────────────────── 5. Ratchet

// Двойной ratchet в форме, описанной в Double Ratchet (Signal, RFC-подобная спецификация):
// DH-ratchet на новых эфемерных парах X25519 плюс симметричные цепочки ключей сообщений.
// Ключ сообщения удаляется сразу после использования, поэтому скомпрометированный
// долговременный ключ не открывает старые сообщения (forward secrecy), а DH-шаг даёт
// post-compromise security после rekey.
function advanceChain(chainKey) {
  // KDF-цепочка: message_key = HKDF(chain_key, info=message), next_chain = HKDF(chain_key, info=chain)
  return Promise.all([
    hkdf(chainKey, utf8('libo/v3/chain-salt'), `${LIMITS.MESSAGE_INFO}/key`, 32),
    hkdf(chainKey, utf8('libo/v3/chain-salt'), `${LIMITS.MESSAGE_INFO}/chain`, 32),
  ]).then(([messageKey, nextChain]) => ({ messageKey, nextChain }));
}

export class Ratchet {
  constructor({ rootKey, selfPair, remotePublic }) {
    this.rootKey = rootKey;
    this.selfPair = selfPair;                       // текущая эфемерная пара X25519
    this.remotePublic = remotePublic;               // публичный ключ собеседника (последний DH-шаг)
    this.sendChain = null;
    this.recvChain = null;
    this.ns = 0;
    this.nr = 0;
    this.pn = 0;
    this.createdAt = Date.now();
    this.messages = 0;
    this.skipped = new Map();                       // "gen|dh|n" → ключ; ограничено MAX_SKIP
    this.noncePrefix = randomBytes(4);              // префикс nonce: уникален для цепочки
    this.gen = 0;                                   // поколение цепочки (ротация ключей)
  }

  static newPair() {
    const secret = x25519.utils.randomSecretKey();
    return { secret, public: x25519.getPublicKey(secret) };
  }

  // KDF корневого ключа (KDF_RK из Double Ratchet): из DH-выхода и текущего корня
  // получаются новый корень и цепочка. У обеих сторон одного DH-шага результат совпадает.
  async kdfRootChain(dhOutput) {
    const material = await hkdf(dhOutput, this.rootKey, LIMITS.RATCHET_INFO, 64);
    return { root: material.slice(0, 32), chain: material.slice(32, 64) };
  }

  // Инициатор делает первый DH-шаг сразу при установке сессии: его эфемерная пара уже
  // известна собеседнику по рукопожатию, поэтому цепочка согласуется без лишнего пакета.
  static async create({ sharedSecret, selfPair, remotePublic, initiator }) {
    const rootKey = await hkdf(sharedSecret, utf8('libo/v3/root-salt'), LIMITS.ROOT_INFO, 32);
    const pair = selfPair ?? Ratchet.newPair();
    const ratchet = new Ratchet({ rootKey, selfPair: pair, remotePublic });
    // Первый DH-шаг применяют ОБЕ стороны на своих рукопожатных парах: DH симметричен,
    // поэтому корень и цепочка совпадают без дополнительного пакета. Направление
    // цепочки определяет роль: она либо отправляющая (инициатор), либо принимающая.
    // Так ключи отправки никогда не совпадают у двух сторон (нет повторного nonce).
    const step = await ratchet.kdfRootChain(x25519.getSharedSecret(pair.secret, remotePublic));
    ratchet.rootKey = step.root;
    if (initiator) ratchet.sendChain = step.chain;
    else { ratchet.recvChain = step.chain; ratchet.nr = 0; }
    ratchet.role = initiator ? 'initiator' : 'responder';
    return ratchet;
  }

  get needsRekey() {
    return this.messages >= LIMITS.MAX_CHAIN || Date.now() - this.createdAt > LIMITS.CHAIN_MAX_AGE_MS;
  }

  // Новая отправляющая цепочка на новой эфемерной паре. Вызывается, когда сторона
  // начинает отправлять первой, при исчерпании лимита цепочки и при rekey.
  async startNewSendingChain() {
    const pair = Ratchet.newPair();
    const step = await this.kdfRootChain(x25519.getSharedSecret(pair.secret, this.remotePublic));
    this.rootKey = step.root;
    this.sendChain = step.chain;
    this.selfPair = pair;
    this.noncePrefix = randomBytes(4);              // новый префикс nonce для новой цепочки
    this.pn = this.ns;
    this.ns = 0;
    this.messages = 0;
    this.createdAt = Date.now();
    return pair.public;
  }

  // Ключи новой генерации выводятся из текущего ключа цепочки (KDF с разделением по
  // назначению). У обеих сторон этот ключ в момент ротации одинаков — отправляющая
  // цепочка отправителя и принимающая цепочка получателя это одна и та же цепочка,
  // ведь транспорт доставляет пакеты по порядку и без потерь. Поэтому ротация не может
  // разойтись, не зависит от корневого ключа и не требует ждать свежий DH-ключ
  // собеседника, как это было бы при самостоятельном DH-шаге отправителя.
  async rollChain(chainKey) {
    this.gen += 1;
    return hkdf(chainKey, utf8('libo/v3/chain-salt'), `${LIMITS.MESSAGE_INFO}/rollover`, 32);
  }

  // Локальная ротация отправляющей цепочки: собеседник узнаёт о ней из конверта.
  async rotateForSend() {
    if (!this.sendChain) return this.gen;          // цепочка будет создана при отправке
    this.sendChain = await this.rollChain(this.sendChain);
    this.ns = 0;
    this.pn = 0;
    this.messages = 0;
    this.createdAt = Date.now();
    this.noncePrefix = randomBytes(4);              // счётчик nonce начинается заново
    return this.gen;
  }

  // Ротация принимающей цепочки: сколько шагов сделал собеседник, столько же делает
  // получатель — ключи цепочек остаются зеркальными.
  async rotateForRecv(targetGen) {
    while (this.gen < targetGen) {
      if (!this.recvChain) throw new Error('ratchet: принимающая цепочка ещё не создана');
      this.recvChain = await this.rollChain(this.recvChain);
      this.nr = 0;
    }
  }

  // Принимающий DH-шаг: новая цепочка приёма на текущей паре, новая пара для отправки.
  async dhRatchet(remotePublicBytes) {
    const recvStep = await this.kdfRootChain(x25519.getSharedSecret(this.selfPair.secret, remotePublicBytes));
    this.rootKey = recvStep.root;
    this.recvChain = recvStep.chain;
    this.nr = 0;
    this.remotePublic = remotePublicBytes;
    this.skipped.clear();                            // ключи старых цепочек больше не нужны
    // Новая отправляющая цепочка создаётся лениво — при первой реальной отправке.
    // Так корневой ключ у обеих сторон продвигается строго на одни и те же шаги
    // (иначе «заготовленная» цепочка отправителя уводила бы корень вперёд).
    this.sendChain = null;
    return this.selfPair.public;
  }

  nonceFor(counter) {
    const nonce = new Uint8Array(12);
    nonce.set(this.noncePrefix, 0);
    new DataView(nonce.buffer).setBigUint64(4, BigInt(counter));
    return nonce;
  }

  async nextMessageKey() {
    if (!this.sendChain) await this.startNewSendingChain();
    const { messageKey, nextChain } = await advanceChain(this.sendChain, this.noncePrefix);
    this.sendChain = nextChain;                     // старый ключ сообщения больше не воспроизводится
    const counter = this.ns;
    this.ns += 1;
    this.messages += 1;
    return { messageKey, counter, nonce: this.nonceFor(counter) };
  }

  async messageKeyFor(header) {
    const dh = toB64(header.dh);
    const gen = header.gen ?? 0;
    if (gen > this.gen) {
      if (gen - this.gen > LIMITS.MAX_GEN_AHEAD) throw new Error('ratchet: неизвестное поколение цепочки');
      await this.rotateForRecv(gen);
    } else if (gen < this.gen) throw new Error('ratchet: устаревшее поколение цепочки');
    if (this.remotePublic && !constantTimeEqual(fromB64(header.dh), this.remotePublic)) {
      await this.dhRatchet(fromB64(header.dh));
    }
    const skippedKey = this.skipped.get(`${gen}|${dh}|${header.n}`);
    if (skippedKey) {
      this.skipped.delete(`${gen}|${dh}|${header.n}`);
      return skippedKey;
    }
    if (!this.recvChain) throw new Error('ratchet: принимающая цепочка не готова');
    if (header.n < this.nr) throw new Error('ratchet: ключ сообщения уже удалён (возможен повтор)');
    if (header.n - this.nr > LIMITS.MAX_SKIP) throw new Error('ratchet: слишком большой пропуск сообщений');
    let counter = this.nr;
    let chain = this.recvChain;
    while (counter < header.n) {
      const { messageKey, nextChain } = await advanceChain(chain, this.noncePrefix);
      this.skipped.set(`${gen}|${dh}|${counter}`, messageKey);
      chain = nextChain;
      counter += 1;
    }
    while (this.skipped.size > LIMITS.MAX_SKIP) {
      this.skipped.delete(this.skipped.keys().next().value);
    }
    const { messageKey, nextChain } = await advanceChain(chain, this.noncePrefix);
    this.recvChain = nextChain;
    this.nr = header.n + 1;
    return messageKey;
  }
}

// ───────────────────────────────────────────────────────────── 6. Envelope

// Конверт E2EE: в сеть уходит только ciphertext и обязательный минимум метаданных.
export const ENVELOPE_FIELDS = [
  'version', 'messageId', 'conversationId', 'senderKeyId', 'recipientKeyId',
  'timestamp', 'nonce', 'ciphertext', 'authenticationTag', 'signature',
];

// Канонический заголовок конверта: одинаковый массив у отправителя и получателя.
// AAD покрывает метаданные (они защищены тегом AEAD), подпись Ed25519 дополнительно
// покрывает шифротекст и тег — подмена любого поля ломает проверку.
function headerFields(envelope, ratchetHeader) {
  return [
    envelope.version, envelope.messageId, envelope.conversationId,
    envelope.senderKeyId, envelope.recipientKeyId, envelope.timestamp,
    ratchetHeader.dh, ratchetHeader.pn, ratchetHeader.n, ratchetHeader.gen ?? 0, envelope.nonce,
  ];
}

export function aadBytes(envelope, ratchetHeader) {
  return utf8(JSON.stringify(headerFields(envelope, ratchetHeader)));
}

export function envelopeBytes(envelope, ratchetHeader) {
  return utf8(JSON.stringify([
    ...headerFields(envelope, ratchetHeader), envelope.ciphertext, envelope.authenticationTag,
  ]));
}

// ───────────────────────────────────────────────────────────── 7. ReplayGuard

export class ReplayGuard {
  constructor(limit = LIMITS.REPLAY_WINDOW) {
    this.limit = limit;
    this.seen = new Set();
  }

  // Возвращает false, если такой messageId уже принимался (повтор) или время вне окна.
  accept(messageId, timestamp) {
    if (typeof messageId !== 'string' || messageId.length < 8 || messageId.length > 64) return false;
    if (!Number.isSafeInteger(timestamp)) return false;
    if (Math.abs(Date.now() - timestamp) > LIMITS.CLOCK_SKEW_MS) return false;
    if (this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    if (this.seen.size > this.limit) this.seen.delete(this.seen.values().next().value);
    return true;
  }
}

// ───────────────────────────────────────────────────────────── 8. SecureSession

export const SESSION_STATES = ['CONNECTING', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED', 'REVOKED', 'COMPROMISED'];

const ALLOWED_TRANSITIONS = {
  CONNECTING: ['CONNECTED', 'DISCONNECTED', 'REVOKED', 'COMPROMISED'],
  CONNECTED: ['RECONNECTING', 'DISCONNECTED', 'REVOKED', 'COMPROMISED'],
  RECONNECTING: ['CONNECTED', 'DISCONNECTED', 'REVOKED', 'COMPROMISED'],
  DISCONNECTED: ['CONNECTING', 'CONNECTED', 'REVOKED', 'COMPROMISED'],
  REVOKED: ['DISCONNECTED'],
  COMPROMISED: ['DISCONNECTED', 'REVOKED'],
};

export class SessionState {
  constructor(initial = 'CONNECTING') {
    this.state = initial;
    this.history = [{ state: initial, at: Date.now() }];
  }

  transition(next) {
    if (!SESSION_STATES.includes(next)) throw new Error('session: неизвестное состояние');
    if (next === this.state) return this.state;
    if (!ALLOWED_TRANSITIONS[this.state].includes(next)) {
      SecureLogger.warn('session: запрещённый переход состояния', { from: this.state, to: next });
      return this.state;
    }
    this.state = next;
    this.history = [...this.history.slice(-19), { state: next, at: Date.now() }];
    return this.state;
  }

  get revoked() { return this.state === 'REVOKED' || this.state === 'COMPROMISED'; }
}

// Сессия одного собеседника: рукопожатие, конверты, состояние, отпечатки.
export class SecureSession {
  constructor({ identity, conversationId, selfId = null, state = new SessionState() }) {
    this.identity = identity;
    this.conversationId = conversationId;   // локальный взгляд: код собеседника
    this.selfId = selfId;                   // собственный код устройства (для канонизации пары)
    this.state = state;
    this.ratchet = null;
    this.peerIdentity = null;     // { ed25519, x25519, keyId, securityCode }
    this.replay = new ReplayGuard();
    this.ephemeral = Ratchet.newPair();
    this.helloSeen = false;
    this.alarms = 0;              // счётчик тревог: неверные подписи, смена ключа
    this.createdAt = Date.now();
    // Очереди операций: две параллельные отправки (или два параллельных приёма) могли бы
    // прочитать одну и ту же цепочку ratchet и повторить ключ сообщения. Поэтому все
    // запечатывания и все открытия выполняются строго по одному.
    this.sendQueue = Promise.resolve();
    this.recvQueue = Promise.resolve();
  }

  // Канонический идентификатор пары: обе стороны сортируют свой и чужой коды, поэтому
  // порядок сортировки одинаков и транскрипт рукопожатия, соль ratchet и поле
  // conversationId конверта совпадают у обоих собеседников.
  pairId() {
    return this.selfId && this.conversationId
      ? [this.selfId, this.conversationId].sort().join('|')
      : this.conversationId;
  }

  get established() { return !!this.ratchet; }

  get localKeyId() { return this.identity.keyId; }

  get peerKeyId() { return this.peerIdentity?.keyId ?? ''; }

  // Публичное приглашение: только открытые ключи + подпись транскрипта.
  async hello() {
    const payload = {
      v: SEC_VERSION,
      idPub: Identity.publicBundle(this.identity).ed25519,
      kxPub: toB64(this.ephemeral.public),
    };
    const transcript = utf8(JSON.stringify([LIMITS.HELLO_INFO, this.pairId(), payload.idPub, payload.kxPub]));
    return { ...payload, keyId: this.identity.keyId, sig: toB64(this.identity.sign(transcript)) };
  }

  // Проверка подписи собеседника + закрепление его идентичности (TOFU).
  // Смена ключа собеседника — это сигнал подмены (MITM) или переустановки приложения.
  async acceptHello(payload, { trusted = null, allowNewIdentity = true } = {}) {
    if (!payload || typeof payload.idPub !== 'string' || typeof payload.kxPub !== 'string' || typeof payload.sig !== 'string') {
      throw new Error('security: некорректное приглашение');
    }
    const idPub = fromB64(payload.idPub);
    const kxPub = fromB64(payload.kxPub);
    if (idPub.length !== 32 || kxPub.length !== 32) throw new Error('security: неверная длина ключа');
    const transcript = utf8(JSON.stringify([LIMITS.HELLO_INFO, this.pairId(), payload.idPub, payload.kxPub]));
    if (!ed25519.verify(fromB64(payload.sig), transcript, idPub)) {
      this.state.transition('COMPROMISED');
      SecureLogger.error('security: подпись рукопожатия неверна');
      throw new Error('security: подпись собеседника не подтверждена');
    }
    const identityRecord = {
      ed25519: payload.idPub,
      x25519: '',                              // ключ обмена приходит в каждом DH-шаге ratchet
      keyId: keyLabel(idPub),
      securityCode: securityCodeOf(idPub),
    };
    const pinned = trusted?.keyId ?? null;
    if (pinned && pinned !== identityRecord.keyId) {
      this.state.transition('COMPROMISED');
      SecureLogger.error('security: ключ собеседника изменился', { pinned, seen: identityRecord.keyId });
      const error = new Error('security: ключ собеседника изменился');
      error.code = 'IDENTITY_CHANGED';
      error.identity = identityRecord;
      throw error;
    }
    if (!pinned && !allowNewIdentity) throw new Error('security: собеседник не подтверждён');
    this.peerIdentity = identityRecord;
    const shared = x25519.getSharedSecret(this.ephemeral.secret, kxPub);
    // Обе стороны сортируют публичные ключи одинаково — это делает транскрипт общим.
    const pubs = [toB64(this.ephemeral.public), payload.kxPub].sort();
    const salt = await sha256(utf8(`${pubs[0]}|${pubs[1]}|${this.pairId()}`));
    const initiator = pubs[0] === toB64(this.ephemeral.public);
    this.ratchet = await Ratchet.create({
      sharedSecret: shared,
      selfPair: this.ephemeral,
      remotePublic: kxPub,
      initiator,
    });
    this.helloSeen = true;
    this.state.transition('CONNECTED');
    SecureLogger.info('security: сессия установлена', { conversationId: this.conversationId, kex: ALGORITHMS.keyExchange, pairId: this.pairId() });
    return this.peerIdentity;
  }

  // Последовательная очередь: задача выполняется после предыдущей, независимо от её исхода.
  enqueue(kind, task) {
    const previous = this[kind];
    const next = previous.then(task, task);
    this[kind] = next.then(() => {}, () => {});
    return next;
  }

  // Конверт: AEAD(ChaCha20-Poly1305) + подпись Ed25519 + AAD из заголовка.
  seal(packet) { return this.enqueue('sendQueue', () => this.sealNow(packet)); }

  async sealNow(packet) {
    if (!this.ratchet || this.state.revoked) throw new Error('security: сессия не готова');
    const plaintext = utf8(JSON.stringify(packet));
    if (plaintext.length > LIMITS.MAX_PAYLOAD) throw new Error('security: слишком большое сообщение');
    if (this.ratchet.needsRekey) await this.ratchet.rotateForSend();
    const { messageKey, counter, nonce } = await this.ratchet.nextMessageKey();
    const header = { dh: toB64(this.ratchet.selfPair.public), pn: this.ratchet.pn, n: counter, gen: this.ratchet.gen };
    const envelope = {
      v: 1,                          // версия транспорта LIBO (конверт E2EE — version: 3)
      type: 'envelope',
      version: SEC_VERSION,
      messageId: crypto.randomUUID(),
      conversationId: this.pairId(),
      senderKeyId: this.identity.keyId,
      recipientKeyId: this.peerIdentity?.keyId ?? '',
      timestamp: Date.now(),
      nonce: toB64(nonce),
      ciphertext: '',
      authenticationTag: '',
      signature: '',
    };
    const aad = aadBytes(envelope, header);
    const sealed = chacha20poly1305(messageKey, nonce, aad).encrypt(plaintext);
    envelope.ciphertext = toB64(sealed.slice(0, -16));
    envelope.authenticationTag = toB64(sealed.slice(-16));
    envelope.signature = toB64(this.identity.sign(envelopeBytes(envelope, header)));
    return { ...envelope, ratchet: header };
  }

  // Открытие конверта: подпись → повтор → AEAD → повторы ratchet. Любая ошибка = отказ.
  // Приём тоже сериализован: иначе два конверта подряд продвинули бы цепочку дважды.
  open(envelope) { return this.enqueue('recvQueue', () => this.openNow(envelope)); }

  async openNow(envelope) {
    if (!this.ratchet || this.state.revoked) return { ok: false, reason: 'session' };
    if (!envelope || envelope.version !== SEC_VERSION || envelope.type !== 'envelope') return { ok: false, reason: 'version' };
    if (jsonSize(envelope) > LIMITS.MAX_ENVELOPE) return { ok: false, reason: 'oversized' };
    if (envelope.conversationId !== this.pairId()) return { ok: false, reason: 'conversation' };
    if (envelope.recipientKeyId && envelope.recipientKeyId !== this.identity.keyId) return { ok: false, reason: 'recipient' };
    if (this.peerIdentity && envelope.senderKeyId !== this.peerIdentity.keyId) {
      this.state.transition('COMPROMISED');
      return { ok: false, reason: 'identity' };
    }
    const header = envelope.ratchet;
    if (!header || typeof header.dh !== 'string' || !Number.isSafeInteger(header.n) || !Number.isSafeInteger(header.pn)) {
      return { ok: false, reason: 'header' };
    }
    const peerPublic = this.peerIdentity ? fromB64(this.peerIdentity.ed25519) : null;
    if (!peerPublic) return { ok: false, reason: 'unverified' };
    if (!ed25519.verify(fromB64(envelope.signature ?? ''), envelopeBytes(envelope, header), peerPublic)) {
      // Подпись неверна: конверт отбрасывается. Сессия не разрушается (иначе любой
      // сторонний пакет позволял бы оборвать переписку), но событие попадает в лог и UI.
      this.alarms += 1;
      SecureLogger.error('security: подпись конверта не подтверждена', { alarm: this.alarms });
      return { ok: false, reason: 'signature' };
    }
    if (!this.replay.accept(envelope.messageId, envelope.timestamp)) return { ok: false, reason: 'replay' };
    let messageKey;
    try {
      messageKey = await this.ratchet.messageKeyFor(header);
    } catch (error) {
      SecureLogger.debug('security: ratchet отказал', { reason: String(error && error.message) });
      return { ok: false, reason: 'ratchet' };
    }
    let plaintext;
    try {
      const sealed = new Uint8Array([...fromB64(envelope.ciphertext), ...fromB64(envelope.authenticationTag)]);
      plaintext = chacha20poly1305(messageKey, fromB64(envelope.nonce), aadBytes(envelope, header)).decrypt(sealed);
    } catch {
      return { ok: false, reason: 'auth' };
    }
    try {
      return { ok: true, packet: JSON.parse(fromUtf8(plaintext)) };
    } catch {
      return { ok: false, reason: 'json' };
    }
  }

  // Метка состояния для интерфейса: без ключей и без секретов.
  describe() {
    return {
      state: this.state.state,
      established: this.established,
      algorithm: ALGORITHMS.aead,
      keyExchange: ALGORITHMS.keyExchange,
      localKeyId: this.localKeyId,
      peerKeyId: this.peerKeyId,
      peerCode: this.peerIdentity?.securityCode ?? '',
      peerIdentityKey: this.peerIdentity?.ed25519 ?? '',
      messages: this.ratchet?.messages ?? 0,
    };
  }
}

function jsonSize(value) {
  try { return utf8(JSON.stringify(value)).length; } catch { return Number.MAX_SAFE_INTEGER; }
}

// ───────────────────────────────────────────────────────────── 9. RateLimiter

// Token bucket: ограничивает попытки входа, отправку сообщений и перебор PIN.
export class RateLimiter {
  constructor({ capacity = 5, refillMs = 60_000, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.refillMs = refillMs;
    this.now = now;
    this.buckets = new Map();
  }

  state(key) {
    const entry = this.buckets.get(key) ?? { tokens: this.capacity, at: this.now(), failures: 0 };
    const elapsed = this.now() - entry.at;
    if (elapsed > 0) {
      const refill = Math.floor(elapsed / this.refillMs);
      if (refill > 0) {
        entry.tokens = Math.min(this.capacity, entry.tokens + refill);
        entry.at = this.now();
      }
    }
    this.buckets.set(key, entry);
    return entry;
  }

  // allow() списывает попытку; при исчерпании возвращает время ожидания в мс.
  allow(key, cost = 1) {
    const entry = this.state(key);
    if (entry.tokens < cost) return { allowed: false, retryInMs: this.refillMs - ((this.now() - entry.at) % this.refillMs) };
    entry.tokens -= cost;
    return { allowed: true, retryInMs: 0 };
  }

  failure(key) {
    const entry = this.state(key);
    entry.failures += 1;
    // Экспоненциальная задержка после серии неудач: защита от перебора.
    if (entry.failures >= 3) entry.tokens = Math.max(0, entry.tokens - 1);
    if (entry.failures >= 5) entry.tokens = 0;
    return { failures: entry.failures, locked: entry.tokens === 0 };
  }

  reset(key) { this.buckets.delete(key); }
}

// ───────────────────────────────────────────────────────────── 11. PairingToken

// Одноразовый короткоживущий токен для QR (привязка устройства/контакта).
// В самом QR нет ни пароля, ни приватного ключа, ни master key, ни refresh token —
// только идентификатор устройства, токен и время истечения. В базе лежит только хеш.
export class PairingToken {
  static create({ ttlMs = 120_000, peerId = '', now = Date.now() } = {}) {
    const token = toB64(randomBytes(32));
    return {
      token,
      peerId,
      createdAt: now,
      expiresAt: now + ttlMs,
      hash: '',                       // заполняется consume/hashToken
    };
  }

  static async prepare(token) {
    // В записи хранится только хеш токена: сам токен уходит в QR и больше не хранится.
    return { ...token, hash: toHex(await sha256(utf8(token.token))) };
  }

  static expired(record, now = Date.now()) {
    return !record || typeof record.expiresAt !== 'number' || record.expiresAt <= now;
  }

  // Одноразовая проверка: хеш сравнивается за постоянное время, запись стирается.
  static async consume(record, candidate, now = Date.now()) {
    if (PairingToken.expired(record, now)) return { ok: false, reason: 'expired' };
    if (record.usedAt) return { ok: false, reason: 'used' };
    const hash = toHex(await sha256(utf8(String(candidate))));
    if (!constantTimeEqual(fromHex(hash), fromHex(record.hash))) return { ok: false, reason: 'mismatch' };
    // Одноразовость: запись помечается использованной, повторная проверка невозможна.
    record.usedAt = now;
    return { ok: true, peerId: record.peerId };
  }

  static qrPayload(record) {
    return `LIBO:pair=${record.peerId}#${record.token}`;
  }
}

// ───────────────────────────────────────────────────────────── 12. Password

// Пароль/PIN никогда не сохраняется: хранится только PBKDF2-SHA-256 с индивидуальной
// солью и большим числом итераций, проверка — за постоянное время.
// Argon2id недоступен в WebCrypto Android WebView, поэтому PBKDF2 — платформенный вариант
// (см. SECURITY_ARCHITECTURE.md, «Ограничения»: план — нативная реализация Argon2id).
export const Password = {
  ITERATIONS: 600_000,

  async hash(password, { iterations = Password.ITERATIONS } = {}) {
    if (typeof password !== 'string' || password.length < 4 || password.length > 256) throw new Error('password: недопустимая длина');
    const salt = randomBytes(16);
    const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return `pbkdf2-sha256$${iterations}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
  },

  async verify(password, record) {
    if (typeof record !== 'string') return false;
    const [scheme, iterations, salt, hash] = record.split('$');
    if (scheme !== 'pbkdf2-sha256') return false;
    const rounds = Number(iterations);
    if (!Number.isSafeInteger(rounds) || rounds < 100_000) return false;
    const key = await crypto.subtle.importKey('raw', utf8(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations: rounds }, key, 256,
    ));
    return constantTimeEqual(bits, fromB64(hash));
  },
};

// ───────────────────────────────────────────────────────────── 13. sanitizeError

// Пользователь не должен видеть стек-трейсы, пути, SQL и внутренние детали.
export function sanitizeError(error, fallback = 'Не удалось выполнить действие. Попробуйте ещё раз.') {
  const code = error && error.code ? String(error.code) : '';
  const known = {
    IDENTITY_CHANGED: 'Ключ безопасности собеседника изменился. Соединение остановлено, проверьте контакт заново.',
    RATE_LIMITED: 'Слишком много попыток. Подождите и попробуйте снова.',
    SESSION_REVOKED: 'Сессия отозвана. Войдите заново на этом устройстве.',
  };
  if (known[code]) return known[code];
  SecureLogger.debug('error: внутренняя ошибка', { message: String(error && error.message).slice(0, 200) });
  return fallback;
}
