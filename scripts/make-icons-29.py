#!/usr/bin/env python3
"""Render the LIBO 2.8.5 icon set from art/libo-3-1024.png (speech bubble + padlock mark).

    python3 scripts/make-icons-29.py

Outputs: legacy mipmap PNGs (square + round), adaptive foreground/background
(432 px, safe zone 66 %), monochrome vector layer is kept, web icon-192/512.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = Image.open(ROOT / 'art/libo-3-1024.png').convert('RGBA')
RES = ROOT / 'app/src/main/res'
DENSITIES = {'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192}

def square(size):
    return SRC.resize((size, size), Image.LANCZOS)

def rounded(size, radius_ratio=0.22):
    img = square(size)
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * radius_ratio), fill=255)
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img

def circle(size):
    img = square(size)
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img

for folder, size in DENSITIES.items():
    (RES / folder).mkdir(parents=True, exist_ok=True)
    rounded(size).save(RES / folder / 'ic_launcher.png', optimize=True)
    circle(size).save(RES / folder / 'ic_launcher_round.png', optimize=True)

# Adaptive: background = the gradient field (source scaled so the bubble stays inside the 66 % safe zone).
adaptive = RES / 'mipmap-anydpi-v26'
bg = SRC.resize((432, 432), Image.LANCZOS).filter(ImageFilter.GaussianBlur(60))
bg.save(adaptive / 'ic_launcher_background.png', optimize=True)
fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
# Isolate the bubble (letters included) by flood-filling the violet field from the corners.
marker = SRC.convert('RGB').copy()
for corner in [(2, 2), (1021, 2), (2, 1021), (1021, 1021)]:
    ImageDraw.floodfill(marker, corner, (255, 0, 255), thresh=90)
alpha = Image.eval(marker.split()[1], lambda g: 255)  # start opaque
mpx = marker.load(); apx = alpha.load()
for y in range(1024):
    for x in range(1024):
        if mpx[x, y] == (255, 0, 255): apx[x, y] = 0
# Keep only the component connected to the centre (drops the glow spot and shadow specks).
keep = alpha.copy()
ImageDraw.floodfill(keep, (512, 512), 128, thresh=0)
kpx = keep.load()
for y in range(1024):
    for x in range(1024):
        apx[x, y] = 255 if kpx[x, y] == 128 else 0
alpha = alpha.filter(ImageFilter.GaussianBlur(1.2))
bubble = SRC.copy(); bubble.putalpha(alpha)
box = alpha.getbbox()
bubble = bubble.crop(box)
scale = 280 / max(bubble.size)
bubble = bubble.resize((int(bubble.width * scale), int(bubble.height * scale)), Image.LANCZOS)
fg.paste(bubble, ((432 - bubble.width) // 2, (432 - bubble.height) // 2), bubble)
fg.save(adaptive / 'ic_launcher_foreground.png', optimize=True)

web = ROOT / 'web/public'
rounded(512).save(web / 'icon-512.png', optimize=True)
rounded(192).save(web / 'icon-192.png', optimize=True)
square(1024).save(ROOT / 'art/libo-3-1024.png', optimize=True)
print('icons written')
