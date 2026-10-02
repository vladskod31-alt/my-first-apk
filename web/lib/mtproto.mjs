// LIBO MT layer: an MTProto 2.0-inspired application envelope on top of the DTLS
// channel. Telegram's MTProto itself is a client-server protocol and cannot run in a
// serverless P2P app, so LIBO borrows its proven ideas instead:
//   * an ephemeral ECDH handshake produces a 256-bit auth_key (like MTProto's DH key);
//   * every message carries msg_key = SHA-256(auth_key part || plaintext)[8:24];
//   * the cipher key/iv are derived from msg_key and auth_key (MTProto 2.0 KDF shape);
//   * msg_id is a strictly increasing time-based counter; stale or repeated msg_id
//     values are rejected (replay protection), like MTProto's message_id rules.
// The cipher is AES-256-GCM with the msg_key and msg_id bound as additional data:
// WebCrypto has no AES-IGE, and GCM gives authenticated encryption in one primitive.
// Peers on older versions never send mt-hello, so the channel falls back to DTLS only.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

async function sha256(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
}

export class MtSession {
  constructor() {
    this.pair = null;
    this.authKey = null;
    this.lastMsgId = 0;
    this.counter = 0;
    this.fingerprint = '';
  }

  static async create() {
    const session = new MtSession();
    session.pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    session.pubB64 = await session.publicKey();
    return session;
  }

  get ready() { return !!this.authKey; }

  async publicKey() {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', this.pair.publicKey));
    return b64(raw);
  }

  async accept(remoteB64) {
    if (this.authKey) return;
    await this.rekey(remoteB64);
  }

  // A peer reload or a fresh link announces a new public key. Keeping our own ECDH pair
  // and swapping only the remote half derives exactly the key the peer computed from
  // our (unchanged) public key, so one hello round converges both sides.
  async rekey(remoteB64) {
    this.remotePub = remoteB64;
    const raw = unb64(remoteB64);
    if (raw.length !== 65) throw new Error('mt: bad public key');
    const remote = await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: remote }, this.pair.privateKey, 256));
    this.authKey = await sha256(shared, encoder.encode('libo-mt-v1'));
    this.lastMsgId = 0;
    const fingerprint = await sha256(this.authKey);
    this.fingerprint = [...fingerprint.slice(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  nextMsgId() {
    // MTProto-shaped: seconds in the high bits, a per-millisecond counter below.
    const base = Math.floor(Date.now() / 1000) * 4_194_304;
    this.counter = (this.counter + 1) % 4_194_304;
    const id = base + this.counter;
    if (id <= this.lastMsgId) this.lastMsgId += 1;
    else this.lastMsgId = id;
    return this.lastMsgId;
  }

  async kdf(msgKey) {
    const key = await sha256(msgKey, this.authKey.slice(0, 32));
    const ivSource = await sha256(this.authKey.slice(8, 40), msgKey);
    return { key: key.slice(0, 32), iv: ivSource.slice(0, 12) };
  }

  async seal(packet) {
    if (!this.authKey) throw new Error('mt: handshake not finished');
    const plain = encoder.encode(JSON.stringify(packet));
    const digest = await sha256(this.authKey.slice(0, 16), plain);
    const msgKey = digest.slice(8, 24);
    const msgId = this.nextMsgId();
    const { key, iv } = await this.kdf(msgKey);
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
    const aad = new Uint8Array(24);
    aad.set(msgKey, 0);
    new DataView(aad.buffer).setBigUint64(16, BigInt(msgId));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, cryptoKey, plain));
    return { v: 1, type: 'mt', msg_id: msgId, mk: b64(msgKey), iv: b64(iv), ct: b64(sealed) };
  }

  async open(envelope) {
    if (!this.authKey) return null;
    const msgKey = unb64(envelope.mk);
    const iv = unb64(envelope.iv);
    const sealed = unb64(envelope.ct);
    if (msgKey.length !== 16 || iv.length !== 12) return null;
    const msgId = envelope.msg_id;
    if (!Number.isSafeInteger(msgId) || msgId <= this.lastMsgId) return null;   // replay
    const now = Math.floor(Date.now() / 1000) * 4_194_304;
    if (Math.abs(msgId - now) > 600 * 4_194_304) return null;                   // stale or future
    const { key } = await this.kdf(msgKey);
    const aad = new Uint8Array(24);
    aad.set(msgKey, 0);
    new DataView(aad.buffer).setBigUint64(16, BigInt(msgId));
    let plain;
    try {
      const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
      plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, cryptoKey, sealed));
    } catch { return null; }                                                     // tampered
    const digest = await sha256(this.authKey.slice(0, 16), plain);
    const check = digest.slice(8, 24);
    for (let i = 0; i < 16; i++) if (check[i] !== msgKey[i]) return null;        // msg_key mismatch
    this.lastMsgId = msgId;
    try { return JSON.parse(decoder.decode(plain)); } catch { return null; }
  }
}
