// LIBO E2EE layer (2.8.2).
//
// Primitives come from the audited @noble libraries; nothing here is home-grown
// cryptography. The construction follows the public Signal specifications:
//   * identity: Ed25519 signing key + long-term X25519 key (both public halves are
//     signed together and pinned per contact: an identity change is always visible);
//   * handshake: a 3-DH agreement (IK/EK on both sides, X3DH shape without a server
//     pre-key store because both devices are online for a P2P session);
//   * session: Double Ratchet (DH ratchet on X25519, symmetric KDF chains on
//     HMAC-SHA-256, HKDF-SHA-256 for root/message keys) — forward secrecy and
//     post-compromise security, bounded out-of-order tolerance, no key reuse;
//   * message encryption: ChaCha20-Poly1305 (IETF) with the ratchet header and the
//     pair's identity keys bound as associated data. Each message key is used exactly
//     once, so the derived nonce can never repeat under the same key.
// Randomness only comes from the OS CSPRNG (crypto.getRandomValues via noble).

import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const E2EE_VERSION = 1;
const MAX_SKIP = 200;          // out-of-order tolerance inside one chain
const MAX_SKIPPED_KEYS = 600;  // total cached skipped message keys per session
const HELLO_TTL_MS = 10 * 60_000;
const ZERO32 = new Uint8Array(32);

export const b64 = bytes => btoa(String.fromCharCode(...bytes));
export const unb64 = (text, length = null) => {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('e2ee: bad base64');
  const bytes = Uint8Array.from(atob(text), char => char.charCodeAt(0));
  if (length != null && bytes.length !== length) throw new Error('e2ee: bad length');
  return bytes;
};
export const wipe = (...arrays) => { for (const array of arrays) if (array instanceof Uint8Array) array.fill(0); };

function equalBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------- identity ----

export function generateIdentity() {
  const sign = ed25519.keygen();
  const dhSecret = x25519.utils.randomSecretKey();
  return {
    v: E2EE_VERSION,
    createdAt: Date.now(),
    signSk: sign.secretKey, signPk: sign.publicKey,
    dhSk: dhSecret, dhPk: x25519.getPublicKey(dhSecret),
  };
}

export function serializeIdentity(identity) {
  return { v: identity.v, createdAt: identity.createdAt, signSk: b64(identity.signSk), signPk: b64(identity.signPk), dhSk: b64(identity.dhSk), dhPk: b64(identity.dhPk) };
}

export function deserializeIdentity(value) {
  if (!value || value.v !== E2EE_VERSION) return null;
  try {
    const identity = { v: value.v, createdAt: value.createdAt, signSk: unb64(value.signSk, 32), signPk: unb64(value.signPk, 32), dhSk: unb64(value.dhSk, 32), dhPk: unb64(value.dhPk, 32) };
    if (!equalBytes(ed25519.getPublicKey(identity.signSk), identity.signPk)) return null;
    if (!equalBytes(x25519.getPublicKey(identity.dhSk), identity.dhPk)) return null;
    return identity;
  } catch { return null; }
}

export function wipeIdentity(identity) { if (identity) wipe(identity.signSk, identity.dhSk); }

export function publicIdentity(identity) { return { signPk: b64(identity.signPk), dhPk: b64(identity.dhPk) }; }

