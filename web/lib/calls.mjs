// Audio uses DTLS-SRTP. SDP (including DTLS fingerprints) is carried only in
// authenticated Double Ratchet packets, never in an unauthenticated hello.
export class Calls {
  constructor({ transport, allowed, iceServers, change, audio, media = () => navigator.mediaDevices.getUserMedia({ audio: true }), peer = config => new RTCPeerConnection(config) }) {
    Object.assign(this, { transport, allowed, iceServers, change, audio, media, peer });
    this.current = null;
  }
  signal(c, action, sdp) { return this.transport.send(c.peer, { v: 1, type: 'call', id: c.id, action, ...(sdp ? { sdp } : {}) }); }
  begin(peer, id, phase) {
    const c = { peer, id, phase, muted: false };
    this.current = c;
    c.timer = setTimeout(() => { if (this.current === c) this.end('Час очікування минув'); }, 60000);
    this.change(c); return c;
  }
  async dial(id) {
    if (this.current) throw new Error('Спочатку завершіть поточний виклик');
    if (!this.allowed(id) || !this.transport.e2Status(id)?.canSend) throw new Error('Дочекайтеся захищеного з’єднання з контактом');
    const c = this.begin(id, crypto.randomUUID(), 'Підключення');
    try {
      await this.prepare(c);
      if (this.current !== c) return;
      await c.pc.setLocalDescription(await c.pc.createOffer());
      await this.gather(c);
      if (this.current !== c) return;
      if (!await this.signal(c, 'offer', c.pc.localDescription.sdp)) throw new Error('Канал недоступний');
      if (this.current !== c) return;
      c.phase = 'Очікуємо відповіді'; this.change(c);
    } catch (e) { if (this.current === c) this.end(e.message); }
  }
  async receive(id, p) {
    if (!this.allowed(id) || !this.transport.e2Status(id)) return;
    if (p.action === 'offer') {
      if (this.current) {
        if (this.current.id !== p.id) await this.signal({ peer: id, id: p.id }, 'busy');
        return;
      }
      const c = this.begin(id, p.id, 'Вхідний виклик'); c.offer = p.sdp; c.incoming = true; this.change(c); return;
    }
    const c = this.current;
    if (!c || c.id !== p.id || c.peer !== id) return;
    if (['end', 'reject', 'busy'].includes(p.action)) { this.end(p.action === 'busy' ? 'Зайнято' : 'Виклик завершено', false); return; }
    if (p.action === 'answer' && c.pc?.signalingState === 'have-local-offer') {
      try { await c.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }); }
      catch { if (this.current === c) this.end('Помилка відповіді'); }
    }
  }
  async accept() {
    const c = this.current;
    if (!c?.incoming || c.accepting) return;
    c.accepting = true; c.phase = 'Підключення'; this.change(c);
    try {
      await this.prepare(c);
      if (this.current !== c) return;
      await c.pc.setRemoteDescription({ type: 'offer', sdp: c.offer });
      await c.pc.setLocalDescription(await c.pc.createAnswer());
      await this.gather(c);
      if (this.current !== c) return;
      if (!await this.signal(c, 'answer', c.pc.localDescription.sdp)) throw new Error('Канал недоступний');
    } catch (e) { if (this.current === c) this.end(e.message); }
  }
  async prepare(c) {
    const stream = await this.media();
    if (this.current !== c) { stream.getTracks().forEach(t => t.stop()); return; }
    c.stream = stream;
    c.pc = this.peer({ iceServers: this.iceServers(c.peer) });
    stream.getTracks().forEach(t => c.pc.addTrack(t, stream));
    c.pc.ontrack = e => { if (this.current === c) { this.audio.srcObject = e.streams[0]; this.audio.play().catch(() => { c.phase = 'Натисніть «Увімкнути звук»'; this.change(c); }); } };
    c.pc.onconnectionstatechange = () => {
      if (this.current !== c) return;
      if (c.pc.connectionState === 'connected') { clearTimeout(c.timer); c.phase = 'На зв’язку'; this.change(c); }
      if (['failed', 'disconnected', 'closed'].includes(c.pc.connectionState)) this.end('З’єднання перервано');
    };
  }
  gather(c) {
    if (c.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); c.pc.removeEventListener('icegatheringstatechange', check); c.gatherDone = null; resolve(); };
      const check = () => { if (c.pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, 8000); c.gatherDone = done;
      c.pc.addEventListener('icegatheringstatechange', check);
    });
  }
  mute() {
    const c = this.current; if (!c?.stream) return;
    c.muted = !c.muted; c.stream.getAudioTracks().forEach(t => { t.enabled = !c.muted; }); this.change(c);
  }
  end(reason = 'Виклик завершено', send = true) {
    const c = this.current; if (!c) return;
    this.current = null; clearTimeout(c.timer); c.gatherDone?.();
    if (send) void this.signal(c, c.incoming && !c.accepting ? 'reject' : 'end');
    c.pc?.close(); c.stream?.getTracks().forEach(t => t.stop());
    this.audio.srcObject = null; this.change(null, reason);
  }
}
