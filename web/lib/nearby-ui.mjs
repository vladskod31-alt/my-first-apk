import { BluetoothManager } from './bluetooth.mjs';
import { Calls } from './calls.mjs';
import { makeIceServers, normalizePeerCode } from './core.mjs';
import { formatInvite, parseInvite } from './e2ee.mjs';

export function setupNearby({ state, transport, notify, openDialog, openChat, render }) {
  const $ = s => document.querySelector(s), native = window.LiboAndroid;
  const dialog = $('#call-dialog');
  const calls = new Calls({
    transport,
    allowed: id => !state.locked && !document.hidden && state.chats.some(c => c.id === id && !c.request && !c.keyChanged) && !state.blocked.includes(id),
    iceServers: id => transport.channel(id) === 'wifi' ? [] : makeIceServers(state.settings),
    audio: $('#call-audio'),
    change(c, reason) {
      if (!c) { dialog.close(); if (reason) notify(reason); return; }
      $('#call-name').textContent = state.chats.find(x => x.id === c.peer)?.name || c.peer;
      $('#call-phase').textContent = c.phase;
      $('#call-accept').hidden = !c.incoming || !!c.accepting;
      $('#call-mute').hidden = !c.stream;
      $('#call-mute').textContent = c.muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон';
      $('#call-mute').setAttribute('aria-pressed', String(c.muted));
      if (!dialog.open) dialog.showModal();
    },
  });
  $('#call-start').onclick = () => calls.dial(state.current).catch(e => notify(e.message, true));
  $('#call-accept').onclick = () => void calls.accept();
  $('#call-end').onclick = () => calls.end();
  $('#call-mute').onclick = () => calls.mute();
  $('#call-play').onclick = () => $('#call-audio').play().catch(() => notify('Звук ще недоступний'));
  dialog.addEventListener('cancel', e => { e.preventDefault(); calls.end(); });
  dialog.addEventListener('close', () => calls.end());
  document.addEventListener('visibilitychange', () => { if (document.hidden) calls.end('Виклик завершено при згортанні'); });
  window.addEventListener('pagehide', () => calls.end());

  const bridge = native?.nearbyStatus ? {
    btStatus: () => native.nearbyStatus(), btStart: id => native.nearbyStart(id),
    btHasPermissions: () => true, btSend: (id, json) => native.nearbySend(id, json),
    btClose: id => native.nearbyClose(id), btStop: () => native.nearbyStop(),
  } : {};
  const local = new BluetoothManager({ transport, kind: 'wifi', bridge, onToast: notify, onChange: () => { render(); refresh(); } });
  function refresh() {
    const status = local.status();
    $('#nearby-status').textContent = !local.supported ? 'Локальний канал доступний у Android APK. У браузері — WebRTC.' : status.listening ? `Канал увімкнено. IP: ${(status.addresses || []).join(', ') || 'немає — підключіть Wi-Fi'}` : 'Локальний канал вимкнений';
    $('#nearby-enabled').checked = !!status.listening;
    $('#nearby-native').hidden = !local.supported;
    $('#nfc-status').textContent = native?.nfcAvailable?.() ? 'NFC готовий. Потрібна NDEF-мітка; телефон ↔ телефон (Android Beam) не підтримується.' : 'NFC недоступний або вимкнений. Можна скористатися кодом/QR профілю.';
    for (const id of ['nfc-read','nfc-write']) $('#' + id).disabled = !native?.nfcAvailable?.();
    const links = $('#nearby-links'); links.replaceChildren();
    for (const c of local.connections()) {
      const row = document.createElement('div'); row.className = 'field-pair';
      const chat = document.createElement('button'); chat.className = 'secondary-button'; chat.textContent = `${c.peer.slice(0, 14)}… · ${transport.e2Status(c.peer) ? 'захищено' : 'рукостискання'}`;
      chat.onclick = () => { $('#nearby-dialog').close(); void openChat(c.peer); };
      const close = document.createElement('button'); close.className = 'secondary-button'; close.textContent = 'Відключити'; close.onclick = () => c.close();
      row.append(chat, close); links.append(row);
    }
  }
  $('#open-nearby').onclick = () => { openDialog('nearby-dialog'); refresh(); };
  $('#nearby-refresh').onclick = refresh;
  $('#nearby-enabled').onchange = e => { if (e.target.checked) local.start(state.profile.id); else local.stop(); setTimeout(refresh, 100); };
  $('#nearby-connect').onclick = () => { if (local.start(state.profile.id)) native.nearbyConnect($('#nearby-ip').value.trim()); refresh(); };
  $('#nearby-scan').onclick = () => { if (local.start(state.profile.id)) native.nearbyScan(); refresh(); };
  $('#nfc-read').onclick = () => native?.nfcRead();
  $('#nfc-write').onclick = () => {
    if (!state.identity) return;
    // Explicit button: writing overwrites the tag's existing NDEF content.
    native?.nfcWrite(formatInvite(state.profile.id, state.identity));
  };
  $('#nearby-dialog').addEventListener('close', () => native?.nfcStop?.());
  window.LiboNearby = {
    pause: () => calls.end('Виклик завершено при згортанні'),
    onNfc(value, status) {
      if (state.locked) return;
      if (status) { notify(value); return; }
      const invite = parseInvite(value, normalizePeerCode);
      if (!invite?.signPk) { notify('Некоректне NFC-запрошення', true); return; }
      openDialog('new-dialog'); $('#contact-code').value = value;
      notify('Перевірте запрошення та підтвердьте додавання контакту');
    },
    onEvent(e) {
      if (e.ev === 'devices') {
        const list = $('#nearby-devices'); list.replaceChildren();
        for (const d of e.devices || []) {
          const button = document.createElement('button'); button.className = 'secondary-button full-width';
          button.textContent = d.name || d.address;
          button.onclick = () => native.nearbyDirect(d.address); list.append(button);
        }
        if (!list.children.length) list.textContent = 'Пристроїв не знайдено. Запустіть пошук на обох телефонах.';
      } else if (e.ev === 'status') { if(e.message) notify(e.message); refresh(); }
      else local.onEvent(e);
    },
  };
  return calls;
}
