const $ = selector => document.querySelector(selector);
const canvas = $('#game-canvas');
const ctx = canvas.getContext('2d');
const bg = new Image();
bg.src = './swamp-attack-splash.png';

const WEAPONS = {
  shotgun: { damage: 38, rate: 430, spread: 72, color: '#ffd34f' },
  rifle: { damage: 22, rate: 170, spread: 34, color: '#fff3a0' },
  bomb: { damage: 90, rate: 850, spread: 190, color: '#ff7b2f' },
};
const TYPES = {
  gator: { hp: 72, speed: .027, reward: 7, radius: 30, color: '#67b52d', face: '🐊' },
  frog: { hp: 42, speed: .043, reward: 5, radius: 24, color: '#8ad43c', face: '🐸' },
  brute: { hp: 160, speed: .017, reward: 14, radius: 40, color: '#397e2a', face: '🦖' },
};
const save = JSON.parse(localStorage.getItem('swamp-save') || '{}');
const state = {
  running: false, paused: false, over: false, wave: 1, health: 100,
  coins: Number(save.coins) || 0, best: Number(save.best) || 0,
  upgrades: { power: 0, house: 0, ammo: 0, ...(save.upgrades || {}) },
  weapon: 'shotgun', ammo: {}, enemies: [], particles: [], shots: [],
  spawned: 0, waveTotal: 0, nextSpawn: 0, nextShot: 0, waveDelay: false,
  last: 0, sound: save.sound !== false, audio: null, pointer: null,
};

function persist() {
  localStorage.setItem('swamp-save', JSON.stringify({ coins: state.coins, best: state.best, upgrades: state.upgrades, sound: state.sound }));
}
function ammoFor(name) {
  const bonus = state.upgrades.ammo * (name === 'rifle' ? 6 : name === 'shotgun' ? 2 : 1);
  return ({ shotgun: 8, rifle: 24, bomb: 3 })[name] + bonus;
}
function resetAmmo() {
  state.ammo = { shotgun: ammoFor('shotgun'), rifle: ammoFor('rifle'), bomb: ammoFor('bomb') };
  updateHud();
}
function updateHud() {
  $('#wave-value').textContent = state.wave;
  $('#coin-value').textContent = state.coins;
  $('#best-wave').textContent = state.best;
  $('#health-bar').style.width = `${Math.max(0, state.health)}%`;
  for (const name of Object.keys(WEAPONS)) $(`#ammo-${name}`).textContent = state.ammo[name] ?? ammoFor(name);
  $('#sound-toggle').textContent = state.sound ? '🔊' : '🔇';
}
function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', fitCanvas);

