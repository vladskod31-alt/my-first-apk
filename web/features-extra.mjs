import { SEND_EFFECTS } from './lib/core.mjs';

export const WALLPAPER_CATALOG = [
  // 14 Pseudo-3D & Animated 3D Scenes
  { id: 'orb-3d', group: '3d', title: '3D Сфери Orb', sub: 'Animated 3D', css: 'radial-gradient(circle at 30% 28%, #e879f9 0%, #7c3aed 42%, #120829 88%)' },
  { id: 'aurora-3d', group: '3d', title: '3D Північне сяйво', sub: 'Animated 3D', css: 'linear-gradient(155deg, #060919 0%, #14b8a6 45%, #9333ea 78%, #120c28 100%)' },
  { id: 'cyber-grid-3d', group: '3d', title: '3D Неонова сітка', sub: 'Perspective 3D', css: 'linear-gradient(180deg, #120524 0%, #fb7185 48%, #7c3aed 56%, #090418 100%)' },
  { id: 'prism-cubes-3d', group: '3d', title: '3D Скляні призми', sub: 'Animated 3D', css: 'linear-gradient(135deg, #31105e 0%, #6366f1 48%, #0ea5e9 100%)' },
  { id: 'starfield-3d', group: '3d', title: '3D Глибокий космос', sub: 'Parallax 3D', css: 'radial-gradient(circle at 50% 30%, #3b1d7a 0%, #090619 72%)' },
  { id: 'liquid-lava-3d', group: '3d', title: '3D Рідкий оксамит', sub: 'Metaball 3D', css: 'radial-gradient(circle at 35% 35%, #fb7185 0%, #9333ea 55%, #1b0629 100%)' },
  { id: 'neon-rings-3d', group: '3d', title: '3D Гіроскоп кільця', sub: 'Gyro 3D', css: 'radial-gradient(circle, #ec4899 0%, #6d28d9 45%, #090516 85%)' },
  { id: 'emerald-canopy-3d', group: '3d', title: 'Псевдо-3D Листя', sub: 'Botanical 3D', css: 'linear-gradient(145deg, #10b981 0%, #064e3b 55%, #03110f 100%)' },
  { id: 'ocean-caustics-3d', group: '3d', title: '3D Океанічні промені', sub: 'Caustics 3D', css: 'linear-gradient(165deg, #22d3ee 0%, #0369a1 48%, #020b16 100%)' },
  { id: 'velvet-waves-3d', group: '3d', title: '3D Шовкові хвилі', sub: 'Ribbon 3D', css: 'linear-gradient(160deg, #a855f7 0%, #db2777 50%, #120622 100%)' },
  { id: 'solar-eclipse-3d', group: '3d', title: '3D Сонячна корона', sub: 'Eclipse 3D', css: 'radial-gradient(circle, #090512 28%, #fb923c 44%, #7e22ce 68%, #090512 92%)' },
  { id: 'crystal-cave-3d', group: '3d', title: 'Псевдо-3D Аметист', sub: 'Faceted 3D', css: 'conic-gradient(from 45deg, #1e1b4b, #6d28d9, #be185d, #2e1065, #1e1b4b)' },
  { id: 'fireflies-3d', group: '3d', title: '3D Нічні світлячки', sub: 'Bokeh 3D', css: 'radial-gradient(circle at 60% 35%, #fde047 0%, #7e22ce 38%, #0b0819 85%)' },
  { id: 'matrix-pulse-3d', group: '3d', title: '3D Неонові потоки', sub: 'Streams 3D', css: 'linear-gradient(180deg, #0ea5e9 0%, #8b5cf6 50%, #050814 100%)' },

  // 5 Custom Generated 9:16 HD Wallpapers
  { id: 'gen-leaves', group: '9:16', title: 'Тропічне листя', sub: '9:16 HD Обої', img: './wallpapers/wp-leaves.jpg' },
  { id: 'gen-golden-fern', group: '9:16', title: 'Оксамитова папороть', sub: '9:16 HD Обої', img: './wallpapers/wp-golden-fern.jpg' },
  { id: 'gen-aurora-forest', group: '9:16', title: 'Ліс та Аврора', sub: '9:16 HD Обої', img: './wallpapers/wp-aurora-forest.jpg' },
  { id: 'gen-crystal-orbs', group: '9:16', title: 'Аметистові 3D сфери', sub: '9:16 HD Обої', img: './wallpapers/wp-crystal-orbs.jpg' },
  { id: 'gen-sakura-night', group: '9:16', title: 'Місячна сакура', sub: '9:16 HD Обої', img: './wallpapers/wp-sakura-night.jpg' },

  // 4 Classic Themes
  { id: 'plain', group: 'classic', title: 'Однотонний', sub: 'Класичний', css: 'linear-gradient(145deg, #efe8ff, #d8b4fe)' },
  { id: 'dusk', group: 'classic', title: 'Сутінки', sub: 'Класичний', css: 'linear-gradient(145deg, #4c1d95, #be185d)' },
  { id: 'mint', group: 'classic', title: 'М’ята', sub: 'Класичний', css: 'linear-gradient(145deg, #a7f3d0, #10b981)' },
  { id: 'mono', group: 'classic', title: 'Монохром', sub: 'Класичний', css: 'linear-gradient(145deg, #52525b, #18181b)' },
];

