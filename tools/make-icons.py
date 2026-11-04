"""Generates the app icons, the Google OAuth logo and the social card.

The mark is one drawing in three places: the React `BrandMark`, the SVG
favicon and this rasteriser. A cream M is built from stacked book spines, with
a terracotta bookmark in the centre. The bookmark is deliberate: it survives at
16 px and tells a reviewer this is a study app, not a generic letter tile.

Usage: python tools/make-icons.py
"""
from __future__ import annotations

import pathlib
import textwrap

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "icons"

PINE = (47, 93, 78, 255)  # #2f5d4e, the light-theme accent
CREAM = (245, 241, 232, 255)  # #f5f1e8, warm paper
TERRA = (196, 106, 78, 255)  # #c46a4e, bookmark / seal
PINE_DARK = (31, 65, 55, 255)  # #1f4137, page lines
INK = (27, 26, 22, 255)
INK_2 = (74, 70, 60, 255)
INK_3 = (125, 118, 103, 255)
SUPERSAMPLE = 4

# Geometry in the 64×64 viewBox, matching BrandMark.tsx.
M_POINTS = [(17, 46), (17, 20), (32, 36), (47, 20), (47, 46)]
PAGE_LINES = [
    ((14, 25), (20, 25)),
    ((14, 31), (20, 31)),
    ((14, 37), (20, 37)),
    ((44, 25), (50, 25)),
    ((44, 31), (50, 31)),
    ((44, 37), (50, 37)),
]
BOOKMARK = [(30.5, 14), (33.5, 14), (33.5, 28), (32, 26.2), (30.5, 28)]

FONT_CANDIDATES = {
    "serif": [
        "C:/Windows/Fonts/pala.ttf",
        "/System/Library/Fonts/Palatino.ttc",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    ],
    "sans": [
        "C:/Windows/Fonts/segoeui.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    "sans-bold": [
        "C:/Windows/Fonts/segoeuib.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
}


def font(kind: str, px: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES[kind]:
        if pathlib.Path(candidate).exists():
            return ImageFont.truetype(candidate, px)
    return ImageFont.load_default()


def _scaled(points: list[tuple[float, float]], scale: float) -> list[tuple[float, float]]:
    return [(x * scale, y * scale) for x, y in points]


def _dot(draw: ImageDraw.ImageDraw, point: tuple[float, float], radius: float, fill) -> None:
    x, y = point
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def draw_mark(size: int, *, maskable: bool = False) -> Image.Image:
    work = size * SUPERSAMPLE
    scale = work / 64
    image = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if maskable:
        # Full bleed: the launcher applies its own mask, and the mark sits well
        # inside the 80% safe zone.
        draw.rectangle((0, 0, work - 1, work - 1), fill=PINE)
    else:
        draw.rounded_rectangle((0, 0, work - 1, work - 1), radius=13 * scale, fill=PINE)

    points = _scaled(M_POINTS, scale)
    draw.line(points, fill=CREAM, width=round(7 * scale), joint="curve")
    for point in points:
        _dot(draw, point, 3.5 * scale, CREAM)

    line_width = max(1, round(1.1 * scale))
    for start, end in PAGE_LINES:
        draw.line([(start[0] * scale, start[1] * scale), (end[0] * scale, end[1] * scale)], fill=PINE_DARK, width=line_width)
        _dot(draw, (start[0] * scale, start[1] * scale), line_width / 2, PINE_DARK)
        _dot(draw, (end[0] * scale, end[1] * scale), line_width / 2, PINE_DARK)

    draw.polygon(_scaled(BOOKMARK, scale), fill=TERRA)
    return image.resize((size, size), Image.LANCZOS)


def draw_og_card() -> Image.Image:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), (245, 241, 232))
    draw = ImageDraw.Draw(image)

    mark = draw_mark(150)
    image.paste(mark, (80, 72), mark)

    draw.text((256, 76), "MengYin Study", font=font("serif", 64), fill=INK)
    draw.text((258, 158), "REVISION & PRACTICE", font=font("sans", 22), fill=INK_3)

    draw.line((80, 286, 1120, 286), fill=(221, 214, 199), width=1)

    body = (
        "Build your own question decks, drill the questions you keep missing, "
        "and see what you have actually learned."
    )
    wrapped = textwrap.wrap(body, width=56)
    y = 330
    for line in wrapped:
        draw.text((80, y), line, font=font("serif", 36), fill=INK)
        y += 48

    draw.text(
        (80, 540),
        "study.mengyin.online",
        font=font("sans-bold", 20),
        fill=INK_2,
    )
    draw.text(
        (1120, 542),
        "Google Sign-In is optional",
        font=font("sans", 18),
        fill=INK_3,
        anchor="ra",
    )
    return image


def write_favicon_svg() -> None:
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">
  <rect width="64" height="64" rx="13" fill="#2f5d4e"/>
  <path d="M17 46 L17 20 L32 36 L47 20 L47 46" fill="none" stroke="#f5f1e8" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M14 25 H20 M14 31 H20 M14 37 H20 M44 25 H50 M44 31 H50 M44 37 H50" fill="none" stroke="#f5f1e8" stroke-width="1.1" stroke-linecap="round" opacity=".48"/>
  <path d="M30.5 14 L33.5 14 L33.5 28 L32 26.2 L30.5 28 Z" fill="#c46a4e"/>
</svg>
"""
    (OUT / "favicon.svg").write_text(svg, encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    targets = [
        (192, False, "icon-192.png"),
        (512, False, "icon-512.png"),
        (1024, False, "icon-1024.png"),
        (512, True, "icon-maskable-512.png"),
        (180, True, "apple-touch-icon.png"),
    ]
    for size, maskable, name in targets:
        icon = draw_mark(size, maskable=maskable)
        icon.save(OUT / name)
        print(f"wrote {OUT / name} ({size}x{size})")

    # Google OAuth consent screens want a square 120×120 PNG. Use the full
    # bleed plate so the circular crop has no transparent corners.
    oauth = draw_mark(120, maskable=True)
    oauth.save(OUT / "oauth-logo-120.png")
    print(f"wrote {OUT / 'oauth-logo-120.png'} (120x120)")

    draw_og_card().save(OUT / "og-image.png")
    print(f"wrote {OUT / 'og-image.png'} (1200x630)")

    # Browsers still probe /favicon.ico even when an SVG icon is linked. A real
    # multi-size ICO avoids a 404 in the reviewer's network log.
    ico = draw_mark(256, maskable=True)
    ico.save(OUT.parent / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"wrote {OUT.parent / 'favicon.ico'} (16/32/48)")

    write_favicon_svg()
    print(f"wrote {OUT / 'favicon.svg'}")


if __name__ == "__main__":
    main()
