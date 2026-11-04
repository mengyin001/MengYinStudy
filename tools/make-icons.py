"""Generates the PNG app icons from the same seal as the in-app brand mark.

The mark is a cream Palatino M stamped on a pine plate: the favicon is the SVG
version of the same drawing, so the tab, the sidebar and the installed app all
show one mark.

Usage: python tools/make-icons.py
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "icons"

PINE = (47, 93, 78, 255)  # #2f5d4e, the light-theme accent
CREAM = (245, 241, 232, 255)  # #f5f1e8, warm paper
SUPERSAMPLE = 4

# Palatino's M, matching the outline in apps/web/src/components/BrandMark.tsx.
# Fallbacks keep the script usable away from Windows; the letterform only
# changes if none of these are installed.
FONT_CANDIDATES = [
    "C:/Windows/Fonts/pala.ttf",
    "C:/Windows/Fonts/palabi.ttf",
    "/System/Library/Fonts/Palatino.ttc",
    "/System/Library/Fonts/Supplemental/Palatino.ttc",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]


def load_font(px: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        if pathlib.Path(candidate).exists():
            return ImageFont.truetype(candidate, px)
    return ImageFont.truetype("DejaVu Serif", px)


def draw_mark(size: int, *, maskable: bool) -> Image.Image:
    work = size * SUPERSAMPLE
    image = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if maskable:
        # Full bleed: the launcher applies its own mask, so the mark stays in
        # the middle 80% safe zone.
        draw.rectangle((0, 0, work - 1, work - 1), fill=PINE)
    else:
        draw.rounded_rectangle((0, 0, work - 1, work - 1), radius=work * 7 / 64, fill=PINE)

    font = load_font(round(work * 48 / 64))
    left, top, right, bottom = draw.textbbox((0, 0), "M", font=font)
    draw.text(
        (work / 2 - (left + right) / 2, work / 2 - (top + bottom) / 2),
        "M",
        font=font,
        fill=CREAM,
    )
    return image.resize((size, size), Image.LANCZOS)


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


if __name__ == "__main__":
    main()
