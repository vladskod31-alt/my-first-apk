// Web Crypto only. No custom block cipher or unauthenticated AES modes.
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export const VAULT_ITERATIONS = 310_000;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const MAX_BOX = 2_900_000;
export const bytes64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
export function from64(text, max = MAX_BOX) {
  if (typeof text !== 'string' || text.length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('CRYPTO_INVALID');
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
export const random64 = size => bytes64(crypto.getRandomValues(new Uint8Array(size)));
export async function hashHex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function cleanPublicKey(key) {
  if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || typeof key.x !== 'string' || typeof key.y !== 'string' || !/^[\w-]{43}$/.test(key.x) || !/^[\w-]{43}$/.test(key.y) || key.d !== undefined) throw new Error('CRYPTO_INVALID');
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, ext: true };
}
export const publicKeyText = key => { const k = cleanPublicKey(key); return `P-256:${k.x}:${k.y}`; };
export const fingerprint = key => hashHex(publicKeyText(key));
export async function createIdentity() {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  return { privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) };
}
export async function signText(identity, text) {
  const key = await crypto.subtle.importKey('jwk', identity.privateKey, ECDSA, false, ['sign']);
  return bytes64(new Uint8Array(await crypto.subtle.sign(SIGN, key, enc.encode(text))));
}
export async function verifyText(publicKey, text, signature) {
  const key = await crypto.subtle.importKey('jwk', cleanPublicKey(publicKey), ECDSA, false, ['verify']);
  return crypto.subtle.verify(SIGN, key, from64(signature, 128), enc.encode(text));
}
const helloText = hello => JSON.stringify(['LIBO-HELLO-2.1', hello.id, hello.name, hello.nonce, publicKeyText(hello.identity), publicKeyText(hello.ephemeral)]);
export async function makeHello(profile, identity) {
  const ephemeral = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const hello = {
    v: 2, type: 'hello', id: profile.id, name: profile.name, nonce: random64(32),
    identity: cleanPublicKey(identity.publicKey), ephemeral: cleanPublicKey(await crypto.subtle.exportKey('jwk', ephemeral.publicKey)),
  };
  hello.signature = await signText(identity, helloText(hello));
  return { hello, ephemeralPrivate: ephemeral.privateKey };
}
export async function verifyHello(raw, expectedId) {
  if (!raw || raw.v !== 2 || raw.type !== 'hello' || raw.id !== expectedId || typeof raw.name !== 'string' || raw.name.length < 3 || raw.name.length > 40 || from64(raw.nonce, 64).length !== 32) throw new Error('CRYPTO_INVALID');
  const hello = { v: 2, type: 'hello', id: raw.id, name: raw.name, nonce: raw.nonce, identity: cleanPublicKey(raw.identity), ephemeral: cleanPublicKey(raw.ephemeral), signature: raw.signature };
  if (!await verifyText(hello.identity, helloText(hello), hello.signature)) throw new Error('CRYPTO_SIGNATURE');
  return hello;
}
export async function createSession(local, remote) {
  if (local.hello.id === remote.id) throw new Error('CRYPTO_INVALID');
  const pub = await crypto.subtle.importKey('jwk', remote.ephemeral, ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, local.ephemeralPrivate, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const ordered = [local.hello, remote].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const transcript = JSON.stringify(ordered.map(h => [helloText(h), h.signature]));
  const salt = await crypto.subtle.digest('SHA-256', enc.encode(transcript));
  const derive = (from, to) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`LIBO-AES256-2.1:${from}>${to}`) }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const tx = await derive(local.hello.id, remote.id);
  const rx = await derive(remote.id, local.hello.id);
  let sent = 0, received = 0;
  const iv = count => { const value = new Uint8Array(12); new DataView(value.buffer).setUint32(8, count, false); return value; };
  const aad = (from, to, n) => enc.encode(`LIBO-BOX-2.1:${from}>${to}:${n}`);
  return {
    async seal(value) {
      if (sent >= 0xffff_fffe) throw new Error('CRYPTO_REKEY');
      const counter = ++sent;
      const plaintext = enc.encode(JSON.stringify(value));
      if (plaintext.length > 2_100_000) throw new Error('CRYPTO_INVALID');
      const result = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv(counter), additionalData: aad(local.hello.id, remote.id, counter), tagLength: 128 }, tx, plaintext);
      return { v: 2, type: 'box', counter, data: bytes64(new Uint8Array(result)) };
    },
    async open(box) {
      if (!box || box.v !== 2 || box.type !== 'box' || !Number.isSafeInteger(box.counter) || box.counter <= received || box.counter > 0xffff_fffe) throw new Error('CRYPTO_REPLAY');
      const ciphertext = from64(box.data);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv(box.counter), additionalData: aad(remote.id, local.hello.id, box.counter), tagLength: 128 }, rx, ciphertext);
      const result = JSON.parse(dec.decode(plaintext));
      received = box.counter;
      return result;
    },
  };
}

export async function passwordKey(password, salt, iterations = VAULT_ITERATIONS) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) throw new Error('PASSWORD_LENGTH');
  if (iterations !== VAULT_ITERATIONS || from64(salt, 64).length !== 32) throw new Error('VAULT_INVALID');
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: from64(salt), iterations }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealRecord(key, value, location) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`LIBO-VAULT-1:${location}`), tagLength: 128 }, key, enc.encode(JSON.stringify(value)));
  return { vault: 1, iv: bytes64(iv), data: bytes64(new Uint8Array(data)) };
}
export async function openRecord(key, box, location) {
  if (!box || box.vault !== 1 || from64(box.iv, 32).length !== 12) throw new Error('VAULT_INVALID');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: from64(box.iv), additionalData: enc.encode(`LIBO-VAULT-1:${location}`), tagLength: 128 }, key, from64(box.data, 900_000_000));
  return JSON.parse(dec.decode(plaintext));
}

// Separate password-derived key keeps vault record IDs opaque. The salt domain differs from AES.
export async function passwordIndexKey(password, salt) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) throw new Error('PASSWORD_LENGTH');
  const bytes = from64(salt, 64); if (bytes.length !== 32) throw new Error('VAULT_INVALID');
  const prefix = enc.encode('LIBO-VAULT-INDEX-1:');
  const domainSalt = new Uint8Array(prefix.length + bytes.length); domainSalt.set(prefix); domainSalt.set(bytes, prefix.length);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: domainSalt, iterations: VAULT_ITERATIONS }, key, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
}
export async function opaqueRecordId(key, id) {
  const value = await crypto.subtle.sign('HMAC', key, enc.encode(`LIBO-RECORD-1:${id}`));
  return 'r-' + [...new Uint8Array(value)].map(x => x.toString(16).padStart(2, '0')).join('');
}
