#!/usr/bin/env python3
"""Render the LIBO 2.6.0 flat 2D icon set (square 1:1).

The 2.5.0 glossy artwork (gradients, soft shadows, blur, light streaks) is replaced by
a strict flat 2D composition: solid purple field, one flat ring band, flat green
chevron and flat white «i B O» wordmark — no gradients, no shadows, no highlights.
Every artifact (legacy PNG densities, round variants, adaptive layers, monochrome
layer, web favicon and 1:1 promo squares) is generated from this single script:

    python3 scripts/make-icons-26.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

BASE = (0xA8, 0x55, 0xF7, 255)   # flat vivid purple
DARK = (0x7C, 0x1F, 0xD8, 255)   # flat ring band
GREEN = (0x84, 0xCC, 0x16, 255)  # flat chevron green
WHITE = (0xFF, 0xFF, 0xFF, 255)  # flat wordmark white

LEGACY_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
ADAPTIVE_PX = 432


def flat_background(size: int) -> Image.Image:
    """Solid field with one flat ring band and a flat thin ring line. No gradients."""
    ss = 2
    big = size * ss
    img = Image.new("RGBA", (big, big), BASE)
    draw = ImageDraw.Draw(img)
    cx, cy = -0.42 * big, 1.42 * big

    draw.ellipse([cx - 1.66 * big, cy - 1.66 * big, cx + 1.66 * big, cy + 1.66 * big], fill=DARK)
    draw.ellipse([cx - 1.36 * big, cy - 1.36 * big, cx + 1.36 * big, cy + 1.36 * big], fill=BASE)
    draw.ellipse([cx - 0.94 * big, cy - 0.94 * big, cx + 0.94 * big, cy + 0.94 * big], fill=DARK)
    draw.ellipse([cx - 0.62 * big, cy - 0.62 * big, cx + 0.62 * big, cy + 0.62 * big], fill=BASE)
    # flat thin accent ring (solid colour, constant width)
    ring = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse([cx - 1.70 * big, cy - 1.70 * big, cx + 1.70 * big, cy + 1.70 * big], fill=WHITE)
    rd.ellipse([cx - 1.675 * big, cy - 1.675 * big, cx + 1.675 * big, cy + 1.675 * big], fill=(0, 0, 0, 0))
    img.alpha_composite(ring)
    return img.resize((size, size), Image.NEAREST)


def flat_wordmark(length: int) -> Image.Image:
    """Flat '< i B O' mark: single-colour shapes, no gloss and no shadows."""
    h = int(length * 0.42)
    img = Image.new("RGBA", (length, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    u = length / 1000.0
    cy = h / 2

    def capsule(x0, y0, x1, y1, width, colour):
        draw.line([(x0, y0), (x1, y1)], fill=colour, width=int(width))
        r = width / 2
        for x, y in ((x0, y0), (x1, y1)):
            draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)

    stroke = 78 * u
    ax, ay = 20 * u, cy
    tx, ty = 205 * u, cy - 150 * u
    bx, by = 205 * u, cy + 150 * u
    draw.line([(ax, ay), (tx, ty)], fill=GREEN, width=int(stroke))
    draw.line([(ax, ay), (bx, by)], fill=GREEN, width=int(stroke))
    for x, y in ((ax, ay), (tx, ty), (bx, by)):
        draw.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=GREEN)
    # flat 'i'
    ix = 300 * u
    capsule(ix, cy + 40 * u, ix + 130 * u, cy + 40 * u, 74 * u, WHITE)
    draw.ellipse([ix + 96 * u, cy - 118 * u, ix + 172 * u, cy - 42 * u], fill=WHITE)
    # flat 'B'
    bx0, by0 = 480 * u, cy - 165 * u
    bw, bh = 260 * u, 330 * u
    draw.rounded_rectangle([bx0, by0, bx0 + bw, by0 + bh], radius=88 * u, fill=WHITE)
    hole_w, hole_h = 100 * u, 92 * u
    hx = bx0 + (bw - hole_w) / 2
    draw.rounded_rectangle([hx, by0 + 52 * u, hx + hole_w, by0 + 52 * u + hole_h], radius=40 * u, fill=(0, 0, 0, 0))
    draw.rounded_rectangle([hx, by0 + bh - 52 * u - hole_h, hx + hole_w, by0 + bh - 52 * u], radius=40 * u, fill=(0, 0, 0, 0))
    # flat 'O'
    ox0, oy0 = 790 * u, cy - 150 * u
    ow = 210 * u
    draw.rounded_rectangle([ox0, oy0, ox0 + ow, oy0 + ow + 60 * u], radius=92 * u, fill=WHITE)
    draw.rounded_rectangle([ox0 + 58 * u, oy0 + 68 * u, ox0 + ow - 58 * u, oy0 + ow - 8 * u], radius=52 * u, fill=(0, 0, 0, 0))
    return img


def compose(size: int, angle: float = 33.0, fit: float = 0.82) -> Image.Image:
    bg = flat_background(size)
    mark = flat_wordmark(int(size * 0.98)).rotate(-angle, resample=Image.BICUBIC, expand=True)
    target = size * fit
    scale = min(target / mark.width, target / mark.height)
    mw, mh = int(mark.width * scale), int(mark.height * scale)
    mark = mark.resize((mw, mh), Image.LANCZOS)
    bg.alpha_composite(mark, ((size - mw) // 2 + int(size * 0.02), (size - mh) // 2 - int(size * 0.03)))
    return bg


def foreground_layer(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mark = flat_wordmark(int(size * 0.80)).rotate(-angle_default(), resample=Image.BICUBIC, expand=True)
    safe = size * 66 / 108
    scale = min(safe / mark.width, safe / mark.height) * 1.35
    mw, mh = int(mark.width * scale), int(mark.height * scale)
    mark = mark.resize((mw, mh), Image.LANCZOS)
    canvas.alpha_composite(mark, ((size - mw) // 2, (size - mh) // 2))
    return canvas


def angle_default() -> float:
    return 33.0


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


def main() -> None:
    res = ROOT / "app/src/main/res"
    for folder, size in LEGACY_DENSITIES.items():
        icon = compose(size)
        write(icon, res / folder / "ic_launcher.png")
        write(round_variant(icon), res / folder / "ic_launcher_round.png")
    write(compose(ADAPTIVE_PX), res / "mipmap-anydpi-v26" / "ic_launcher_background.png")
    write(foreground_layer(ADAPTIVE_PX), res / "mipmap-anydpi-v26" / "ic_launcher_foreground.png")
    # 1:1 promo squares
    write(compose(1024), ROOT / "art/libo-2d-1024.png")
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
        (res / "mipmap-anydpi-v26" / name).write_text(adaptive, encoding="utf-8", newline="\n")

    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="LIBO">
  <rect width="96" height="96" fill="#a855f7"/>
  <path fill="#7c1fd8" fill-rule="evenodd" d="M-40 136a179 179 0 1 0 0-358 179 179 0 0 0 0 358Zm0-32a147 147 0 1 1 0-294 147 147 0 0 1 0 294Z"/>
  <circle cx="-40" cy="136" r="163" fill="none" stroke="#fff" stroke-width="2.6"/>
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
    print("wrote web/public/icon.svg (flat 2D)")


if __name__ == "__main__":
    main()
