#!/usr/bin/env python3
"""Render the LIBO 2.8.0 icon set (square 1:1, flat 2D, richer composition; unchanged in 2.8.1).

Improvements over the 2.6.0 flat mark, all still strict flat 2D (no gradients,
no blur, no gloss):
  * duotone field: a diagonal flat wedge of lighter violet over the deep base;
  * three concentric flat rings plus two thin accent rings for depth;
  * the chevron gets a flat offset shadow in dark green (long-shadow style);
  * the wordmark is optically centred and slightly larger, with even gaps;
  * every artifact is regenerated: legacy densities, round, adaptive layers,
    monochrome layer, web favicon and 1:1 promo squares.

    python3 scripts/make-icons-28.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

BASE = (0x6D, 0x28, 0xD9, 255)    # deep violet field
WEDGE = (0x8B, 0x5C, 0xF6, 255)   # lighter diagonal wedge
BAND = (0x5B, 0x21, 0xB6, 255)    # dark flat rings
ACCENT = (0xC4, 0xB5, 0xFD, 255)  # thin light accent rings
GREEN = (0x84, 0xCC, 0x16, 255)   # chevron
GREEN_DK = (0x4D, 0x7C, 0x0F, 255)  # flat chevron shadow
WHITE = (0xFF, 0xFF, 0xFF, 255)

LEGACY_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
ADAPTIVE_PX = 432
ANGLE = 33.0


def flat_background(size: int) -> Image.Image:
    ss = 2
    big = size * ss
    img = Image.new("RGBA", (big, big), BASE)
    draw = ImageDraw.Draw(img)
    # diagonal flat wedge from the top-right corner
    draw.polygon([(big, 0), (big, big * 0.62), (big * 0.30, 0)], fill=WEDGE)
    cx, cy = -0.42 * big, 1.42 * big

    def disc(radius: float, colour) -> None:
        draw.ellipse([cx - radius * big, cy - radius * big, cx + radius * big, cy + radius * big], fill=colour)

    disc(1.66, BAND)
    disc(1.36, BASE)
    disc(0.94, BAND)
    disc(0.62, BASE)

    def ring(radius: float, width: float, colour) -> None:
        layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        rd = ImageDraw.Draw(layer)
        rd.ellipse([cx - radius * big, cy - radius * big, cx + radius * big, cy + radius * big], fill=colour)
        rd.ellipse([cx - (radius - width) * big, cy - (radius - width) * big,
                    cx + (radius - width) * big, cy + (radius - width) * big], fill=(0, 0, 0, 0))
        img.alpha_composite(layer)

    ring(1.70, 0.022, WHITE)
    ring(1.02, 0.016, ACCENT)
    ring(0.58, 0.014, ACCENT)
    return img.resize((size, size), Image.NEAREST)


def wordmark(length: int) -> Image.Image:
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

    def chevron(offset, colour):
        stroke = 80 * u
        ax, ay = 20 * u + offset, cy + offset
        tx, ty = 205 * u + offset, cy - 150 * u + offset
        bx, by = 205 * u + offset, cy + 150 * u + offset
        draw.line([(ax, ay), (tx, ty)], fill=colour, width=int(stroke))
        draw.line([(ax, ay), (bx, by)], fill=colour, width=int(stroke))
        for x, y in ((ax, ay), (tx, ty), (bx, by)):
            draw.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=colour)

    chevron(26 * u, GREEN_DK)   # flat long-shadow pass
    chevron(0, GREEN)
    # 'i'
    ix = 305 * u
    capsule(ix, cy + 40 * u, ix + 128 * u, cy + 40 * u, 76 * u, WHITE)
    draw.ellipse([ix + 94 * u, cy - 120 * u, ix + 172 * u, cy - 42 * u], fill=WHITE)
    # 'B'
    bx0, by0 = 486 * u, cy - 165 * u
    bw, bh = 258 * u, 330 * u
    draw.rounded_rectangle([bx0, by0, bx0 + bw, by0 + bh], radius=88 * u, fill=WHITE)
    hole_w, hole_h = 98 * u, 92 * u
    hx = bx0 + (bw - hole_w) / 2
    draw.rounded_rectangle([hx, by0 + 52 * u, hx + hole_w, by0 + 52 * u + hole_h], radius=40 * u, fill=(0, 0, 0, 0))
    draw.rounded_rectangle([hx, by0 + bh - 52 * u - hole_h, hx + hole_w, by0 + bh - 52 * u], radius=40 * u, fill=(0, 0, 0, 0))
    # 'O'
    ox0, oy0 = 794 * u, cy - 150 * u
    ow = 206 * u
    draw.rounded_rectangle([ox0, oy0, ox0 + ow, oy0 + ow + 60 * u], radius=92 * u, fill=WHITE)
    draw.rounded_rectangle([ox0 + 58 * u, oy0 + 68 * u, ox0 + ow - 58 * u, oy0 + ow - 8 * u], radius=52 * u, fill=(0, 0, 0, 0))
    return img


def compose(size: int, fit: float = 0.84) -> Image.Image:
    bg = flat_background(size)
    mark = wordmark(int(size * 0.98)).rotate(-ANGLE, resample=Image.BICUBIC, expand=True)
    target = size * fit
    scale = min(target / mark.width, target / mark.height)
    mw, mh = int(mark.width * scale), int(mark.height * scale)
    mark = mark.resize((mw, mh), Image.LANCZOS)
    bg.alpha_composite(mark, ((size - mw) // 2 + int(size * 0.015), (size - mh) // 2 - int(size * 0.02)))
    return bg


def foreground_layer(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mark = wordmark(int(size * 0.80)).rotate(-ANGLE, resample=Image.BICUBIC, expand=True)
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


def main() -> None:
    res = ROOT / "app/src/main/res"
    for folder, size in LEGACY_DENSITIES.items():
        icon = compose(size)
        write(icon, res / folder / "ic_launcher.png")
        write(round_variant(icon), res / folder / "ic_launcher_round.png")
    write(flat_background(ADAPTIVE_PX), res / "mipmap-anydpi-v26" / "ic_launcher_background.png")
    write(foreground_layer(ADAPTIVE_PX), res / "mipmap-anydpi-v26" / "ic_launcher_foreground.png")
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
  <rect width="96" height="96" fill="#6d28d9"/>
  <path d="M96 0v60L29 0Z" fill="#8b5cf6"/>
  <path fill="#5b21b6" fill-rule="evenodd" d="M-40 136a179 179 0 1 0 0-358 179 179 0 0 0 0 358Zm0-32a147 147 0 1 1 0-294 147 147 0 0 1 0 294Z"/>
  <path fill="#5b21b6" fill-rule="evenodd" d="M-40 136a101 101 0 1 0 0-202 101 101 0 0 0 0 202Zm0-34a67 67 0 1 1 0-134 67 67 0 0 1 0 134Z"/>
  <circle cx="-40" cy="136" r="163" fill="none" stroke="#fff" stroke-width="2.4"/>
  <circle cx="-40" cy="136" r="109" fill="none" stroke="#c4b5fd" stroke-width="1.6"/>
  <circle cx="-40" cy="136" r="62" fill="none" stroke="#c4b5fd" stroke-width="1.4"/>
  <g transform="rotate(33 48 44)">
    <path d="M25 47 L43 34 M25 47 L43 60" stroke="#4d7c0f" stroke-width="10" stroke-linecap="round" fill="none"/>
    <path d="M22 44 L40 31 M22 44 L40 57" stroke="#84cc16" stroke-width="10" stroke-linecap="round" fill="none"/>
    <path d="M48 49 h10" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
    <circle cx="60" cy="36" r="5.4" fill="#fff"/>
    <path fill="#fff" fill-rule="evenodd" d="M66 30 h12 a7 7 0 0 1 7 7 v14 a7 7 0 0 1 -7 7 h-12 a7 7 0 0 1 -7 -7 v-14 a7 7 0 0 1 7 -7 Z M69 36 h7 v6 h-7 Z M69 46 h7 v6 h-7 Z"/>
    <path fill="#fff" fill-rule="evenodd" d="M90 30 h6 a8 8 0 0 1 8 8 v12 a8 8 0 0 1 -8 8 h-6 a8 8 0 0 1 -8 -8 v-12 a8 8 0 0 1 8 -8 Z M90 38 h6 v8 h-6 Z"/>
  </g>
</svg>
"""
    (ROOT / "web/public/icon.svg").write_text(svg, encoding="utf-8", newline="\n")
    print("wrote web/public/icon.svg (2.8.0 flat duotone, kept for 2.8.1)")


if __name__ == "__main__":
    main()