function beep(freq, duration = .08, type = 'square', volume = .035) {
  if (!state.sound) return;
  try {
    state.audio ||= new AudioContext();
    if (state.audio.state === 'suspended') state.audio.resume();
    const osc = state.audio.createOscillator(), gain = state.audio.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, state.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, state.audio.currentTime + duration);
    osc.connect(gain); gain.connect(state.audio.destination); osc.start(); osc.stop(state.audio.currentTime + duration);
  } catch { /* Sound is optional. */ }
}
function showScreen(id) {
  $('#menu').hidden = id !== 'menu'; $('#game').hidden = id !== 'game';
}
function startGame() {
  closeModal(); showScreen('game'); fitCanvas();
  state.running = true; state.paused = false; state.over = false; state.wave = 1;
  state.health = Math.min(100, 100 + state.upgrades.house * 10);
  state.enemies = []; state.particles = []; state.shots = [];
  resetAmmo(); beginWave(); state.last = performance.now(); requestAnimationFrame(loop);
}
function beginWave() {
  state.spawned = 0; state.waveTotal = 4 + state.wave * 2; state.nextSpawn = performance.now() + 700; state.waveDelay = false;
  const banner = $('#wave-banner'); banner.textContent = `ХВИЛЯ ${state.wave}`; banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 1200); updateHud(); beep(320, .18, 'sawtooth');
}
function spawnEnemy() {
  let type = 'gator'; const roll = Math.random();
  if (state.wave > 2 && roll > .77) type = 'brute'; else if (roll < .33) type = 'frog';
  const base = TYPES[type]; const scale = 1 + (state.wave - 1) * .1;
  state.enemies.push({ id: crypto.randomUUID(), type, x: -.07, y: .43 + Math.random() * .35, hp: base.hp * scale, maxHp: base.hp * scale, wobble: Math.random() * 6.2, hit: 0 });
  state.spawned++;
}
function nextWave() {
  state.wave++; state.best = Math.max(state.best, state.wave - 1); state.coins += 8 + state.wave;
  persist(); resetAmmo(); beginWave();
}
function gameOver() {
  state.running = false; state.over = true; state.best = Math.max(state.best, state.wave); persist(); updateHud(); beep(95, .6, 'sawtooth', .06);
  showModal(`<h2>ХАТИНУ ЗАХОПЛЕНО!</h2><div class="stars">${state.wave > 5 ? '⭐⭐⭐' : state.wave > 2 ? '⭐⭐' : '⭐'}</div><div class="score">${state.wave}</div><p>Ти відбив хвиль: <b>${state.wave - 1}</b><br>Монети та покращення збережено.</p><button class="wood-button primary" id="again">↻ ГРАТИ ЗНОВУ</button><button class="wood-button" id="home">⌂ МЕНЮ</button>`);
  $('#again').onclick = startGame; $('#home').onclick = backToMenu;
}
function backToMenu() {
  state.running = false; closeModal(); showScreen('menu'); updateHud();
}

function shoot(clientX, clientY) {
  if (!state.running || state.paused || state.over || performance.now() < state.nextShot) return;
  const rect = canvas.getBoundingClientRect(); const x = clientX - rect.left, y = clientY - rect.top;
  const weapon = WEAPONS[state.weapon];
  if (state.ammo[state.weapon] <= 0) { reload(); return; }
  state.ammo[state.weapon]--; state.nextShot = performance.now() + weapon.rate;
  const power = 1 + state.upgrades.power * .18;
  let hits = state.enemies.filter(enemy => Math.hypot(enemy.x * rect.width - x, enemy.y * rect.height - y) < weapon.spread + TYPES[enemy.type].radius);
  if (state.weapon !== 'bomb') hits = hits.sort((a,b) => b.x - a.x).slice(0, state.weapon === 'shotgun' ? 2 : 1);
  for (const enemy of hits) {
    const distance = Math.hypot(enemy.x * rect.width - x, enemy.y * rect.height - y);
    enemy.hp -= weapon.damage * power * (state.weapon === 'bomb' ? Math.max(.45, 1 - distance / weapon.spread) : 1);
    enemy.hit = .12;
    for (let i=0;i<7;i++) state.particles.push({ x:enemy.x, y:enemy.y, vx:(Math.random()-.5)*.18, vy:(Math.random()-.8)*.16, life:.35, color:weapon.color });
    if (enemy.hp <= 0 && !enemy.dead) { enemy.dead = true; state.coins += TYPES[enemy.type].reward; beep(155 + Math.random()*50,.12,'sawtooth'); }
  }
  state.shots.push({ x:x/rect.width, y:y/rect.height, life:.16, bomb:state.weapon==='bomb' });
  state.pointer = { x:x/rect.width, y:y/rect.height, life:.24 };
  beep(state.weapon === 'bomb' ? 75 : state.weapon === 'shotgun' ? 120 : 260, state.weapon === 'bomb' ? .28 : .08, 'square', .06);
  updateHud();
  if (state.ammo[state.weapon] <= 0) setTimeout(reload, 250);
}
function reload() {
  if (!state.running || state.paused || state.ammo[state.weapon] > 0) return;
  $('#reload-hint').hidden = false; state.nextShot = performance.now() + 1050; beep(520,.05,'sine');
  setTimeout(() => { if (!state.running) return; state.ammo[state.weapon] = ammoFor(state.weapon); $('#reload-hint').hidden = true; updateHud(); beep(720,.07,'sine'); }, 1000);
}

