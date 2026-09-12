#!/usr/bin/env python3
"""Render the LIBO launcher icon set from one geometry definition.

The icon introduced in 2.3.0 replaces the 2.0.0-beta.1 launcher art. Everything is
generated from the shapes below so the Android launcher icons, the adaptive-icon
vector layers and the web favicon can never drift apart again.

Requires Pillow:  python3 -m venv .venv && .venv/bin/pip install pillow
Run:              python3 scripts/make-icons.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

VIOLET = (0x78, 0x50, 0xDF, 255)
WHITE = (0xFF, 0xFF, 0xFF, 255)
LIME = (0xD6, 0xEC, 0x9D, 255)

# Adaptive-icon canvas is 108x108dp; the launcher masks the central 66x66dp.
CANVAS = 108.0
SAFE = 66.0

# Geometry in the 108dp adaptive canvas (x, y, w, h). Bars are bottom-aligned pills.
BAR_LEFT = (35.5, 32.0, 15.0, 47.0)
BAR_RIGHT = (57.5, 50.0, 15.0, 29.0)
DOT = (65.0, 38.0, 8.0)  # cx, cy, r

LEGACY_DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def pill_path(x: float, y: float, w: float, h: float) -> str:
    """Vector pathData for a stadium (pill) shape."""
    r = w / 2.0
    return (
        f"M{x + r},{y} L{x + w - r},{y} A{r},{r} 0 0 1 {x + w - r},{y + 2 * r} "
        f"L{x + w - r},{y + h - 2 * r} A{r},{r} 0 0 1 {x + w - r},{y + h} "
        f"L{x + r},{y + h} A{r},{r} 0 0 1 {x},{y + h - 2 * r} L{x},{y + 2 * r} "
        f"A{r},{r} 0 0 1 {x + r},{y} Z"
    )


def circle_path(cx: float, cy: float, r: float) -> str:
    return (
        f"M{cx - r},{cy} a{r},{r} 0 1 0 {2 * r},0 a{r},{r} 0 1 0 {-2 * r},0 Z"
    )


def draw_mark(draw: ImageDraw.ImageDraw, scale: float, offset: float, mono: bool = False) -> None:
    """Paint the two bars and the dot; `mono` renders every shape in one colour."""
    bar_colour = WHITE
    dot_colour = WHITE if mono else LIME
    for x, y, w, h in (BAR_LEFT, BAR_RIGHT):
        draw.rounded_rectangle(
            [(x * scale + offset, y * scale + offset), ((x + w) * scale + offset, (y + h) * scale + offset)],
            radius=w / 2.0 * scale,
            fill=bar_colour,
        )
    cx, cy, r = DOT
    draw.ellipse(
        [(cx - r) * scale + offset, (cy - r) * scale + offset, (cx + r) * scale + offset, (cy + r) * scale + offset],
        fill=dot_colour,
    )


def adaptive_foreground(size: int, mono: bool = False) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_mark(ImageDraw.Draw(image), size / CANVAS, 0.0, mono=mono)
    return image


def legacy_icon(size: int, round_icon: bool = False) -> Image.Image:
    """Full-bleed square/circle icon with the mark scaled into the visible area."""
    supersample = max(4, math.ceil(1024 / size))
    big = size * supersample
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if round_icon:
        draw.ellipse([0, 0, big, big], fill=VIOLET)
    else:
        draw.rounded_rectangle([0, 0, big, big], radius=big * 0.2237, fill=VIOLET)
    # The mark occupies 108dp of art space; shrink it so it sits inside the visible
    # square/circle with balanced padding (49dp of art -> ~58% of the icon).
    mark_scale = big * 1.28 / CANVAS
    offset = (big - CANVAS * mark_scale) / 2.0
    draw_mark(draw, mark_scale, offset)
    return image.resize((size, size), Image.LANCZOS)


def write(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")


def vector(width_height: int, paths: str) -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        f'    android:width="{width_height}dp" android:height="{width_height}dp"\n'
        f'    android:viewportWidth="{CANVAS:g}" android:viewportHeight="{CANVAS:g}">\n'
        f"{paths}"
        "</vector>\n"
    )


def main() -> None:
    res = ROOT / "app/src/main/res"

    # 1. Adaptive-icon vector layers (used on every supported device: minSdk 26).
    background = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        f'    android:width="108dp" android:height="108dp"\n'
        f'    android:viewportWidth="{CANVAS:g}" android:viewportHeight="{CANVAS:g}">\n'
        f'    <path android:fillColor="#7850DF" android:pathData="M0,0h{CANVAS:g}v{CANVAS:g}h-{CANVAS:g}z" />\n'
        "</vector>\n"
    )
    foreground = vector(
        108,
        f'    <path android:fillColor="#FFFFFF" android:pathData="{pill_path(*BAR_LEFT)}" />\n'
        f'    <path android:fillColor="#FFFFFF" android:pathData="{pill_path(*BAR_RIGHT)}" />\n'
        f'    <path android:fillColor="#D6EC9D" android:pathData="{circle_path(*DOT)}" />\n',
    )
    monochrome = vector(
        108,
        f'    <path android:fillColor="#FFFFFF" android:pathData="{pill_path(*BAR_LEFT)}" />\n'
        f'    <path android:fillColor="#FFFFFF" android:pathData="{pill_path(*BAR_RIGHT)}" />\n'
        f'    <path android:fillColor="#FFFFFF" android:pathData="{circle_path(*DOT)}" />\n',
    )
    for name, body in (
        ("ic_launcher_background.xml", background),
        ("ic_launcher_foreground.xml", foreground),
        ("ic_launcher_monochrome.xml", monochrome),
    ):
        path = res / "drawable" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(ROOT)}")

    adaptive = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@drawable/ic_launcher_background" />\n'
        '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
        '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n'
        "</adaptive-icon>\n"
    )
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        path = res / "mipmap-anydpi-v26" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(adaptive, encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(ROOT)}")

    # 2. Legacy PNG fallbacks for launchers that ignore mipmap-anydpi-v26.
    for folder, size in LEGACY_DENSITIES.items():
        write(legacy_icon(size), res / folder / "ic_launcher.png")
        write(legacy_icon(size, round_icon=True), res / folder / "ic_launcher_round.png")

    # 3. Web / release artwork: same geometry, same colours.
    write(legacy_icon(512), ROOT / "web/public/icon-512.png")
    write(legacy_icon(192), ROOT / "web/public/icon-192.png")
    write(adaptive_foreground(512), ROOT / "art/icon-foreground-512.png")

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="LIBO">
  <rect width="96" height="96" rx="21.5" fill="#7850DF"/>
  <g transform="translate(48 48) scale(1.1363) translate(-54 -54.5)">
    <path d="{pill_path(*BAR_LEFT)}" fill="#fff"/>
    <path d="{pill_path(*BAR_RIGHT)}" fill="#fff"/>
    <path d="{circle_path(*DOT)}" fill="#D6EC9D"/>
  </g>
</svg>
"""
    (ROOT / "web/public/icon.svg").write_text(svg, encoding="utf-8", newline="\n")
    print("wrote web/public/icon.svg")


if __name__ == "__main__":
    main()
