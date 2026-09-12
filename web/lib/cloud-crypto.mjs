// LIBO 2.3 asynchronous envelopes. Standard Web Crypto primitives; not an audited ratchet.
import { bytes64, from64, random64, hashHex, cleanPublicKey, publicKeyText, fingerprint, signText, verifyText, sealRecord, openRecord } from './crypto.mjs';
import { normalizeNickname, normalizePeerId, peerIdForNickname, validatePacket } from './core.mjs';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ID = /^[a-f0-9-]{16,64}$/;
export const CLOUD_MAX_CIPHER = 2_100_000;
export const CLOUD_PACKET_TYPES = ['message', 'ack', 'read', 'read-ack'];

export async function createMailbox() {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  return { publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey), privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}
export const bundleText = b => JSON.stringify(['LIBO-BUNDLE-2.3', b.id, b.name, publicKeyText(b.identity), publicKeyText(b.encryption)]);
export async function makeBundle(profile, identity, mailbox) {
  const bundle = { v: 1, id: profile.id, name: profile.name, identity: cleanPublicKey(identity.publicKey), encryption: cleanPublicKey(mailbox.publicKey) };
  bundle.signature = await signText(identity, bundleText(bundle));
  return bundle;
}
export async function verifyBundle(raw) {
  if (!raw || raw.v !== 1 || !normalizePeerId(raw.id) || normalizeNickname(raw.name) !== raw.name || await peerIdForNickname(raw.name) !== raw.id) throw new Error('CLOUD_INVALID');
  const bundle = { v: 1, id: raw.id, name: raw.name, identity: cleanPublicKey(raw.identity), encryption: cleanPublicKey(raw.encryption), signature: raw.signature };
  if (!await verifyText(bundle.identity, bundleText(bundle), bundle.signature)) throw new Error('CRYPTO_SIGNATURE');
  return bundle;
}
export const cloudLoginText = (challenge, deviceId, bundle, backup, notificationToken = '') => JSON.stringify(['LIBO-LOGIN-2.3', challenge.id, challenge.nonce, deviceId, bundleText(bundle), backup ? JSON.stringify(backup) : null, notificationToken]);
const envelopeHeader = e => JSON.stringify(['LIBO-CLOUD-2.3', e.id, e.from, e.to, e.peer, e.peerName, publicKeyText(e.peerKey), e.name, e.kind, e.at, e.recipientKey, publicKeyText(e.senderKey), publicKeyText(e.ephemeral), e.salt, e.iv]);
const envelopeText = e => JSON.stringify([envelopeHeader(e), e.data]);