// Human-readable fingerprint of one identity key: 8 groups of 4 hex characters.
export function fingerprint(signPkB64) {
  const digest = sha256(concatBytes(utf8ToBytes('libo-e2ee-fp-v1'), unb64(signPkB64, 32)));
  return [...digest.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('').match(/.{4}/g).join(' ');
}

// Safety number for a pair (Signal-style 60 digits): the same on both devices, so it
// can be compared aloud or by scanning the other person's QR.
export function safetyNumber(idA, signA, idB, signB) {
  const [first, second] = [[idA, signA], [idB, signB]].sort((left, right) => left[0] < right[0] ? -1 : 1);
  const half = (id, key) => {
    let digest = concatBytes(utf8ToBytes(`libo-safety-v1|${id}`), unb64(key, 32));
    for (let i = 0; i < 5200; i++) digest = sha256(concatBytes(digest, unb64(key, 32)));
    let out = '';
    for (let i = 0; i < 6; i++) {
      const chunk = (digest[i * 5] * 2 ** 32 + digest[i * 5 + 1] * 2 ** 24 + digest[i * 5 + 2] * 65536 + digest[i * 5 + 3] * 256 + digest[i * 5 + 4]) % 100000;
      out += String(chunk).padStart(5, '0');
    }
    return out;
  };
  return (half(first[0], first[1]) + half(second[0], second[1])).match(/.{5}/g).join(' ');
}

// ---------------------------------------------------------- pairing tokens ----

// A one-time pairing token travels inside the QR code next to the public key. It
// proves that the connecting device saw this exact invitation; it grants nothing else.
export function makePairToken() {
  return { token: b64(randomBytes(16)).replace(/[+/=]/g, char => ({ '+': '-', '/': '_', '=': '' }[char])), expiresAt: Date.now() + HELLO_TTL_MS };
}

export function isValidPairToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{20,24}$/.test(value); }

// Invite text: LIBO:<code>#k=<ed25519 pk>&t=<token>. Public data only.
export function formatInvite(peerId, identity, token = null) {
  const params = new URLSearchParams();
  params.set('k', b64(identity.signPk));
  if (token) params.set('t', token);
  return `LIBO:${peerId}#${params.toString()}`;
}

export function parseInvite(text, normalizePeerCode) {
  if (typeof text !== 'string' || text.length > 512) return null;
  const [head, fragment = ''] = text.trim().split('#', 2);
  const id = normalizePeerCode(head);
  if (!id) return null;
  const result = { id, signPk: null, token: null };
  if (fragment) {
    const params = new URLSearchParams(fragment);
    const key = params.get('k');
    const token = params.get('t');
    if (key) { try { unb64(key, 32); result.signPk = key; } catch { return null; } }
    if (token) { if (!isValidPairToken(token)) return null; result.token = token; }
  }
  return result;
}

// --------------------------------------------------------------- handshake ----

function helloTranscript(fromId, toId, dhPk, ekPk) {
  return sha256(concatBytes(utf8ToBytes(`libo-e2ee-hello-v1|${fromId}|${toId}|`), dhPk, ekPk));
}

// Returns the packet to send plus the ephemeral secret to keep until the peer answers.
export function makeHello(identity, myId, peerId, pairToken = null) {
  const ekSk = x25519.utils.randomSecretKey();
  const ekPk = x25519.getPublicKey(ekSk);
  const sig = ed25519.sign(helloTranscript(myId, peerId, identity.dhPk, ekPk), identity.signSk);
  const packet = { v: 1, type: 'e2-hello', ver: E2EE_VERSION, ik: b64(identity.dhPk), sk: b64(identity.signPk), ek: b64(ekPk), sig: b64(sig) };
  if (pairToken) packet.tok = pairToken;
  return { packet, ephemeral: { sk: ekSk, pk: ekPk, at: Date.now() } };
}

export function verifyHello(packet, fromId, toId) {
  try {
    const ik = unb64(packet.ik, 32);
    const sk = unb64(packet.sk, 32);
    const ek = unb64(packet.ek, 32);
    const sig = unb64(packet.sig, 64);
    if (!ed25519.verify(sig, helloTranscript(fromId, toId, ik, ek), sk)) return null;
    return { ik, sk, ek };
  } catch { return null; }
}

// ---------------------------------------------------------- double ratchet ----