function update(dt, now) {
  if (state.spawned < state.waveTotal && now >= state.nextSpawn) { spawnEnemy(); state.nextSpawn = now + Math.max(430, 1150 - state.wave * 55) + Math.random()*350; }
  for (const e of state.enemies) {
    if (e.dead) continue; e.hit = Math.max(0, e.hit - dt);
    e.x += TYPES[e.type].speed * (1 + state.wave * .025) * dt;
    if (e.x > .78) { e.dead = true; state.health -= e.type === 'brute' ? 22 : e.type === 'frog' ? 8 : 13; beep(85,.18,'sawtooth'); updateHud(); if (state.health <= 0) gameOver(); }
  }
  state.enemies = state.enemies.filter(e => !e.dead);
  for (const p of state.particles) { p.x += p.vx*dt; p.y += p.vy*dt; p.vy += .2*dt; p.life -= dt; }
  state.particles = state.particles.filter(p => p.life > 0);
  state.shots.forEach(s => s.life -= dt); state.shots = state.shots.filter(s=>s.life>0);
  if (state.pointer) { state.pointer.life -= dt; if (state.pointer.life <= 0) state.pointer = null; }
  if (state.spawned >= state.waveTotal && !state.enemies.length && !state.waveDelay && state.running) { state.waveDelay = true; setTimeout(() => state.running && nextWave(), 1200); }
}
function draw() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (bg.complete) ctx.drawImage(bg, 0, 0, w, h); else { ctx.fillStyle='#0b3735';ctx.fillRect(0,0,w,h); }
  ctx.fillStyle='rgba(0,27,27,.23)';ctx.fillRect(0,0,w,h);
  const water = ctx.createLinearGradient(0,h*.43,0,h);water.addColorStop(0,'rgba(14,96,84,.08)');water.addColorStop(1,'rgba(1,25,29,.58)');ctx.fillStyle=water;ctx.fillRect(0,h*.42,w,h*.58);
  for (const e of state.enemies) drawEnemy(e,w,h);
  for (const p of state.particles) { ctx.globalAlpha=Math.min(1,p.life*4);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x*w,p.y*h,3+p.life*5,0,Math.PI*2);ctx.fill(); }
  ctx.globalAlpha=1;
  for (const s of state.shots) { ctx.strokeStyle=s.bomb?'#ff7a2f':'#ffe675';ctx.lineWidth=3;ctx.globalAlpha=s.life*6;ctx.beginPath();ctx.arc(s.x*w,s.y*h,s.bomb?(1-s.life/.16)*110:15,0,Math.PI*2);ctx.stroke(); }
  ctx.globalAlpha=1;
  if (state.pointer) { const x=state.pointer.x*w,y=state.pointer.y*h;ctx.strokeStyle='#fff7a0';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.moveTo(x-23,y);ctx.lineTo(x-8,y);ctx.moveTo(x+8,y);ctx.lineTo(x+23,y);ctx.moveTo(x,y-23);ctx.lineTo(x,y-8);ctx.moveTo(x,y+8);ctx.lineTo(x,y+23);ctx.stroke(); }
}
function drawEnemy(e,w,h) {
  const t=TYPES[e.type], x=e.x*w, y=e.y*h+Math.sin(performance.now()/180+e.wobble)*5, r=t.radius*Math.min(1.25,h/500);
  ctx.save();ctx.translate(x,y);if(e.hit)ctx.filter='brightness(2)';
  ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(0,r*.75,r*1.2,r*.35,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=t.color;ctx.strokeStyle='#173c1e';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,0,r*1.08,r*.72,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.font=`${r*1.25}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t.face,0,-2);
  ctx.fillStyle='#311b16';ctx.fillRect(-r,-r-12,r*2,6);ctx.fillStyle='#e14a2e';ctx.fillRect(-r,-r-12,r*2*(e.hp/e.maxHp),6);
  ctx.restore();
}
function loop(now) {
  if (!state.running) return; const dt=Math.min(.034,(now-state.last)/1000||0);state.last=now;
  if(!state.paused)update(dt,now);draw();requestAnimationFrame(loop);
}

function showModal(html) { $('#modal-content').innerHTML=html;$('#modal').hidden=false; }
function closeModal() { $('#modal').hidden=true;$('#modal-content').replaceChildren(); }
function pauseGame() {
  if(!state.running)return;state.paused=true;
  showModal('<h2>ПАУЗА</h2><p>Болото нікуди не втече… але монстри теж чекають.</p><button class="wood-button primary" id="resume">▶ ПРОДОВЖИТИ</button><button class="wood-button" id="quit">⌂ В МЕНЮ</button>');
  $('#resume').onclick=()=>{state.paused=false;state.last=performance.now();closeModal();};$('#quit').onclick=backToMenu;
}
function upgradesModal() {
  const items=[['power','💥','Вогнева міць','Більше шкоди від усієї зброї'],['house','🏚️','Міцна хатина','+10 міцності хатини'],['ammo','🧰','Більше набоїв','Збільшений боєзапас']];
  const rows=items.map(([key,icon,title,desc])=>{const level=state.upgrades[key],cost=25+level*25;return `<div class="upgrade-row"><span class="emoji">${icon}</span><div><strong>${title} · ${level}/5</strong><small>${desc}</small></div><button data-upgrade="${key}" data-cost="${cost}" ${level>=5||state.coins<cost?'disabled':''}>🪙 ${level>=5?'MAX':cost}</button></div>`}).join('');
  showModal(`<h2>МАЙСТЕРНЯ</h2><p>Твої монети: 🪙 <b>${state.coins}</b></p><div class="upgrade-list">${rows}</div>`);
  document.querySelectorAll('[data-upgrade]').forEach(button=>button.onclick=()=>{const key=button.dataset.upgrade,cost=Number(button.dataset.cost);if(state.coins>=cost&&state.upgrades[key]<5){state.coins-=cost;state.upgrades[key]++;persist();updateHud();upgradesModal();}});
}
function howModal() { showModal('<h2>ЯК ГРАТИ</h2><p>🎯 Торкайся монстрів, щоб стріляти.<br><br>🔫 Перемикай зброю внизу екрана. Дробовик б’є сильно, гвинтівка — швидко, а бомба вражає площу.<br><br>🪙 Збирай монети й купуй покращення.<br><br>🏚️ Не дай ворогам дістатися хатини!</p><button class="wood-button primary" id="got-it">ЗРОЗУМІЛО!</button>');$('#got-it').onclick=closeModal; }

$('#play-button').onclick=startGame;$('#upgrades-button').onclick=upgradesModal;$('#how-button').onclick=howModal;
$('#sound-toggle').onclick=()=>{state.sound=!state.sound;persist();updateHud();beep(500);};
$('#pause-button').onclick=pauseGame;$('#modal-close').onclick=()=>{if(state.over){backToMenu();return;}if(state.paused){state.paused=false;state.last=performance.now();}closeModal();};
canvas.addEventListener('pointerdown',e=>{e.preventDefault();shoot(e.clientX,e.clientY);});
document.querySelectorAll('.weapon').forEach(button=>button.onclick=()=>{state.weapon=button.dataset.weapon;document.querySelectorAll('.weapon').forEach(b=>b.classList.toggle('active',b===button));beep(420,.04,'sine');if(state.ammo[state.weapon]<=0)reload();});
document.addEventListener('contextmenu',e=>e.preventDefault());
window.Libo={handleBack(){if(!$('#modal').hidden){if(state.paused||state.over)backToMenu();else closeModal();return true;}if(!$('#game').hidden){if(state.running)pauseGame();else backToMenu();return true;}return false;}};
updateHud();fitCanvas();