export const FX_LABELS = {
  '': 'Ефект',
  fire: '🔥 Вогонь',
  hearts: '💜 Серця',
  confetti: '🎉 Конфеті',
  bolt: '⚡ Блискавка',
  spark: '✨ Іскри',
};

export const FX_ICONS = {
  fire: '🔥',
  hearts: '💜',
  confetti: '🎉',
  bolt: '⚡',
  spark: '✨',
};

const BUBBLE_GRAD_KEY = 'libo.ui.bubbleGrad';
const LANG_KEY = 'libo.ui.lang';

/* ==========================================================================
   1. XSS-Safe Rich Text Parser (**bold**, *italic*, `code`, ||spoiler||)
   ========================================================================== */
const RICH_TOKEN_RE = /(\|\|[^\n|]{1,400}\|\||\*\*[^\n*]{1,400}\*\*|`[^`\n]{1,400}`|\*[^\s*][^\n*]{0,398}\*|\*[^\s*]\*)/g;

export function appendRichText(parent, text) {
  const source = String(text || '');
  if (!source) return;
  let last = 0;
  for (const match of source.matchAll(RICH_TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) parent.append(document.createTextNode(source.slice(last, idx)));
    const token = match[0];
    if (token.startsWith('||') && token.endsWith('||') && token.length > 4) {
      const sp = document.createElement('span');
      sp.className = 'msg-spoiler';
      sp.tabIndex = 0;
      sp.setAttribute('role', 'button');
      sp.title = 'Натисніть, щоб показати спойлер';
      sp.textContent = token.slice(2, -2);
      const toggle = (ev) => {
        ev.stopPropagation();
        sp.classList.toggle('revealed');
      };
      sp.addEventListener('click', toggle);
      sp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggle(ev);
        }
      });
      parent.append(sp);
    } else if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      const code = document.createElement('code');
      code.className = 'msg-code';
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      parent.append(em);
    } else {
      parent.append(document.createTextNode(token));
    }
    last = idx + token.length;
  }
  if (last < source.length) parent.append(document.createTextNode(source.slice(last)));
}

/* ==========================================================================
   2. 60fps Particle Send Effects Canvas
   ========================================================================== */
let fxAnimId = 0;
const fxParticles = [];

export function triggerSendEffect(fx) {
  if (!SEND_EFFECTS.includes(fx)) return;
  const canvas = document.getElementById('fx-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  try { navigator.vibrate?.(14); } catch {}

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const palettes = {
    fire: ['#fb923c', '#f43f5e', '#facc15', '#ef4444'],
    hearts: ['#ec4899', '#a855f7', '#f472b6', '#e879f9'],
    confetti: ['#ec4899', '#8b5cf6', '#38bdf8', '#4ade80', '#facc15'],
    bolt: ['#fde047', '#38bdf8', '#c084fc', '#ffffff'],
    spark: ['#e879f9', '#38bdf8', '#fde047', '#ffffff'],
  };
  const colors = palettes[fx] || palettes.spark;
  const originX = w * 0.62;
  const originY = h * 0.72;

  for (let i = 0; i < 42; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.35;
    const speed = 3.5 + Math.random() * 8.5;
    fxParticles.push({
      fx,
      x: originX + (Math.random() - 0.5) * 90,
      y: originY + (Math.random() - 0.5) * 40,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2.2,
      size: 5 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.24,
      color: colors[i % colors.length],
      life: 1,
      decay: 0.015 + Math.random() * 0.014,
    });
  }

  if (!fxAnimId) {
    const step = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = fxParticles.length - 1; i >= 0; i--) {
        const p = fxParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.fx === 'fire' ? -0.05 : 0.18;
        p.rot += p.vrot;
        p.life -= p.decay;
        if (p.life <= 0) {
          fxParticles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.fx === 'hearts') {
          const s = p.size * 0.55;
          ctx.beginPath();
          ctx.moveTo(0, s);
          ctx.bezierCurveTo(-s * 1.4, -s * 0.4, -s * 0.7, -s * 1.5, 0, -s * 0.5);
          ctx.bezierCurveTo(s * 0.7, -s * 1.5, s * 1.4, -s * 0.4, 0, s);
          ctx.fill();
        } else if (p.fx === 'confetti') {
          ctx.fillRect(-p.size * 0.6, -p.size * 0.32, p.size * 1.2, p.size * 0.64);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (fxParticles.length > 0) {
        fxAnimId = requestAnimationFrame(step);
      } else {
        fxAnimId = 0;
        ctx.clearRect(0, 0, w, h);
      }
    };
    fxAnimId = requestAnimationFrame(step);
  }
}

/* ==========================================================================
   3. 3D Wallpaper Gallery & Custom Bubble Gradient Studio
   ========================================================================== */
export function initWallpaperStudio({ getWall, setWall }) {
  const grid = document.getElementById('wall-gallery-grid');
  const colorA = document.getElementById('bubble-color-a');
  const colorB = document.getElementById('bubble-color-b');
  const resetBtn = document.getElementById('bubble-color-reset');

  const applySavedBubbleGrad = () => {
    try {
      const raw = localStorage.getItem(BUBBLE_GRAD_KEY);
      if (!raw) return;
      const { a, b } = JSON.parse(raw);
      if (/^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b)) {
        document.documentElement.style.setProperty('--orb-bubble-out', `linear-gradient(135deg, ${a} 0%, ${b} 100%)`);
        if (colorA) colorA.value = a;
        if (colorB) colorB.value = b;
      }
    } catch {}
  };
  applySavedBubbleGrad();

  const updateGrad = () => {
    if (!colorA || !colorB) return;
    const a = colorA.value;
    const b = colorB.value;
    document.documentElement.style.setProperty('--orb-bubble-out', `linear-gradient(135deg, ${a} 0%, ${b} 100%)`);
    try { localStorage.setItem(BUBBLE_GRAD_KEY, JSON.stringify({ a, b })); } catch {}
  };
  colorA?.addEventListener('input', updateGrad);
  colorB?.addEventListener('input', updateGrad);
  resetBtn?.addEventListener('click', () => {
    document.documentElement.style.removeProperty('--orb-bubble-out');
    try { localStorage.removeItem(BUBBLE_GRAD_KEY); } catch {}
    if (colorA) colorA.value = '#7c3aed';
    if (colorB) colorB.value = '#ec4899';
  });

  const render = () => {
    if (!grid) return;
    grid.replaceChildren();
    const active = getWall();
    const sections = [
      { key: '3d', label: '14 Анімованих 3D та Псевдо-3D фонів' },
      { key: '9:16', label: '5 Згенерованих 9:16 шпалер чату' },
      { key: 'classic', label: 'Класичні теми' },
    ];
    for (const sec of sections) {
      const h = document.createElement('div');
      h.className = 'wall-gallery-section-title';
      h.textContent = sec.label;
      grid.append(h);
      for (const item of WALLPAPER_CATALOG.filter((w) => w.group === sec.key)) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `wall-card${item.id === active ? ' active' : ''}`;
        card.dataset.wallId = item.id;
        if (item.img) {
          card.style.backgroundImage = `url('${item.img}')`;
        } else if (item.css) {
          card.style.backgroundImage = item.css;
        }
        const title = document.createElement('strong');
        title.textContent = item.title;
        const sub = document.createElement('small');
        sub.textContent = item.sub;
        card.append(title, sub);
        card.addEventListener('click', () => {
          setWall(item.id);
          render();
        });
        grid.append(card);
      }
    }
  };

  render();
  return { refreshGallery: render };
}

/* ==========================================================================
   4. Interactive Voice Waveform + Speed + Sticky Floating Mini-Player
   ========================================================================== */
let activeAudio = null;
let currentSpeed = 1;

function fmtSec(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function initMiniPlayer() {
  const bar = document.getElementById('mini-player');
  const toggleBtn = document.getElementById('mini-play-toggle');
  const titleEl = document.getElementById('mini-track-title');
  const seekEl = document.getElementById('mini-seek');
  const timeEl = document.getElementById('mini-time');
  const speedBtn = document.getElementById('mini-speed');
  const closeBtn = document.getElementById('mini-close');
  if (!bar) return { attachAudio: () => {} };

  const syncPlayIcon = (paused) => {
    bar.classList.toggle('paused', paused);
    const use = toggleBtn?.querySelector('use');
    if (use) use.setAttribute('href', paused ? '#i-play' : '#i-pause');
  };

  toggleBtn?.addEventListener('click', () => {
    if (!activeAudio) return;
    if (activeAudio.paused) activeAudio.play().catch(() => {});
    else activeAudio.pause();
  });

  seekEl?.addEventListener('input', () => {
    if (!activeAudio || !Number.isFinite(activeAudio.duration) || activeAudio.duration <= 0) return;
    activeAudio.currentTime = (Number(seekEl.value) / 1000) * activeAudio.duration;
  });

  speedBtn?.addEventListener('click', () => {
    currentSpeed = currentSpeed === 1 ? 1.5 : currentSpeed === 1.5 ? 2 : 1;
    speedBtn.textContent = `${currentSpeed}x`;
    if (activeAudio) activeAudio.playbackRate = currentSpeed;
    document.querySelectorAll('.voice-speed-pill').forEach((el) => { el.textContent = `${currentSpeed}x`; });
  });

  closeBtn?.addEventListener('click', () => {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    bar.hidden = true;
  });

  const attachAudio = (audio, label = 'Голосове повідомлення') => {
    audio.addEventListener('play', () => {
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      audio.playbackRate = currentSpeed;
      bar.hidden = false;
      if (titleEl) titleEl.textContent = label;
      if (speedBtn) speedBtn.textContent = `${currentSpeed}x`;
      syncPlayIcon(false);
    });
    audio.addEventListener('pause', () => {
      if (activeAudio === audio) syncPlayIcon(true);
    });
    audio.addEventListener('ended', () => {
      if (activeAudio === audio) syncPlayIcon(true);
    });
    audio.addEventListener('timeupdate', () => {
      if (activeAudio !== audio) return;
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      if (seekEl && dur > 0) seekEl.value = String(Math.round((audio.currentTime / dur) * 1000));
      if (timeEl) timeEl.textContent = fmtSec(audio.currentTime);
    });
  };

  return { attachAudio };
}

export function enhanceAudioBubble(box, audio, att, miniPlayer) {
  const label = att?.name || 'Голосове повідомлення';
  miniPlayer?.attachAudio(audio, label);

  const row = document.createElement('div');
  row.className = 'voice-wave-row';
  const barsWrap = document.createElement('div');
  barsWrap.className = 'voice-wave-bars';
  const seedStr = String(att?.id || att?.name || 'libo');
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) hash = Math.imul(hash ^ seedStr.charCodeAt(i), 16777619);

  const barEls = [];
  for (let i = 0; i < 28; i++) {
    hash = Math.imul(hash ^ (i + 17), 2246822519);
    const pct = 24 + (Math.abs(hash) % 74);
    const b = document.createElement('i');
    b.style.height = `${pct}%`;
    barEls.push(b);
    barsWrap.append(b);
  }

  barsWrap.addEventListener('click', (ev) => {
    const rect = barsWrap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = ratio * audio.duration;
    }
    if (audio.paused) audio.play().catch(() => {});
  });

  audio.addEventListener('timeupdate', () => {
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const ratio = dur > 0 ? audio.currentTime / dur : 0;
    const activeCount = Math.round(ratio * barEls.length);
    barEls.forEach((b, idx) => b.classList.toggle('played', idx < activeCount));
  });

  const speedPill = document.createElement('button');
  speedPill.type = 'button';
  speedPill.className = 'voice-speed-pill';
  speedPill.textContent = `${currentSpeed}x`;
  speedPill.title = 'Швидкість відтворення';
  speedPill.addEventListener('click', () => {
    currentSpeed = currentSpeed === 1 ? 1.5 : currentSpeed === 1.5 ? 2 : 1;
    audio.playbackRate = currentSpeed;
    document.querySelectorAll('.voice-speed-pill').forEach((el) => { el.textContent = `${currentSpeed}x`; });
    const miniSpeed = document.getElementById('mini-speed');
    if (miniSpeed) miniSpeed.textContent = `${currentSpeed}x`;
  });

  row.append(barsWrap, speedPill);
  box.append(row);
}

/* ==========================================================================
   5. Live Voice Recording Spectrum HUD
   ========================================================================== */
let hudStopFn = null;

export function startVoiceHud(stream, onDone) {
  stopVoiceHud();
  const hud = document.getElementById('voice-hud');
  const timerEl = document.getElementById('voice-timer');
  const canvas = document.getElementById('voice-wave-canvas');
  const doneBtn = document.getElementById('voice-stop-btn');
  if (!hud) return;
  hud.hidden = false;
  const startedAt = Date.now();

  let audioCtx = null;
  let analyser = null;
  let dataArr = null;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && stream?.getAudioTracks?.().length) {
      audioCtx = new Ctx();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      dataArr = new Uint8Array(analyser.frequencyBinCount);
    }
  } catch {}

  let raf = 0;
  const ctx = canvas?.getContext('2d');
  const draw = () => {
    if (timerEl) timerEl.textContent = fmtSec((Date.now() - startedAt) / 1000);
    if (ctx && canvas) {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (analyser && dataArr) analyser.getByteFrequencyData(dataArr);
      const bars = 24;
      const step = w / bars;
      for (let i = 0; i < bars; i++) {
        const val = dataArr ? dataArr[i % dataArr.length] / 255 : (0.28 + 0.45 * Math.abs(Math.sin(Date.now() / 170 + i * 0.45)));
        const bh = Math.max(4, val * (h - 4));
        ctx.fillStyle = i % 2 === 0 ? '#f472b6' : '#c084fc';
        ctx.fillRect(i * step + 1, (h - bh) / 2, Math.max(2, step - 3), bh);
      }
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  const handleDone = () => onDone?.();
  doneBtn?.addEventListener('click', handleDone);

  hudStopFn = () => {
    cancelAnimationFrame(raf);
    doneBtn?.removeEventListener('click', handleDone);
    try { audioCtx?.close(); } catch {}
    hud.hidden = true;
  };
}

export function stopVoiceHud() {
  if (hudStopFn) {
    hudStopFn();
    hudStopFn = null;
  }
}

/* ==========================================================================
   6. Neon Sketchpad (Draw Pad -> Instant Chat Image Attachment)
   ========================================================================== */
export function initDrawPad({ onAttachSketch, openDialog, closeDialog, showToast }) {
  const btn = document.getElementById('draw-button');
  const dialog = document.getElementById('draw-dialog');
  const canvas = document.getElementById('draw-canvas');
  const colorsWrap = document.getElementById('draw-colors');
  const undoBtn = document.getElementById('draw-undo');
  const clearBtn = document.getElementById('draw-clear');
  const sendBtn = document.getElementById('draw-send');
  if (!canvas || !dialog) return;

  const ctx = canvas.getContext('2d');
  let brushColor = '#ec4899';
  let brushSize = 8;
  let drawing = false;
  let hasStrokes = false;
  const history = [];

  const fillBg = () => {
    const grad = ctx.createRadialGradient(320, 260, 30, 320, 320, 420);
    grad.addColorStop(0, '#231242');
    grad.addColorStop(1, '#0c0618');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  fillBg();

  const pushSnapshot = () => {
    try {
      if (history.length >= 12) history.shift();
      history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    } catch {}
  };

  const pos = (ev) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / Math.max(1, r.width)) * canvas.width,
      y: ((ev.clientY - r.top) / Math.max(1, r.height)) * canvas.height,
    };
  };

  const startStroke = (ev) => {
    if (drawing) return;
    pushSnapshot();
    drawing = true;
    hasStrokes = true;
    if (ev.pointerId != null) {
      try { canvas.setPointerCapture?.(ev.pointerId); } catch {}
    }
    const pt = ev.touches?.[0] || ev;
    const p = pos(pt);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.shadowColor = brushColor;
    ctx.shadowBlur = brushSize * 1.4;
    ctx.lineTo(p.x + 0.5, p.y + 0.5);
    ctx.stroke();
  };

  const moveStroke = (ev) => {
    if (!drawing) return;
    const pt = ev.touches?.[0] || ev;
    const p = pos(pt);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const stopDraw = () => {
    if (!drawing) return;
    drawing = false;
    ctx.shadowBlur = 0;
  };

  canvas.addEventListener('pointerdown', startStroke);
  canvas.addEventListener('pointermove', moveStroke);
  canvas.addEventListener('pointerup', stopDraw);
  canvas.addEventListener('pointercancel', stopDraw);
  canvas.addEventListener('mousedown', startStroke);
  canvas.addEventListener('mousemove', moveStroke);
  window.addEventListener('mouseup', stopDraw);

  colorsWrap?.querySelectorAll('button[data-color]').forEach((b) => {
    b.addEventListener('click', () => {
      brushColor = b.dataset.color || '#ec4899';
      colorsWrap.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    });
  });

  dialog.querySelectorAll('.draw-sizes button[data-size]').forEach((b) => {
    b.addEventListener('click', () => {
      brushSize = Number(b.dataset.size) || 8;
      dialog.querySelectorAll('.draw-sizes button').forEach((x) => x.classList.toggle('active', x === b));
    });
  });

  undoBtn?.addEventListener('click', () => {
    const snap = history.pop();
    if (snap) ctx.putImageData(snap, 0, 0);
  });

  clearBtn?.addEventListener('click', () => {
    pushSnapshot();
    fillBg();
  });

  btn?.addEventListener('click', () => openDialog('draw-dialog'));

  sendBtn?.addEventListener('click', async () => {
    if (!hasStrokes) {
      showToast?.('Спочатку намалюйте щось на полотні');
      return;
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    hasStrokes = false;
    history.length = 0;
    fillBg();
    closeDialog(dialog);
    await onAttachSketch?.(dataUrl);
  });
}

/* ==========================================================================
   7. Circular Video Note Recorder (Відеокружечок до 30 с)
   ========================================================================== */
export function initVideoNotes({ onSendVideoNote, openDialog, closeDialog, showToast }) {
  const openBtn = document.getElementById('vnote-button');
  const dialog = document.getElementById('vnote-dialog');
  const video = document.getElementById('vnote-preview');
  const recBtn = document.getElementById('vnote-rec-btn');
  const sendBtn = document.getElementById('vnote-send-btn');
  const timerEl = document.getElementById('vnote-timer');
  const ringEl = document.getElementById('vnote-ring-prog');
  const statusEl = document.getElementById('vnote-status');
  if (!dialog) return;

  let stream = null;
  let recorder = null;
  let chunks = [];
  let recordedBlob = null;
  let startedAt = 0;
  let tickTimer = null;

  const cleanupStream = () => {
    clearInterval(tickTimer);
    tickTimer = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    recorder = null;
    stream?.getTracks?.().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
  };

  openBtn?.addEventListener('click', () => {
    recordedBlob = null;
    if (sendBtn) sendBtn.hidden = true;
    if (recBtn) recBtn.textContent = 'Почати запис';
    if (timerEl) timerEl.textContent = '0:00';
    if (ringEl) ringEl.style.strokeDashoffset = '647';
    if (statusEl) statusEl.textContent = 'Натисніть «Почати запис», щоб увімкнути камеру.';
    openDialog('vnote-dialog');
  });

  dialog.addEventListener('close', cleanupStream);

  recBtn?.addEventListener('click', async () => {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast?.('Запис відео недоступний на цьому пристрої');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
        audio: true,
      });
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch(() => {});
      }
      const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
      chunks = [];
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 650_000 }) : new MediaRecorder(stream);
      startedAt = Date.now();
      recBtn.textContent = 'Зупинити';
      if (statusEl) statusEl.textContent = 'Йде запис відеокружечка… (до 30 с)';

      recorder.ondataavailable = (ev) => {
        if (ev.data?.size) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        clearInterval(tickTimer);
        const durMs = Date.now() - startedAt;
        const type = (recorder?.mimeType || mime || 'video/webm').split(';')[0];
        recordedBlob = { blob: new Blob(chunks, { type }), type, durMs };
        stream?.getTracks?.().forEach((t) => t.stop());
        stream = null;
        if (sendBtn) sendBtn.hidden = false;
        recBtn.textContent = 'Перезаписати';
        if (statusEl) statusEl.textContent = 'Відеокружечок готовий до відправки!';
      };

      recorder.start(250);
      tickTimer = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        if (timerEl) timerEl.textContent = fmtSec(elapsed);
        if (ringEl) {
          const pct = Math.min(1, elapsed / 30);
          ringEl.style.strokeDashoffset = String(Math.round(647 * (1 - pct)));
        }
        if (elapsed >= 30 && recorder?.state === 'recording') recorder.stop();
      }, 200);
    } catch {
      cleanupStream();
      showToast?.('Немає доступу до камери або мікрофона');
    }
  });

  sendBtn?.addEventListener('click', async () => {
    if (!recordedBlob) return;
    const payload = recordedBlob;
    recordedBlob = null;
    closeDialog(dialog);
    await onSendVideoNote?.(payload);
  });
}

/* ==========================================================================
   8. Multi-Language Instant UI Switcher (RU default / UK Українська / EN)
   ========================================================================== */
const I18N_DOM = {
  uk: {
    '#nav-chats .rail-label': 'Чати',
    '#nav-saved .rail-label': 'Обране',
    '#nav-contacts .rail-label': 'Додати',
    '#nav-walls .rail-label': '3D Фони',
    '#theme-toggle .rail-label': 'Тема',
    '.rail-bottom [data-dialog="settings-dialog"] .rail-label': 'Налашт.',
    '.sidebar-heading h1': 'Повідомлення',
    '#chat-search@placeholder': 'Пошук чатів і повідомлень',
    '.folder-tab[data-folder=""]': 'Усі папки',
    '.invite-card strong': 'Ваші люди. Ваш LIBO.',
    '.invite-card small': 'Запросіть близьких за кодом',
    '#message-input@placeholder': 'Написати повідомлення…',
    '#welcome-screen h2': 'Поруч з тими, хто важливий',
    '#welcome-screen > p': 'Особисті повідомлення залишаються між вами та співрозмовником: без телефонів і серверного архіву.',
  },
  en: {
    '#nav-chats .rail-label': 'Chats',
    '#nav-saved .rail-label': 'Saved',
    '#nav-contacts .rail-label': 'Add',
    '#nav-walls .rail-label': '3D Walls',
    '#theme-toggle .rail-label': 'Theme',
    '.rail-bottom [data-dialog="settings-dialog"] .rail-label': 'Settings',
    '.sidebar-heading h1': 'Messages',
    '#chat-search@placeholder': 'Search chats & messages',
    '.folder-tab[data-folder=""]': 'All folders',
    '.invite-card strong': 'Your people. Your LIBO.',
    '.invite-card small': 'Invite close friends via code',
    '#message-input@placeholder': 'Write a message…',
    '#welcome-screen h2': 'Close to people who matter',
    '#welcome-screen > p': 'Private P2P messages stay strictly between you and your contact: no phone numbers, no cloud history.',
  },
  ru: {
    '#nav-chats .rail-label': 'Чаты',
    '#nav-saved .rail-label': 'Избранное',
    '#nav-contacts .rail-label': 'Добавить',
    '#nav-walls .rail-label': '3D Фоны',
    '#theme-toggle .rail-label': 'Тема',
    '.rail-bottom [data-dialog="settings-dialog"] .rail-label': 'Настройки',
    '.sidebar-heading h1': 'Сообщения',
    '#chat-search@placeholder': 'Поиск чатов и сообщений',
    '.folder-tab[data-folder=""]': 'Все папки',
    '.invite-card strong': 'Ваши люди. Ваш LIBO.',
    '.invite-card small': 'Пригласите близких по коду',
    '#message-input@placeholder': 'Написать сообщение…',
    '#welcome-screen h2': 'Рядом с теми, кто важен',
    '#welcome-screen > p': 'Личные сообщения остаются между вами и собеседником: без номеров телефонов, ленты и серверного архива переписок.',
  },
};

export function initLocalization() {
  const select = document.getElementById('lang-select');
  const quickBtn = document.getElementById('lang-quick');
  const pillCode = document.getElementById('lang-pill-code');

  const apply = (lang) => {
    const code = ['ru', 'uk', 'en'].includes(lang) ? lang : 'ru';
    document.documentElement.lang = code;
    if (select) select.value = code;
    if (pillCode) pillCode.textContent = code === 'uk' ? 'UA' : code.toUpperCase();
    const map = I18N_DOM[code] || I18N_DOM.ru;
    for (const [spec, val] of Object.entries(map)) {
      const [sel, attr] = spec.split('@');
      const el = document.querySelector(sel);
      if (!el) continue;
      if (attr) {
        el.setAttribute(attr, val);
      } else if (sel === '.sidebar-heading h1') {
        const dot = el.querySelector('.small-dot') || Object.assign(document.createElement('span'), { className: 'small-dot' });
        el.replaceChildren(document.createTextNode(val), dot);
      } else {
        el.textContent = val;
      }
    }
  };

  let saved = 'ru';
  try { saved = localStorage.getItem(LANG_KEY) || 'ru'; } catch {}
  if (saved !== 'ru') apply(saved);
  else if (pillCode) pillCode.textContent = 'RU';

  const setLang = (next) => {
    try { localStorage.setItem(LANG_KEY, next); } catch {}
    apply(next);
  };

  select?.addEventListener('change', () => setLang(select.value));
  quickBtn?.addEventListener('click', () => {
    const cur = document.documentElement.lang || 'ru';
    const next = cur === 'ru' ? 'uk' : cur === 'uk' ? 'en' : 'ru';
    setLang(next);
  });

  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('tab-hidden', document.hidden);
  });
}