function kdfRoot(rootKey, dhOut) {
  const out = hkdf(sha256, dhOut, rootKey, utf8ToBytes('libo-e2ee-rk-v1'), 64);
  return { rk: out.slice(0, 32), ck: out.slice(32, 64) };
}
function kdfChain(ck) {
  return { mk: hmac(sha256, ck, Uint8Array.of(1)), ck: hmac(sha256, ck, Uint8Array.of(2)) };
}
function messageCipher(mk, aad) {
  const out = hkdf(sha256, mk, ZERO32, utf8ToBytes('libo-e2ee-msg-v1'), 44);
  return chacha20poly1305(out.slice(0, 32), out.slice(32, 44), aad);
}
function packHeader(dhPk, pn, n) {
  const header = new Uint8Array(40);
  header.set(dhPk, 0);
  new DataView(header.buffer).setUint32(32, pn);
  new DataView(header.buffer).setUint32(36, n);
  return header;
}
function unpackHeader(bytes) {
  if (bytes.length !== 40) throw new Error('e2ee: bad header');
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { dh: bytes.slice(0, 32), pn: view.getUint32(32), n: view.getUint32(36) };
}

export class Session {
  // `initiator` is decided deterministically by the transport (smaller peer code), so
  // both sides agree on who starts the DH ratchet without an extra round trip.
  static establish({ identity, ephemeral, remote, myId, peerId, initiator }) {
    const dh1 = initiator ? x25519.getSharedSecret(identity.dhSk, remote.ek) : x25519.getSharedSecret(ephemeral.sk, remote.ik);
    const dh2 = initiator ? x25519.getSharedSecret(ephemeral.sk, remote.ik) : x25519.getSharedSecret(identity.dhSk, remote.ek);
    const dh3 = x25519.getSharedSecret(ephemeral.sk, remote.ek);
    const secret = hkdf(sha256, concatBytes(dh1, dh2, dh3), ZERO32, utf8ToBytes('libo-e2ee-x3dh-v1'), 32);
    wipe(dh1, dh2, dh3);
    const [aId, aKey, bId, bKey] = initiator ? [myId, identity.dhPk, peerId, remote.ik] : [peerId, remote.ik, myId, identity.dhPk];
    const session = new Session();
    session.ad = concatBytes(utf8ToBytes(`libo-e2ee-ad-v1|${aId}|${bId}|`), aKey, bKey);
    session.remoteSignPk = b64(remote.sk);
    session.remoteDhPk = b64(remote.ik);
    session.initiator = initiator;
    session.skipped = new Map();
    session.ns = 0; session.nr = 0; session.pn = 0;
    if (initiator) {
      const dhs = x25519.utils.randomSecretKey();
      session.dhsSk = dhs; session.dhsPk = x25519.getPublicKey(dhs);
      session.dhr = remote.ek;
      const out = kdfRoot(secret, x25519.getSharedSecret(dhs, remote.ek));
      session.rk = out.rk; session.cks = out.ck; session.ckr = null;
    } else {
      session.dhsSk = ephemeral.sk.slice(); session.dhsPk = ephemeral.pk.slice();
      session.dhr = null; session.rk = secret; session.cks = null; session.ckr = null;
    }
    const digest = sha256(concatBytes(utf8ToBytes('libo-e2ee-session-fp'), session.ad));
    session.fingerprint = [...digest.slice(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    session.createdAt = Date.now();
    session.sentSinceRatchet = 0;
    return session;
  }

  // The responder cannot send before the first ratchet step; the transport sends a
  // 'ping' from the initiator right after the handshake so both directions open at once.
  get canSend() { return !!this.cks && !this.closed; }
  get ready() { return !this.closed && !!this.rk; }

  encrypt(plaintext, extraAad = new Uint8Array()) {
    if (!this.canSend) throw new Error('e2ee: sending chain not ready');
    const step = kdfChain(this.cks);
    wipe(this.cks);
    this.cks = step.ck;
    const header = packHeader(this.dhsPk, this.pn, this.ns);
    this.ns += 1;
    this.sentSinceRatchet += 1;
    const cipher = messageCipher(step.mk, concatBytes(this.ad, header, extraAad));
    const ct = cipher.encrypt(plaintext);
    wipe(step.mk);
    return { v: 1, type: 'e2', h: b64(header), c: b64(ct) };
  }

  // Decrypts or returns null. State only advances when authentication succeeds, so a
  // forged or replayed envelope cannot desynchronise the pair.
  decrypt(envelope, extraAad = new Uint8Array()) {
    if (this.closed || !this.rk) return null;
    let header, ct;
    try { header = unpackHeader(unb64(envelope.h, 40)); ct = unb64(envelope.c); } catch { return null; }
    const headerBytes = unb64(envelope.h, 40);
    const aad = concatBytes(this.ad, headerBytes, extraAad);
    const skipKey = `${envelope.h.slice(0, 43)}|${header.n}`;
    const cached = this.skipped.get(skipKey);
    if (cached) {
      const out = this.tryOpen(cached, aad, ct);
      if (out) { this.skipped.delete(skipKey); wipe(cached); }
      return out;
    }
    const snapshot = this.snapshot();
    try {
      if (!this.dhr || !equalBytes(header.dh, this.dhr)) {
        if (this.dhr && this.ckr) this.skipKeys(header.pn);
        this.ratchet(header.dh);
      }
      this.skipKeys(header.n);
      const step = kdfChain(this.ckr);
      const out = this.tryOpen(step.mk, aad, ct);
      wipe(step.mk);
      if (!out) throw new Error('e2ee: auth failed');
      wipe(this.ckr);
      this.ckr = step.ck;
      this.nr += 1;
      this.trimSkipped();
      return out;
    } catch {
      this.restore(snapshot);
      return null;
    }
  }

  tryOpen(mk, aad, ct) {
    try { return messageCipher(mk, aad).decrypt(ct); } catch { return null; }
  }

  skipKeys(until) {
    if (!this.ckr) { if (until > MAX_SKIP) throw new Error('e2ee: too many skipped'); return; }
    if (until - this.nr > MAX_SKIP) throw new Error('e2ee: too many skipped');
    while (this.nr < until) {
      const step = kdfChain(this.ckr);
      this.ckr = step.ck;
      this.skipped.set(`${b64(this.dhr).slice(0, 43)}|${this.nr}`, step.mk);
      this.nr += 1;
    }
  }

  ratchet(remotePk) {
    this.pn = this.ns; this.ns = 0; this.nr = 0;
    this.dhr = remotePk;
    let out = kdfRoot(this.rk, x25519.getSharedSecret(this.dhsSk, this.dhr));
    this.rk = out.rk; this.ckr = out.ck;
    const next = x25519.utils.randomSecretKey();
    this.dhsSk = next; this.dhsPk = x25519.getPublicKey(next);
    out = kdfRoot(this.rk, x25519.getSharedSecret(this.dhsSk, this.dhr));
    this.rk = out.rk; this.cks = out.ck;
    this.sentSinceRatchet = 0;
  }

  trimSkipped() {
    while (this.skipped.size > MAX_SKIPPED_KEYS) {
      const oldest = this.skipped.keys().next().value;
      wipe(this.skipped.get(oldest));
      this.skipped.delete(oldest);
    }
  }

  snapshot() {
    return { rk: this.rk, cks: this.cks, ckr: this.ckr, dhsSk: this.dhsSk, dhsPk: this.dhsPk, dhr: this.dhr, ns: this.ns, nr: this.nr, pn: this.pn, skipped: new Map(this.skipped), sentSinceRatchet: this.sentSinceRatchet };
  }
  restore(snapshot) { Object.assign(this, snapshot); }

  close() {
    this.closed = true;
    wipe(this.rk, this.cks, this.ckr, this.dhsSk);
    for (const key of this.skipped.values()) wipe(key);
    this.skipped.clear();
    this.rk = this.cks = this.ckr = this.dhsSk = null;
  }
}

export const encodeText = value => utf8ToBytes(value);
export const decodeText = bytes => new TextDecoder().decode(bytes);