export function validateEnvelope(raw) {
  if (!raw || raw.v !== 1 || typeof raw.id !== 'string' || !ID.test(raw.id) || !normalizePeerId(raw.from) || !normalizePeerId(raw.to) || !normalizePeerId(raw.peer) || normalizeNickname(raw.peerName) !== raw.peerName || normalizeNickname(raw.name) !== raw.name || !CLOUD_PACKET_TYPES.includes(raw.kind) || !Number.isSafeInteger(raw.at) || raw.at < 1 || raw.at > 8_640_000_000_000_000 || !/^[a-f0-9]{64}$/.test(raw.recipientKey || '')) throw new Error('CLOUD_INVALID');
  if (from64(raw.salt, 64).length !== 32 || from64(raw.iv, 32).length !== 12 || from64(raw.data, CLOUD_MAX_CIPHER).length < 16 || from64(raw.signature, 128).length !== 64) throw new Error('CLOUD_INVALID');
  return { v: 1, id: raw.id, from: raw.from, to: raw.to, peer: raw.peer, peerName: raw.peerName, peerKey: cleanPublicKey(raw.peerKey), name: raw.name, kind: raw.kind, at: raw.at, recipientKey: raw.recipientKey,
    senderKey: cleanPublicKey(raw.senderKey), ephemeral: cleanPublicKey(raw.ephemeral), salt: raw.salt, iv: raw.iv, data: raw.data, signature: raw.signature };
}
export async function verifyEnvelope(raw, expectedSenderKey = null) {
  const envelope = validateEnvelope(raw);
  if (await peerIdForNickname(envelope.name) !== envelope.from || await peerIdForNickname(envelope.peerName) !== envelope.peer) throw new Error('CLOUD_INVALID');
  if (expectedSenderKey && publicKeyText(envelope.senderKey) !== publicKeyText(expectedSenderKey)) throw new Error('CRYPTO_KEY_CHANGED');
  if (!await verifyText(envelope.senderKey, envelopeText(envelope), envelope.signature)) throw new Error('CRYPTO_SIGNATURE');
  return envelope;
}
async function envelopeKey(privateKey, publicKey, header) {
  const publicCryptoKey = await crypto.subtle.importKey('jwk', cleanPublicKey(publicKey), ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicCryptoKey }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: from64(header.salt), info: encoder.encode(envelopeHeader(header)) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealEnvelope(profile, identity, recipient, packet, { id = packet.id || crypto.randomUUID(), peer = profile.id, peerName = profile.name, peerKey = identity.publicKey } = {}) {
  const normalized = validatePacket(packet);
  if (!normalized || !CLOUD_PACKET_TYPES.includes(normalized.type)) throw new Error('CLOUD_INVALID');
  const bundle = await verifyBundle(recipient);
  const ephemeral = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const envelope = { v: 1, id, from: profile.id, to: bundle.id, peer, peerName, peerKey: cleanPublicKey(peerKey), name: profile.name, kind: packet.type, at: Date.now(),
    recipientKey: await fingerprint(bundle.encryption), senderKey: cleanPublicKey(identity.publicKey), ephemeral: cleanPublicKey(await crypto.subtle.exportKey('jwk', ephemeral.publicKey)), salt: random64(32), iv: random64(12) };
  const key = await envelopeKey(ephemeral.privateKey, bundle.encryption, envelope);
  const bytes = encoder.encode(JSON.stringify(normalized));
  if (bytes.length > 1_550_000) throw new Error('CLOUD_INVALID');
  envelope.data = bytes64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: from64(envelope.iv), additionalData: encoder.encode(envelopeHeader(envelope)), tagLength: 128 }, key, bytes)));
  envelope.signature = await signText(identity, envelopeText(envelope));
  return validateEnvelope(envelope);
}
export async function openEnvelope(mailbox, ownId, raw, expectedSenderKey = null) {
  const envelope = await verifyEnvelope(raw, expectedSenderKey);
  if (envelope.to !== ownId || envelope.recipientKey !== await fingerprint(mailbox.publicKey)) throw new Error('CRYPTO_KEY_CHANGED');
  const privateKey = await crypto.subtle.importKey('jwk', mailbox.privateKey, ECDH, false, ['deriveBits']);
  const key = await envelopeKey(privateKey, envelope.ephemeral, envelope);
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: from64(envelope.iv), additionalData: encoder.encode(envelopeHeader(envelope)), tagLength: 128 }, key, from64(envelope.data, CLOUD_MAX_CIPHER));
  const packet = validatePacket(JSON.parse(decoder.decode(bytes)));
  if (!packet || packet.type !== envelope.kind || (packet.type === 'message' && packet.id !== envelope.id)) throw new Error('CLOUD_INVALID');
  return { envelope, packet };
}

export async function recoveryId(secret) {
  if (from64(secret, 64).length !== 32) throw new Error('RECOVERY_INVALID');
  return hashHex('LIBO-RECOVERY-2.3:' + secret);
}
async function recoveryKey(secret) {
  const bytes = from64(secret, 64); if (bytes.length !== 32) throw new Error('RECOVERY_INVALID');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function makeRecoveryBackup(secret, profile, identity, mailbox) {
  const id = await recoveryId(secret);
  const box = await sealRecord(await recoveryKey(secret), { v: 1, profile: { id: profile.id, name: profile.name }, identity, mailbox }, `cloud-recovery:${id}`);
  return { v: 1, id, box };
}
export async function openRecoveryBackup(secret, backup) {
  const id = await recoveryId(secret);
  if (!backup || backup.v !== 1 || backup.id !== id) throw new Error('RECOVERY_INVALID');
  const value = await openRecord(await recoveryKey(secret), backup.box, `cloud-recovery:${id}`);
  if (value.v !== 1 || await peerIdForNickname(value.profile.name) !== value.profile.id) throw new Error('RECOVERY_INVALID');
  // Validate that both restored private keys match their claimed public keys.
  const bundle = await makeBundle(value.profile, value.identity, value.mailbox);
  await verifyBundle(bundle);
  const probe = { v: 2, type: 'ack', id: crypto.randomUUID() };
  await openEnvelope(value.mailbox, value.profile.id, await sealEnvelope(value.profile, value.identity, bundle, probe), value.identity.publicKey);
  return value;
}
