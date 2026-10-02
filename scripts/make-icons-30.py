#!/usr/bin/env python3
"""Render the LIBO 2.8.7 icon set from art/libo-4-1024.png.

    python3 scripts/make-icons-30.py

Outputs per density: legacy ic_launcher / ic_launcher_round, adaptive
ic_launcher_foreground / ic_launcher_background (108dp canvas, bubble inside
the 66 % safe zone) and ic_splash (Android 12+ splash icon, 288dp canvas with
the mark inside the 160dp safe circle). Also web/public/icon-192/512.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = Image.open(ROOT / 'art/libo-4-1024.png').convert('RGBA')
RES = ROOT / 'app/src/main/res'
DENSITIES = {'mipmap-mdpi': 1, 'mipmap-hdpi': 1.5, 'mipmap-xhdpi': 2, 'mipmap-xxhdpi': 3, 'mipmap-xxxhdpi': 4}

def masked(size, draw_mask):
    img = SRC.resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size * 4, size * 4), 0)
    draw_mask(ImageDraw.Draw(mask), size * 4)
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img

# --- isolate the bubble (letters, lock, shadow) from the gradient field ---
marker = SRC.convert('RGB').copy()
for corner in [(2, 2), (1021, 2), (2, 1021), (1021, 1021)]:
    ImageDraw.floodfill(marker, corner, (255, 0, 255), thresh=70)
alpha = Image.new('L', (1024, 1024), 255)
mpx, apx = marker.load(), alpha.load()
for y in range(1024):
    for x in range(1024):
        if mpx[x, y] == (255, 0, 255): apx[x, y] = 0
keep = alpha.copy()
ImageDraw.floodfill(keep, (512, 512), 128, thresh=0)
kpx = keep.load()
for y in range(1024):
    for x in range(1024):
        apx[x, y] = 255 if kpx[x, y] == 128 else 0
alpha = alpha.filter(ImageFilter.GaussianBlur(1.0))
bubble = SRC.copy(); bubble.putalpha(alpha)
bbox = bubble.getbbox()
bubble = bubble.crop(bbox)
print('bubble bbox', bbox, bubble.size)

def layer(canvas_dp, safe_dp, scale, fill_ratio=0.92):
    """Place the bubble centred on a transparent canvas; longest side = fill_ratio * safe zone."""
    size = int(round(canvas_dp * scale))
    safe = safe_dp * scale * fill_ratio
    ratio = safe / max(bubble.size)
    w, h = int(bubble.size[0] * ratio), int(bubble.size[1] * ratio)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(bubble.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return out

def gradient(size):
    # Reproduce the source gradient: sample the field with the bubble removed and blur heavily.
    field = SRC.resize((size, size), Image.LANCZOS).convert('RGB')
    return field.filter(ImageFilter.GaussianBlur(size / 6))

for folder, scale in DENSITIES.items():
    d = RES / folder; d.mkdir(parents=True, exist_ok=True)
    legacy = int(48 * scale)
    masked(legacy, lambda m, s: m.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * .22), fill=255)).save(d / 'ic_launcher.png', optimize=True)
    masked(legacy, lambda m, s: m.ellipse((0, 0, s - 1, s - 1), fill=255)).save(d / 'ic_launcher_round.png', optimize=True)
    layer(108, 66, scale).save(d / 'ic_launcher_foreground.png', optimize=True)
    layer(288, 160, scale, 0.9).save(d / 'ic_splash.png', optimize=True)

for folder in list(DENSITIES) + ['mipmap-anydpi-v26']:
    for old in ['ic_launcher_background.png', 'ic_launcher_foreground.png'] if folder == 'mipmap-anydpi-v26' else ['ic_launcher_background.png']:
        p = RES / folder / old
        if p.exists(): p.unlink()

web = ROOT / 'web/public'
for size in (192, 512):
    masked(size, lambda m, s: m.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * .22), fill=255)).save(web / f'icon-{size}.png', optimize=True)
# maskable: full-bleed square (safe zone handled by the OS)
SRC.resize((512, 512), Image.LANCZOS).save(web / 'icon-512-maskable.png', optimize=True)
print('done')
