#!/usr/bin/env python3
"""Render the LIBO 2.5.0 launcher icon set from the artwork supplied by the user.

The original raster (purple rings, glossy green chevron, white "i B O" wordmark on a
diagonal band) is rebuilt here as parametric geometry so every Android density, the
adaptive-icon layers, the monochrome themed-icon layer and the web favicon come from
one source of truth. Run:  python3 scripts/make-icons-25.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent

BASE = (0xA8, 0x55, 0xF7, 255)      # vivid purple band
DARK = (0x6D, 0x28, 0xD9, 255)      # ring shadow bands
DEEP = (0x5B, 0x21, 0xB6, 255)      # outer ring
LIGHT = (0xC0, 0x84, 0xFC, 255)     # ring highlight lines
GREEN = (0x84, 0xCC, 0x16, 255)     # chevron
GREEN_HI = (0xBE, 0xF2, 0x64, 255)  # chevron gloss
WHITE = (0xFF, 0xFF, 0xFF, 255)

LEGACY_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
ADAPTIVE_PX = 432  # 108dp at xxxhdpi-equivalent resolution


def ring_background(size: int) -> Image.Image:
    """Concentric glossy rings centred off-canvas at the bottom-left."""
    ss = 2
    big = size * ss
    img = Image.new("RGBA", (big, big), BASE)
    draw = ImageDraw.Draw(img)
    cx, cy = -0.42 * big, 1.42 * big
    bands = [
        (1.72, 9.0, DEEP),
        (1.66, 1.72, LIGHT),
        (1.36, 1.66, DARK),
        (0.98, 1.36, BASE),
        (0.94, 0.98, LIGHT),
        (0.62, 0.94, DARK),
        (0.0, 0.62, BASE),
    ]
    for inner, outer, colour in bands:
        draw.ellipse(
            [cx - outer * big, cy - outer * big, cx + outer * big, cy + outer * big],
            fill=colour,
        )
        if inner:
            draw.ellipse(
                [cx - inner * big, cy - inner * big, cx + inner * big, cy + inner * big],
                fill=None,
            )
    # glossy white arc near the top-right corner
    gloss = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.arc(
        [cx - 1.69 * big, cy - 1.69 * big, cx + 1.69 * big, cy + 1.69 * big],
        start=-75, end=5, fill=(255, 255, 255, 235), width=int(big * 0.02),
    )
    gloss = gloss.filter(ImageFilter.GaussianBlur(big * 0.008))
    img.alpha_composite(gloss)
    # soft top light
    light = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ld = ImageDraw.Draw(light)
    for y in range(big):
        alpha = int(26 * (1 - y / big) ** 2)
        ld.line([(0, y), (big, y)], fill=(255, 255, 255, alpha))
    img.alpha_composite(light)
    return img.resize((size, size), Image.LANCZOS)


def wordmark(length: int) -> Image.Image:
    """The '< i B O' mark on a transparent strip (unrotated)."""
    h = int(length * 0.42)
    img = Image.new("RGBA", (length, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    u = length / 1000.0  # unit
    cy = h / 2

    def capsule(x0, y0, x1, y1, width, colour):
        draw.line([(x0, y0), (x1, y1)], fill=colour, width=int(width))
        r = width / 2
        for x, y in ((x0, y0), (x1, y1)):
            draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)

    # chevron '<'
    ax, ay = 20 * u, cy                 # apex (left)
    tx, ty = 205 * u, cy - 150 * u      # top arm end
    bx, by = 205 * u, cy + 150 * u      # bottom arm end
    stroke = 78 * u
    shadow = Image.new("RGBA", (length, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.line([(ax, ay + 6 * u), (tx, ty + 6 * u), (bx, by + 6 * u)], fill=(0, 0, 0, 45), width=int(stroke), joint="curve")
    shadow = shadow.filter(ImageFilter.GaussianBlur(9 * u))
    img.alpha_composite(shadow)
    draw.line([(ax, ay), (tx, ty)], fill=GREEN, width=int(stroke))
    draw.line([(ax, ay), (bx, by)], fill=GREEN, width=int(stroke))
    for x, y in ((ax, ay), (tx, ty), (bx, by)):
        draw.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=GREEN)
    # gloss on the upper arm
    draw.line([(ax + 16 * u, ay - 18 * u), (tx - 16 * u, ty + 2 * u)], fill=GREEN_HI, width=int(stroke * 0.2))
    # 'i': dash + dot
    ix = 300 * u
    capsule(ix, cy + 40 * u, ix + 130 * u, cy + 40 * u, 74 * u, WHITE)
    draw.ellipse([ix + 96 * u, cy - 118 * u, ix + 172 * u, cy - 42 * u], fill=WHITE)
    # 'B': rounded square with two holes and a waist notch
    bx0, by0 = 480 * u, cy - 165 * u
    bw, bh = 260 * u, 330 * u
    draw.rounded_rectangle([bx0, by0, bx0 + bw, by0 + bh], radius=88 * u, fill=WHITE)
    hole_w, hole_h = 100 * u, 92 * u
    hx = bx0 + (bw - hole_w) / 2
    draw.rounded_rectangle([hx, by0 + 52 * u, hx + hole_w, by0 + 52 * u + hole_h], radius=40 * u, fill=(0, 0, 0, 0))
    draw.rounded_rectangle([hx, by0 + bh - 52 * u - hole_h, hx + hole_w, by0 + bh - 52 * u], radius=40 * u, fill=(0, 0, 0, 0))
    # 'O': rounded ring
    ox0, oy0 = 790 * u, cy - 150 * u
    ow = 210 * u
    draw.rounded_rectangle([ox0, oy0, ox0 + ow, oy0 + ow + 60 * u], radius=92 * u, fill=WHITE)
    draw.rounded_rectangle([ox0 + 58 * u, oy0 + 68 * u, ox0 + ow - 58 * u, oy0 + ow - 8 * u], radius=52 * u, fill=(0, 0, 0, 0))
    return img


def rotate_mark(mark: Image.Image, angle: float) -> Image.Image:
    return mark.rotate(-angle, resample=Image.BICUBIC, expand=True)


def compose(size: int, angle: float = 33.0, safe_zone: float = 1.0) -> Image.Image:
    bg = ring_background(size)
    mark = rotate_mark(wordmark(int(size * 0.98)), angle)
    target = size * 0.82 * safe_zone
    scale = min(target / mark.width, target / mark.height)
    mw, mh = int(mark.width * scale), int(mark.height * scale)
    mark = mark.resize((mw, mh), Image.LANCZOS)
    px = (size - mw) // 2 + int(size * 0.02)
    py = (size - mh) // 2 - int(size * 0.03)
    bg.alpha_composite(mark, (px, py))
    return bg


def foreground_layer(size: int) -> Image.Image:
    """Adaptive foreground: rings cropped out, mark inside the 66/108 safe zone."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mark = rotate_mark(wordmark(int(size * 0.80)), 33.0)
    safe = size * 66 / 108
    scale = min(safe / mark.width, safe / mark.height) * 1.35
    mw, mh = int(mark.width * scale), int(mark.height * scale)
    mark = mark.resize((mw, mh), Image.LANCZOS)
    canvas.alpha_composite(mark, ((size - mw) // 2, (size - mh) // 2))
    return canvas


def round_variant(image: Image.Image) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, image.size[0], image.size[1]], fill=255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(image, (0, 0), mask)
    return out


def write(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")


MONO_PATHS = """    <path android:fillColor="#FFFFFF" android:pathData="M60,54 L86,35 L86,42 L68,54 L86,66 L86,73 Z" />
    <path android:fillColor="#FFFFFF" android:pathData="M40,49 h14 a6,6 0 0 1 6,6 v0 a6,6 0 0 1 -6,6 h-14 a6,6 0 0 1 -6,-6 v0 a6,6 0 0 1 6,-6 Z" />
    <path android:fillColor="#FFFFFF" android:pathData="M58,30 m-6,0 a6,6 0 1 0 12,0 a6,6 0 1 0 -12,0" />
    <path android:fillColor="#FFFFFF" android:fillType="evenOdd" android:pathData="M28,30 h20 a10,10 0 0 1 10,10 v28 a10,10 0 0 1 -10,10 h-20 a10,10 0 0 1 -10,-10 v-28 a10,10 0 0 1 10,-10 Z M32,40 h12 v10 h-12 Z M32,56 h12 v10 h-12 Z" />
    <path android:fillColor="#FFFFFF" android:fillType="evenOdd" android:pathData="M70,30 h16 a12,12 0 0 1 12,12 v24 a12,12 0 0 1 -12,12 h-16 a12,12 0 0 1 -12,-12 v-24 a12,12 0 0 1 12,-12 Z M74,42 h8 v14 h-8 Z" />"""


def main() -> None:
    res = ROOT / "app/src/main/res"
    for folder, size in LEGACY_DENSITIES.items():
        icon = compose(size)
        write(icon, res / folder / "ic_launcher.png")
        write(round_variant(icon), res / folder / "ic_launcher_round.png")
    write(compose(ADAPTIVE_PX, safe_zone=1.0), res / "mipmap-anydpi-v26" / "ic_launcher_background.png")
    write(foreground_layer(ADAPTIVE_PX), res / "mipmap-anydpi-v26" / "ic_launcher_foreground.png")
    write(compose(512), ROOT / "web/public/icon-512.png")
    write(compose(192), ROOT / "web/public/icon-192.png")

    adaptive = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@mipmap/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n'
        "</adaptive-icon>\n"
    )
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        path = res / "mipmap-anydpi-v26" / name
        path.write_text(adaptive, encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(ROOT)}")

    mono = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="108dp" android:height="108dp"\n'
        '    android:viewportWidth="108" android:viewportHeight="108">\n'
        f"{MONO_PATHS}\n</vector>\n"
    )
    (res / "drawable" / "ic_launcher_monochrome.xml").write_text(mono, encoding="utf-8", newline="\n")
    # remove the old flat-design layers: the 2.5.0 icon is raster-based
    for stale in ("drawable/ic_launcher_background.xml", "drawable/ic_launcher_foreground.xml"):
        target = res / stale
        if target.exists():
            target.unlink()
            print(f"removed {stale}")

    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="LIBO">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b678fb"/><stop offset="1" stop-color="#9333ea"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="20" fill="url(#g)"/>
  <g fill="none" stroke="#7e22ce" stroke-width="9">
    <circle cx="-40" cy="136" r="118"/>
    <circle cx="-40" cy="136" r="152"/>
  </g>
  <g fill="none" stroke="#d8b4fe" stroke-width="2.4">
    <circle cx="-40" cy="136" r="124"/>
    <circle cx="-40" cy="136" r="158"/>
  </g>
  <g transform="rotate(33 48 44)">
    <path d="M22 44 L40 31 M22 44 L40 57" stroke="#84cc16" stroke-width="10" stroke-linecap="round" fill="none"/>
    <path d="M48 49 h10" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
    <circle cx="60" cy="36" r="5.4" fill="#fff"/>
    <path fill="#fff" fill-rule="evenodd" d="M66 30 h12 a7 7 0 0 1 7 7 v14 a7 7 0 0 1 -7 7 h-12 a7 7 0 0 1 -7 -7 v-14 a7 7 0 0 1 7 -7 Z M69 36 h7 v6 h-7 Z M69 46 h7 v6 h-7 Z"/>
    <path fill="#fff" fill-rule="evenodd" d="M90 30 h6 a8 8 0 0 1 8 8 v12 a8 8 0 0 1 -8 8 h-6 a8 8 0 0 1 -8 -8 v-12 a8 8 0 0 1 8 -8 Z M90 38 h6 v8 h-6 Z"/>
  </g>
</svg>
"""
    (ROOT / "web/public/icon.svg").write_text(svg, encoding="utf-8", newline="\n")
    print("wrote web/public/icon.svg")


if __name__ == "__main__":
    main()
