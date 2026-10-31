"""Regenerate Latin subsets from the licensed, unmodified Geist font sources.
Run explicitly: uv run --no-project --with 'fonttools[woff]==4.62.1' python scripts/subset-fonts.py
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parents[1] / 'public' / 'fonts'
UNICODES = set(range(0x0250)) | set(range(0x2000, 0x2300)) | {0xFEFF, 0xFFFD}
for family in ('Geist', 'GeistMono'):
    font = TTFont(FONTS / f'{family}-variable.woff2')
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.hinting = False
    processor = subset.Subsetter(options=options)
    processor.populate(unicodes=UNICODES)
    processor.subset(font)
    font.save(FONTS / f'{family}-latin-variable.woff2')

# First paint only needs Latin-1 and punctuation. Scientific/extended glyphs
# remain available from the existing range-specific licensed sources.
BASIC = set(range(0x0100)) | set(range(0x2000, 0x2070)) | set(range(0x2190, 0x2200)) | {0x00B7, 0xFEFF, 0xFFFD}
for source, target in (
    ('Geist-variable.woff2', 'Geist-basic-variable.woff2'),
    ('GeistMono-variable.woff2', 'GeistMono-basic-variable.woff2'),
    ('SpaceGrotesk-latin-variable.woff2', 'SpaceGrotesk-basic-variable.woff2'),
    ('GeistPixel-Square.woff2', 'GeistPixel-basic.woff2'),
):
    font = TTFont(FONTS / source)
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.hinting = False
    processor = subset.Subsetter(options=options)
    processor.populate(unicodes=BASIC)
    processor.subset(font)
    font.save(FONTS / target)


# Limit public variable axes to their used range; fractional weights remain exact.
from fontTools.varLib.instancer import instantiateVariableFont
for family, limits, source in (
    ('Geist', (400, 400, 600), 'Geist-variable.woff2'),
    ('GeistMono', (400, 400, 600), 'GeistMono-variable.woff2'),
    ('SpaceGrotesk', (500, 500, 700), 'SpaceGrotesk-latin-variable.woff2'),
):
    font = TTFont(FONTS / source)
    options = subset.Options()
    options.flavor = 'woff2'
    options.hinting = False
    processor = subset.Subsetter(options=options)
    processor.populate(unicodes=BASIC)
    processor.subset(font)
    instantiateVariableFont(font, {'wght': limits}, inplace=True)
    font.save(FONTS / f'{family}-public-variable.woff2')
